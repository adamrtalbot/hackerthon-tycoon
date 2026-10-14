# Hackathon Tycoon: nf-core edition

A browser game where you run an nf-core hackathon for as long as you can.

- Hackers write modules at 💻 tables. Review their PRs in Slack: rushed ones break CI later.
- Merge a pipeline's modules, then build it. Each built pipeline burns CI minutes, and test runs cost compute until you release v1.0.0. After that, runs and outside users pay. `-profile test_full` gets you there sooner for more compute.
- Red CI needs a person. Send a hacker, or hire a maintainer. Failed runs still burn compute.
- Keep everyone fed, caffeinated and happy. The sponsor grant each night follows your reputation.
- Don't build everything at once. End two days in a row in debt and the hackathon is over.

## Play

Open `index.html` in a browser. No build step or dependencies.

## Controls

- `R`: rotate a pipeline while placing it
- `Esc`: cancel the current action

Your best score is saved in `localStorage`.
