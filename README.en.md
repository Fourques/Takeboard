# TakeBoard

<p align="right">English · <a href="README.md">简体中文</a></p>

<p align="center">
  <strong>Assets, shots, workflows and every generation run—on one director's board.</strong><br />
  An open-source, local-first AI filmmaking workspace for ComfyUI creators.
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-315EFB.svg" /></a>
  <a href="https://github.com/Fourques/Takeboard/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Fourques/Takeboard?include_prereleases&label=public%20preview&color=D99A46" /></a>
</p>

![TakeBoard project hub](docs/assets/takeboard-home.webp)

TakeBoard does not replace ComfyUI's node editor. It adds the production layer around it: projects,
assets, semantic shot inputs, reproducible runs, candidate takes and approvals. Optional studio tools,
including a read-only rough cut, stay out of the core workspace until you enable them. Models,
workflows, media and project files stay on infrastructure you control.

## What works today

- A visual project hub and per-project React Flow canvas.
- Original image/video ingest without destructive cropping or resolution changes.
- First-frame, last-frame, reference-image, reference-video and reference-audio connections.
- Built-in Recipes plus explicit, content-hash-bound mappings for trusted custom ComfyUI workflows.
- Text-to-image, image-to-image, text/image-to-video and first/last-frame video execution paths.
- Real ComfyUI node progress when available, honest indeterminate states otherwise, cancellation,
  reconnect reconciliation and output provenance.
- Core Run/Take review, rejection, single-shot approval and storyboard coverage.
- Local, SSH-tunnel and HTTPS ComfyUI workers with explainable privacy, speed, cost, quality and
  per-run budget policies.
- Bundled, disabled-by-default extensions for rough-cut playback, exact/estimated/unknown cost
  summaries, atomic cross-shot approval and delivery QC.
- A declarative extension library for controlled workspace features, team QC rules and external tool
  links; third-party code is not executed.
- Recoverable project deletion, integrity-checked project import/export and pre-migration backups.
- Accounts, device sessions, instance admins and project Owner/Editor/Viewer roles.
- Cross-project task/storage center and a redacted downloadable support report.
- Optional scheduled off-volume instance backups with retention and isolated restore drills.
- User-selectable type scaling without changing canvas coordinates or generation resolution.

## Quick start

For the lowest-friction preview, download the `takeboard-*.tar.gz` matching your OS and CPU from
[Releases](https://github.com/Fourques/Takeboard/releases). Portable bundles include a matching
Node.js runtime: extract, then open `START-TAKEBOARD.command` on macOS,
`START-TAKEBOARD.cmd` on Windows, or `./start-takeboard.sh` on Linux. They include SHA-256 checksums
and GitHub build-provenance attestations, but are not yet Apple-notarized or Windows code-signed.

```bash
gh attestation verify takeboard-*.tar.gz --repo Fourques/Takeboard
```

The source launcher requires Node.js `>=22.12 <27`; ComfyUI is optional until you want real
generation.

| Platform | First and daily start |
| --- | --- |
| macOS | Right-click `START-TAKEBOARD.command` and choose Open |
| Windows | Double-click `START-TAKEBOARD.cmd` |
| Linux | Run `npm run easy:setup`, then `npm run easy` |

The easy launcher installs dependencies, rebuilds stale sources, selects a free local port, starts the
service in the background and opens the browser. Projects default to `~/TakeBoardData`. Diagnose a
failed start with:

```bash
npm run easy:doctor
```

Developer setup:

```bash
git clone https://github.com/Fourques/Takeboard.git
cd Takeboard
corepack enable
pnpm install --frozen-lockfile
./scripts/takeboard dev
```

Open <http://127.0.0.1:48110>.

## Remote use

Keep TakeBoard and ComfyUI on loopback. From a Mac, Windows or Linux client, create a standard SSH
tunnel with the helper:

```bash
npm run easy:remote -- your-server
```

The helper detects the remote TakeBoard port, selects a free local port, opens the correct URL and
releases the tunnel when it exits. A Tailscale hostname works because the transport is still ordinary
SSH; Tailscale is not required. See [remote access](docs/remote-access.md).

## Custom workflows: an explicit trust boundary

A ComfyUI UI Workflow JSON is not automatically an executable API Prompt. TakeBoard imports and
diagnoses arbitrary UI workflows, but direct execution requires an explicit Binding that identifies
prompt, media, seed, size, duration and output nodes. The Binding is tied to the Workflow SHA-256;
editing the graph invalidates stale trust. Missing models/nodes and unsupported inputs are blocked
before a generation is queued.

This is intentional: third-party Custom Nodes can execute arbitrary Python and workflows may perform
file or network operations. TakeBoard never auto-installs them.

## Workers, costs and extensions

Instance administrators can add remote ComfyUI workers from the home-page compute panel. Plain HTTP
is accepted only through a loopback SSH tunnel; direct remote connections require HTTPS. New workers
cannot receive image, video or audio inputs until an administrator explicitly grants that permission.
The standard ComfyUI API has no portable endpoint for deleting uploaded inputs, so remote workers
should use an isolated input directory with their own retention and cleanup policy. Every
run records the selected worker, all considered candidates and the reason for each inclusion or
rejection. A configured hourly rate produces an estimate; missing rates remain unknown rather than
being reported as zero, and currencies are never silently combined.

Run provenance is always retained, but rough-cut preview, cost insights, batch review and delivery QC
are bundled opt-in extensions and are disabled by default. Enabling cost insights exposes honest
exact, estimated and unknown totals; enabling batch review adds revision-checked atomic decisions
across shots. When disabled, those views and service endpoints stay out of the core workflow. The
extension library accepts only validated, content-hash-confirmed declarative manifests for controlled
workspace features, QC rules and HTTP(S) links. Imported extensions are disabled by default and
cannot run JavaScript, Python or shell commands. See
[extension development and trust](docs/extensions.md).

## Data and security boundary

Each project is a self-contained `.takeboard` directory containing SQLite state, original assets,
renders, runs, Recipes, logs and backups. Full project archives are streamed with file sizes and
SHA-256 integrity checks.

Administrators can optionally schedule full-instance copies to a mounted external disk or NAS.
TakeBoard verifies each copy, applies daily/weekly/monthly retention, and periodically performs a
real isolated restore that opens the identity database and every project. Automation is disabled
until an out-of-data-root destination is explicitly configured.

Authentication is required by default and the server listens on `127.0.0.1`. Trusted teams can deploy
behind an HTTPS reverse proxy with strict Host/Origin configuration. The 0.x preview is not a managed
multi-tenant SaaS identity platform: MFA, SSO/SCIM, email recovery, quotas and managed security
operations are out of scope. Never expose the ComfyUI port publicly. See [security](SECURITY.md) and
[self-hosting](docs/self-hosting.md).

## Quality gates

```bash
pnpm verify       # lint + typecheck + build + unit/integration tests
pnpm test:e2e     # production Playwright journeys
pnpm gate:release # full release gate, including 40-run and 500-node checks
pnpm gate:gpu     # one private real-GPU end-to-end check against a running instance
```

The CI matrix installs and verifies on Linux, macOS and Windows, then runs the production browser
journey on Chromium.

## Project status

TakeBoard is a public preview suitable for individual creators and trusted self-hosted teams. It is
not yet a signed desktop application or a hosted public SaaS. See the honest
[maturity assessment](docs/maturity-audit-2026-08-30.md), [roadmap](docs/roadmap.md) and
[changelog](CHANGELOG.md).

Use the [issue chooser](https://github.com/Fourques/Takeboard/issues/new/choose) for bugs, feature
requests and Workflow compatibility reports. Read [CONTRIBUTING.md](CONTRIBUTING.md) before a larger
change and report vulnerabilities privately under [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
