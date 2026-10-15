# Hackathon Tycoon: nf-core edition

A browser game where you run an nf-core hackathon for as long as you can.

- Hackers write modules at 💻 tables. Review their PRs in Slack: rushed ones break CI later.
- Merge a pipeline's modules, then build it. Each built pipeline burns CI minutes, and test runs cost compute until you release v1.0.0. After that, runs and outside users pay. `-profile test_full` gets you there sooner for more compute.
- Red CI needs a person. Send a hacker, or hire a maintainer. Failed runs still burn compute.
- Keep everyone fed, caffeinated and happy. The sponsor grant each night follows your reputation.
- Don't build everything at once. End two days in a row in debt and the hackathon is over.
- As the hackathon goes on, unhinged ideas unlock in the Build tab: a Claude license, force-pushing, rewriting Nextflow in Rust and more. Each one helps now and costs you later.

## Play

The original offline game is at <https://adamrtalbot.github.io/hackerthon-tycoon/>. This version adds cloud saves and a shared leaderboard to [adamrtalbot/hackerthon-tycoon](https://github.com/adamrtalbot/hackerthon-tycoon), imported from [b8f2f0f](https://github.com/adamrtalbot/hackerthon-tycoon/commit/b8f2f0fcac5fc60eb6c1337657e7b1e0dade5886).

Open `index.html` to play without a backend, or run the Cloudflare Worker below for cloud features. GitHub Pages alone cannot run the backend. The game and `/api/*` must be served from the same Worker origin; no cross-origin credentials or API keys are embedded in the client.

## Cloud saves and high scores

- Open **Save & scores** from the header, welcome screen, day summary or game-over screen. The game pauses while the panel is open.
- **Save game** stores one game per player. Saves are manual, not automatic. **Load game** restores it paused; press play to continue (or start the next day from its summary).
- Your browser remembers a private, randomly generated recovery code. Expand **Recovery code & another device**, reveal and keep the code somewhere safe, then enter it on another device to continue. Anyone with this code can replace the save or submit scores as you. Losing both browser storage and the code means losing access; there is no email/password account or recovery service.
- A newer save from another tab/device rejects stale writes rather than silently overwriting it. Load the latest save to continue.
- Finish a hackathon, choose a public name, and submit its score. The leaderboard shows the top 20 players, keeping each player's best score. Equal scores rank by who achieved them first.
- **Scores are client-reported and unverified.** Input validation and a one-second per-player submission interval are not anti-cheat or protection against someone generating many identities. Do not use this leaderboard for prizes; add server-authoritative scoring and deployment-level abuse controls first.

## Run locally

Use Node.js 22.18 or newer. The project pins Cloudflare's `cf` CLI beta.

```sh
npm ci
npm run dev
```

`cf dev` uses Wrangler internally as its bundler/local runtime; there is no Vite requirement. It runs local SQLite Durable Objects and stores development data under this project's `.wrangler/`. `wrangler.config.ts` contains build-only settings; `cloudflare.config.ts` owns the Worker and bindings. Both development and production builds copy the three public assets automatically. After editing HTML/client JavaScript, run `npm run build:assets` to update the served assets. Backend edits are watched. `npm run build` validates the full deployment build in `.cloudflare/output/`.

## Deploy to Cloudflare

Keep this deployment independent of personal infrastructure: it needs only its own Worker and two Durable Object namespaces. No tailnet, shared database, DNS zone, personal service binding or infrastructure repository is required. Prefer a dedicated Cloudflare account for account-level isolation; separate Worker names alone do not isolate credentials or billing. No account or custom domain is selected in the checked-in configuration.

Once deployment is approved, explicitly choose the project's Cloudflare account and review `cloudflare.config.ts`. Set `CLOUDFLARE_ACCOUNT_ID` for this project rather than relying on a CLI default from another project; use project-scoped credentials in CI. Keep secrets out of Git (`.env*` and `.dev.vars*` are ignored).

```sh
npm run check
npm test
npm run build
npm run deploy -- --dry-run  # validates locally, uploads nothing, needs no login

# Only when ready to publish to the explicitly selected project account:
export CLOUDFLARE_ACCOUNT_ID='<project-account-id>'
npx cf auth login
npm run deploy
```

The deployment serves the game and API together on the Worker URL printed by `cf`. The `exports.durableObject({ storage: "sqlite" })` declarations create `PlayerSave` and `Leaderboard` namespaces. It does not require KV, D1 or a separate database. Do not rename/delete the classes or change the Worker identity without a data migration. Only `dist/index.html`, `dist/replay.js` and `dist/cloud.js` are served; source, tests and local data are not public assets.

Each player's recovery code is hashed with SHA-256 to select their own Durable Object. Saves use atomic revision checks; the global leaderboard uses an indexed SQLite table. Requests are bounded to 512 KiB. Recovery codes go only in authorization headers, never URLs or public leaderboard entries. Only names, scores and days are published.

Saves store a seeded, fixed-timestep replay rather than serializing live JavaScript functions. This preserves pending Slack actions, timed effects and task callbacks. Version 1 accepts up to 250,000 simulation ticks (about 83 game days) and 10,000 commands. Loading cost grows with game length. Changes to simulation rules, random-call order or the timestep must introduce a new save version and either retain the old replay implementation or explicitly reject old saves. Roll back code and static assets together; keep Durable Object data and export declarations intact. Rolling back to a build that predates cloud support hides cloud features but does not delete saves.

## Tests

```sh
npm run check
npm test                       # HTTP API on local workerd; includes storage restart
npx playwright install chromium
npm run test:browser            # real browser, isolated local Worker on port 8788
```

If Chromium is already installed, set `CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading another copy. Browser tests cover reload/cross-device recovery with pending callbacks, stale-save conflicts, day boundaries, game over, score submission, HTML escaping, keyboard isolation and network/version failures. They use a fresh, non-persistent Durable Object store on every run.

## Controls

- `R`: rotate a pipeline while placing it
- `Esc`: cancel the current action

Your best score is saved in `localStorage`.

## Balance testing

`sim/` has a headless bot for checking balance changes. It needs [uv](https://docs.astral.sh/uv/) and a Playwright Chromium (`uvx playwright install chromium`).

```sh
uv run sim/sim.py good 8 4   # policy, days, runs
uv run sim/ui.py             # screenshots of every panel in sim/shots/
```

Policies: `good` plays carefully, `build` builds every pipeline as fast as it can, `rush` also approves every PR and hires staff, `idle` does nothing, `chaos` plays like `good` and uses every unhinged idea as soon as it unlocks. Each snapshot line shows day, time, credits, hackers, happiness, reputation, pipelines (`*` released, `!` red), modules, red modules, score and the ideas unlocked so far, followed by that day's ledger.
