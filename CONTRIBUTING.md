# Contributing to TakeBoard

TakeBoard is a local-first public preview for individual AI filmmakers and trusted self-hosted teams.
Contributions are welcome when they make the creator workflow safer, clearer or more compatible
without weakening ownership of local media and ComfyUI infrastructure.

## Before opening code

- Use the issue chooser for a reproducible bug, feature proposal or ComfyUI Workflow compatibility
  report. Discuss large product or schema changes before implementing them.
- Security reports, credentials and private media never belong in public issues. Follow
  [SECURITY.md](SECURITY.md).
- Keep a pull request focused on one user-visible outcome. Explain what changes, what does not, and
  how failure behaves.

## Development setup

Use Node.js 24 LTS and the exact pnpm version declared in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

For browser journeys, install Chromium once and run the release gate:

```bash
pnpm exec playwright install chromium
pnpm gate:release
```

A system Chrome can be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome`. A real GPU run is separate and must
use a private test project: `pnpm gate:gpu`.

## Engineering contract

- Keep canvas layout state separate from Project, Shot, Run, Take and Approval domain data.
- Validate data at API and persistence boundaries with the shared contracts; migrations must create a
  recoverable backup before changing user data.
- Every behavior change needs a narrow unit/integration test and, when it affects a creator journey,
  a Playwright assertion.
- Never export API keys, cookies, tokens, environment values, absolute paths, prompts or private media
  in diagnostics. Project exports contain media by explicit user action and must keep their integrity
  manifest.
- Do not execute an imported Workflow merely because its filename resembles a built-in Recipe.
  Executable custom workflows require content-hash-bound parameter mappings, dependency validation and
  explicit trust.
- Do not auto-install ComfyUI Custom Nodes or models. They execute third-party code and remain an
  operator decision.
- Never present timers or estimates as real generation progress. Unknown progress stays indeterminate.
- Cancellation, deletion, restore and retry operations must remain idempotent.

Product, security, persistence and architecture changes require a concise entry in
`docs/decisions.md`. Update README, changelog and user documentation when public behavior changes.

## Pull request checklist

The pull request template asks for the affected journey, test evidence, data/security impact and
screenshots where layout changes. CI runs install, lint, typecheck, unit/integration tests and builds on
Linux, macOS and Windows, followed by a production Chromium journey.
