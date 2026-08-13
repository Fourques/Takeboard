# Contributing to TakeBoard

TakeBoard is in its M0 feasibility phase. Contributions should strengthen the single golden
path documented in [START-HERE](START-HERE.md); feature expansion is intentionally deferred.

## Local quality gate

Use Node.js 24 LTS and the pnpm version declared in `package.json`.

```bash
pnpm install
pnpm verify
```

## M0 contribution rules

- Keep canvas layout types separate from domain objects.
- Do not add a cloud provider, Agent, timeline, or desktop wrapper during M0.
- Every behavior change needs an automated test at the narrowest useful level.
- Never write API keys, cookies, tokens, or absolute user paths to exported projects.
- Do not auto-install ComfyUI custom nodes.

Product and architecture changes require a new entry in `docs/decisions.md`.
