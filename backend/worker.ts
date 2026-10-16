interface Env {
  ASSETS: Fetcher;
  PLAYERS: DurableObjectNamespace;
  LEADERBOARD: DurableObjectNamespace;
}

const MAX_BODY = 512 * 1024;
const actions = new Set('start,nextday,speed,tab,build,buildpipe,rotate,cancel,sl,assign,upgrade,release,profile,remove,hire,hack,force,prod,ledger,desel,map,egg'.split(','));
const json = (value: unknown, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const error = (message: string, status: number) => json({ error: message }, status);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new InputError('Please send application/json.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new InputError('Request exceeds 512 KiB.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!object(value)) throw new Error();
    return value;
  } catch { throw new InputError('A valid JSON object is required.'); }
}

function validateSave(value: unknown): void {
  if (!object(value) || value.version !== 2 || !integer(value.seed, 0, 0xffffffff)
    || !integer(value.steps, 0, 250000) || !Array.isArray(value.commands) || value.commands.length > 10000) {
    throw new InputError('Invalid replay save.');
  }
  let previous = 0;
  for (const command of value.commands) {
    if (!object(command) || !integer(command.step, previous, value.steps)
      || typeof command.act !== 'string' || !actions.has(command.act)
      || typeof command.arg !== 'string' || command.arg.length > 80) {
      throw new InputError('Invalid replay command.');
    }
    previous = command.step;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const allowed: Record<string, string[]> = {
        '/api/save': ['GET', 'PUT'], '/api/score': ['POST'], '/api/leaderboard': ['GET'],
      };
      const methods = allowed[url.pathname];
      if (!methods) return error('API route not found.', 404);
      if (!methods.includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: methods.join(', ') });
      if (request.method !== 'GET') {
        const origin = request.headers.get('Origin');
        if (origin !== null && origin !== url.origin) return error('Cross-origin changes are not allowed.', 403);
      }
      const board = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global'));
      if (url.pathname === '/api/leaderboard') return await board.fetch('https://internal/leaderboard');
      const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '');
      if (!match) return error('Use your 64-character recovery code to authorize this request.', 401);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
      const player = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      if (url.pathname === '/api/save') {
        const stub = env.PLAYERS.get(env.PLAYERS.idFromName(player));
        if (request.method === 'GET') return await stub.fetch('https://internal/save');
        const data = await body(request);
        if (!integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1)) throw new InputError('Invalid save revision.');
        validateSave(data.save);
        return await stub.fetch('https://internal/save', { method: 'PUT', body: JSON.stringify(data) });
      }
      const data = await body(request);
      if (typeof data.name !== 'string') throw new InputError('Choose a printable name of 1–24 characters.');
      const name = data.name.trim();
      if (Array.from(name).length < 1 || Array.from(name).length > 24 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(name)) {
        throw new InputError('Choose a printable name of 1–24 characters.');
      }
      if (!integer(data.score, 0, 100000000) || !integer(data.day, 1, 10000)) throw new InputError('Invalid score or day.');
      return await board.fetch('https://internal/score', {
        method: 'POST', body: JSON.stringify({ player, name, score: data.score, day: data.day }),
      });
    } catch (cause) {
      if (cause instanceof InputError) return error(cause.message, cause.status);
      return error('Something went wrong. Please try again.', 500);
    }
  },
} satisfies ExportedHandler<Env>;

export class PlayerSave {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS save (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const data = request.method === 'PUT' ? await request.json() as { revision: number; save: unknown } : null;
    // All reads and writes in this transaction are synchronous: concurrent requests cannot lose a revision.
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{ revision: number; payload: string; updated_at: string }>('SELECT revision, payload, updated_at FROM save WHERE id=1').toArray()[0];
      if (!data) return json(row ? { revision: row.revision, save: JSON.parse(row.payload), updatedAt: row.updated_at } : { revision: 0, save: null });
      if (data.revision !== (row?.revision ?? 0)) return error('Your cloud save changed. Reload it before saving again.', 409);
      const revision = data.revision + 1;
      const updatedAt = new Date().toISOString();
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO save VALUES (1, ?, ?, ?)', revision, JSON.stringify(data.save), updatedAt);
      return json({ revision, updatedAt });
    });
  }
}

export class Leaderboard {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS scores (player TEXT PRIMARY KEY, name TEXT NOT NULL, score INTEGER NOT NULL, day INTEGER NOT NULL, achieved INTEGER NOT NULL UNIQUE, submitted_at INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS ranking ON scores(score DESC, achieved ASC)');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const entries = this.ctx.storage.sql.exec('SELECT name, score, day FROM scores ORDER BY score DESC, achieved ASC LIMIT 20').toArray();
      return json({ entries, unverified: true });
    }
    const data = await request.json() as { player: string; name: string; score: number; day: number };
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const row = sql.exec<{ score: number; submitted_at: number }>('SELECT score, submitted_at FROM scores WHERE player=?', data.player).toArray()[0];
      const now = Date.now();
      if (row && now - row.submitted_at < 1000) return json({ error: 'Please wait a second before submitting again.' }, 429, { 'Retry-After': '1' });
      if (row && data.score <= row.score) {
        sql.exec('UPDATE scores SET submitted_at=? WHERE player=?', now, data.player);
      } else {
        const sequence = sql.exec<{ next: number }>('SELECT COALESCE(MAX(achieved), 0) + 1 AS next FROM scores').one().next;
        sql.exec('INSERT OR REPLACE INTO scores VALUES (?, ?, ?, ?, ?, ?)', data.player, data.name, data.score, data.day, sequence, now);
      }
      return json({ unverified: true });
    });
  }
}
