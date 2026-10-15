# Hackathon Tycoon: nf-core edition

A browser game where you run an nf-core hackathon for as long as you can.

- Hackers write modules at 💻 tables. Review their PRs in Slack: rushed ones break CI later.
- Merge a pipeline's modules, then build it. Each built pipeline burns CI minutes, and test runs cost compute until you release v1.0.0. After that, runs and outside users pay. `-profile test_full` gets you there sooner for more compute.
- Red CI needs a person. Send a hacker, or hire a maintainer. Failed runs still burn compute.
- Keep everyone fed, caffeinated and happy. The sponsor grant each night follows your reputation.
- Don't build everything at once. End two days in a row in debt and the hackathon is over.

## Play

Play online at <https://adamrtalbot.github.io/hackerthon-tycoon/>, or open `index.html` in a browser. No build step or dependencies.

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

Policies: `good` plays carefully, `build` builds every pipeline as fast as it can, `rush` also approves every PR and hires staff, `idle` does nothing. Each snapshot line shows day, time, credits, hackers, happiness, reputation, pipelines (`*` released, `!` red), modules, red modules and score, followed by that day's ledger.
