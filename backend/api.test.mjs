import { unstable_startWorker } from 'wrangler';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let worker, persistence;
const token = n => n.toString(16).padStart(64, '0');
const replay = { version: 1, seed: 4294967295, steps: 10, commands: [{ step: 0, act: 'start', arg: '' }, { step: 10, act: 'nextday', arg: '' }] };
const start = () => unstable_startWorker({
  dev: {
    experimentalNewConfig: true, remote: false, persist: persistence,
    watch: false, server: { hostname: '127.0.0.1', port: 0 }, inspector: false,
  },
});
before(async () => { persistence = await mkdtemp(join(tmpdir(), 'tycoon-api-')); worker = await start(); });
after(async () => { await worker?.dispose(); await rm(persistence, { recursive: true, force: true }); });
const call = async (path, { player = 1, method = 'GET', value, headers = {}, ...options } = {}) => fetch(new URL(path, await worker.url), {
  method, headers: { Authorization: `Bearer ${token(player)}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }), ...options,
});
async function expectError(response, status) {
  if (response.status !== status) assert.fail(`Expected ${status}, received ${response.status}: ${await response.text()}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(typeof (await response.json()).error, 'string');
}
const wait = () => new Promise(resolve => setTimeout(resolve, 1100));

test('private saves isolate players and atomically reject concurrent stale revisions', async () => {
  assert.deepEqual(await (await call('/api/save')).json(), { revision: 0, save: null });
  const responses = await Promise.all([0, 1].map(() => call('/api/save', { method: 'PUT', value: { revision: 0, save: replay } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const saved = await (await call('/api/save')).json();
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.save, replay);
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.deepEqual(await (await call('/api/save', { player: 2 })).json(), { revision: 0, save: null });
  await expectError(await call('/api/save', { method: 'PUT', value: { revision: 0, save: replay } }), 409);
  assert.equal((await call('/api/save', { method: 'PUT', value: { revision: 1, save: replay } })).status, 200);
});

test('HTTP errors, JSON requirements, origin and authorization boundaries', async () => {
  await expectError(await call('/api/save', { headers: { Authorization: '' } }), 401);
  await expectError(await call('/api/save', { headers: { Authorization: `Bearer ${'A'.repeat(64)}` } }), 401);
  await expectError(await call('/api/missing'), 404);
  await expectError(await call('/api'), 404);
  for (const [path, method] of [['/api/save', 'POST'], ['/api/score', 'GET'], ['/api/leaderboard', 'DELETE']]) {
    await expectError(await call(path, { method }), 405);
  }
  await expectError(await call('/api/save', { method: 'PUT', value: {}, headers: { Origin: 'https://other.example' } }), 403);
  await expectError(await call('/api/save', { method: 'PUT', value: {}, headers: { 'Content-Type': 'text/plain' } }), 415);
  for (const raw of ['null', '[]', '{']) {
    await expectError(await call('/api/save', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw }), 400);
  }
  const publicResponse = await call('/api/leaderboard', { headers: { Authorization: '' } });
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('access-control-allow-origin'), null);
});

test('validates every replay field and streamed body byte limit without Content-Length', async () => {
  const invalid = [null, {}, { ...replay, version: 2 }, { ...replay, seed: -1 }, { ...replay, seed: 4294967296 },
    { ...replay, steps: 250001 }, { ...replay, steps: 1.5 }, { ...replay, commands: {} },
    { ...replay, commands: Array(10001).fill({ step: 0, act: 'start', arg: '' }) },
    ...[{ step: 11, act: 'start', arg: '' }, { step: -1, act: 'start', arg: '' }, { step: 1, act: 'unknown', arg: '' },
      { step: 0, act: 'start', arg: 1 }, { step: 0, act: 'start', arg: 'x'.repeat(81) }, null].map(c => ({ ...replay, commands: [c] })),
    { ...replay, commands: [{ step: 2, act: 'start', arg: '' }, { step: 1, act: 'start', arg: '' }] }];
  for (const save of invalid) await expectError(await call('/api/save', { method: 'PUT', value: { revision: 2, save } }), 400);
  for (const revision of [-1, 0.5, '0', null]) await expectError(await call('/api/save', { method: 'PUT', value: { revision, save: replay } }), 400);
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < 9; i++) controller.enqueue(new TextEncoder().encode(' '.repeat(65536)));
    controller.close();
  } });
  await expectError(await call('/api/save', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' }), 413);
  // Wrangler's local HTTP proxy may reuse a closed upstream socket after an early body rejection.
  // A safe GET reconnects it (the proxy retries GETs), without ever retrying a mutation.
  assert.equal((await call('/api/save')).status, 200);
});

test('leaderboard validates input, limits cadence, keeps best scores and deterministic achievement ties', async () => {
  const score = { name: '  First  ', score: 100, day: 2 };
  for (const value of [{ ...score, name: '' }, { ...score, name: 'x'.repeat(25) }, { ...score, name: 'a\nb' },
    { ...score, score: -1 }, { ...score, score: 100000001 }, { ...score, score: 1.2 }, { ...score, day: 0 }, { ...score, day: 10001 }]) {
    await expectError(await call('/api/score', { method: 'POST', value }), 400);
  }
  assert.equal((await call('/api/score', { method: 'POST', value: score })).status, 200);
  await expectError(await call('/api/score', { method: 'POST', value: score }), 429);
  assert.equal((await call('/api/score', { player: 2, method: 'POST', value: { name: 'Second', score: 100, day: 1 } })).status, 200);
  await wait();
  assert.equal((await call('/api/score', { method: 'POST', value: { name: 'Lower', score: 99, day: 5 } })).status, 200);
  let board = await (await call('/api/leaderboard')).json();
  assert.deepEqual(board, { entries: [{ name: 'First', score: 100, day: 2 }, { name: 'Second', score: 100, day: 1 }], unverified: true });
  await wait();
  await call('/api/score', { method: 'POST', value: { name: 'Equal', score: 100, day: 9 } });
  assert.deepEqual(await (await call('/api/leaderboard')).json(), board);
  await wait();
  await call('/api/score', { method: 'POST', value: { name: 'Improved', score: 101, day: 3 } });
  for (let player = 3; player <= 23; player++) {
    assert.equal((await call('/api/score', { player, method: 'POST', value: { name: `Player ${player}`, score: player, day: 1 } })).status, 200);
  }
  board = await (await call('/api/leaderboard')).json();
  assert.equal(board.entries.length, 20);
  assert.deepEqual(board.entries[0], { name: 'Improved', score: 101, day: 3 });
  assert.equal(board.entries[1].name, 'Second');
  assert.equal(board.entries[19].score, 6);
  for (const entry of board.entries) assert.deepEqual(Object.keys(entry).sort(), ['day', 'name', 'score']);
});

test('SQLite saves and rankings survive a native runtime restart; build exposes only intended assets', async () => {
  const before = await (await call('/api/leaderboard')).json();
  await worker.dispose();
  worker = await start();
  assert.equal((await (await call('/api/save')).json()).revision, 2);
  assert.deepEqual(await (await call('/api/leaderboard')).json(), before);
  assert.equal((await call('/')).status, 200);
  assert.ok((await (await call('/')).text()).includes('<html'));
  const assets = await readdir('dist');
  assert.ok(assets.includes('index.html'));
  assert.ok(assets.every(name => ['index.html', 'cloud.js', 'replay.js'].includes(name)));
  assert.equal((await call('/backend/worker.ts')).status, 404);
});
