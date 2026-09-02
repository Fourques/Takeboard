# Changelog

TakeBoard follows [Semantic Versioning](https://semver.org/) from the first public preview. Until
1.0, project packages and database migrations remain forward-oriented: always keep a verified backup
before moving production work to a newer minor version.

## Unreleased

### Added

- A self-hosted TakeBoard Portal with real accounts, one-time workstation pairing, outbound-only
  connectors, device presence, remote HTTP/Range relay, explicit portal-to-local identity mapping,
  immediate revocation and security activity.
- A Tauri 2 desktop preview that embeds the production server, Web UI and matching Node.js sidecar,
  uses an isolated loopback port, enforces one application instance and cleans up owned processes.
- Explicit square PNG, Windows ICO and macOS ICNS bundle icons so every native packager uses the
  same TakeBoard identity.
- Six native desktop build jobs for macOS Intel/Apple Silicon, Windows x64/arm64 and Linux x64/arm64,
  using one dependable preview format per platform (DMG, NSIS and Deb), installer checksums and
  GitHub build attestations. Six-architecture portable archives remain available alongside them.
- A path-aware desktop pull-request gate that builds and verifies the embedded production runtime,
  then performs a locked Rust compile before changes can reach the release matrix.
- An isolated 500-node canvas performance gate, separated from the stateful functional browser
  journey so cold shared-runner variance cannot be mistaken for canvas rendering time.
- Viewport-aware canvas rendering keeps off-screen cards out of the DOM while retaining the full
  board model, making large projects cheaper to open, pan and edit.
- Honest Run and project cost records with exact, estimated and unknown accuracy, currency-safe
  aggregation, per-shot summaries and finished-minute visibility.
- Revision-bound approval previews and atomic approval batches spanning multiple shots, including
  replacement impact and approving-account provenance.
- Persistent local/remote ComfyUI worker management, SSH-tunnel and HTTPS transports, explicit
  sensitive-media grants, stable retirement of removed workers and seven explainable scheduling
  policies.
- A declarative extension library with manifest validation, content hashes, permission review,
  disabled-by-default local installs, project QC rules and safe external links.
- Rough-cut preview, cost insights, batch review and delivery QC are now bundled opt-in extensions;
  all four default to disabled and gate both their workspace views and specialized API routes.

### Security

- WebSocket transports now use `ws 8.21.0`, resolving the denial-of-service and memory-disclosure
  advisories reported against 8.18.3. The remaining Linux-only Tauri/GTK advisory is documented in
  `SECURITY.md` with its dependency chain, reachability assessment and mandatory review condition.
- Public Portal bootstrap now requires a deployment-held high-entropy setup token; device secrets
  are stored as digests in the Portal and in a mode-0600 local connector file, while relayed browser
  cookies and authorization headers are replaced by a separately scoped local session.
- The relay rejects cross-origin path confusion, invalid or oversized protocol chunks, unknown
  hosts, insecure public origins and unsafe response cookies; project/media payloads are never
  persisted by the Portal.
- Remote worker URLs reject embedded credentials, query strings and fragments; unencrypted remote
  HTTP is rejected unless an explicit legacy override is set.
- TakeBoard extension manifests cannot execute JavaScript, Python, shell commands or ComfyUI Custom
  Nodes. Arbitrary-code plugins remain outside this release boundary.

## 0.2.0-beta.1 — 2026-08-30

Resilience and distribution preview.

### Added

- Opt-in scheduled full-instance backups to an out-of-data-root volume, with atomic publication,
  source/destination SHA-256 verification, daily/weekly/monthly retention and local-copy limits.
- Real isolated restore drills that read an external copy into a temporary workspace, restore the
  identity database and every project, run SQLite integrity checks, reopen project snapshots and
  retain an auditable report.
- Administrator backup health and actions, including storage-device isolation, damaged-copy status,
  scheduling, restore-drill results, security activity and redacted operations diagnostics.
- Stable per-data-root backup ownership, so multiple TakeBoard instances can safely share one mounted
  backup volume without counting, restoring or pruning one another's recovery points.
- Native portable bundles for Linux, macOS and Windows on x64/arm64, with embedded Node.js,
  post-archive extraction and real HTTP startup smoke tests, checksums and GitHub artifact
  attestations.
- A reproducible production-browser walkthrough, cover image and manifest that explicitly identifies
  deterministic Demo generation instead of presenting it as model-quality evidence.
- GPU Gate v2 and a machine-readable compatibility matrix that only accepts real end-to-end
  evidence bound to a clean Commit, source Workflow, executed Prompt and output-video hashes.
- The first publishable v2 compatibility record: MiniMax H3 T2V on an RTX 4090 and ComfyUI 0.31.0,
  with automated integrity passed and visual quality explicitly left unreviewed.

### Changed

- Production package deployment excludes TakeBoard workspace source/tests, emits a self-contained
  hoisted dependency tree that does not rely on runtime package links, and validates native
  SQLite/image dependencies from the extracted release archive.
- Source and portable launchers keep a stable per-data-root identity, refuse ambiguous process
  ownership and reuse an already-running matching instance instead of spawning duplicates.
- Automated backups keep two recent local snapshots by default; manual snapshots still retain five.
- The earlier RTX 4090 / MiniMax H3 run remains labeled as a pre-v2 historical baseline; only the
  new privacy-checked v2 record contributes to the verified matrix.

### Fixed

- External backup durability now opens files with write-capable handles before `fsync`, so Windows
  can flush archives, metadata, restore reports and scheduler state instead of aborting publication.
- Restore drills no longer create deeply nested scratch data on the backup volume, avoiding Windows
  path-length failures while keeping the external recovery point read-only during validation.
- Portable builds now use pnpm's injected-workspace deployment path and a Windows command-shell
  invocation, avoiding uncached legacy metadata and `.cmd` process-launch failures on clean runners.
- Portable startup converts resolved native dependency paths to standards-compliant `file:` URLs,
  so Windows drive-letter paths load correctly through Node.js's ESM loader.
- Portable production runtime modules use real hoisted package directories rather than pnpm package
  links, preserving transitive native-loader dependencies when Windows archives are extracted.
- Portable shutdown uses a private parent-child control channel so Windows closes the Fastify server
  and its database hooks before the launcher exits, with process-tree termination only as a bounded
  build-smoke fallback.
- Numeric inputs now commit the latest typed draft even when blur and React rendering occur in the
  same frame, preventing cleared duration or dimension fields from reverting to stale values.

### Release boundary

- Portable archives are unsigned previews. Apple notarization, Windows code signing and automatic
  updates remain future gates.
- Scheduled backups are full snapshots, not incremental or deduplicated storage. Operators must
  provision and encrypt the external volume appropriately.
- The compatibility matrix is intentionally sparse until more real hardware/Workflow reports are
  reviewed and committed.

## 0.1.0 — 2026-08-30

First self-hosted public preview.

### Added

- A project canvas for assets, shots, semantic connections, generation runs and approved takes.
- Native and explicitly bound ComfyUI workflows with dependency diagnostics and content hashes.
- Real ComfyUI progress, cancellation, reconnect recovery and result provenance.
- Streaming, integrity-checked `.takeboard.tgz` project export and import.
- Automatic pre-migration SQLite backups with rollback when a migration fails.
- Cross-platform easy launchers, SSH remote access and guarded local ComfyUI start.
- Recoverable project deletion, workflow archiving and command history with undoable operations.
- Server-enforced accounts, device sessions, administrator controls, project roles and security
  activity history, including automatic ownership adoption for existing projects.
- A read-only rough-cut player that sequences approved takes and preserves open shots as timing
  slates without changing source media.
- A redacted runtime support report with data, storage, worker, backup, web-build and exposure
  checks, plus explicit copy/download controls.
- A React crash-recovery surface and actionable offline/SSH connection errors.
- User-controlled display scaling across authentication, project, canvas, inspector, storyboard and
  operations surfaces.

### Fixed

- Windows installation now uses a `better-sqlite3` release with prebuilt Node 24 binaries instead of
  requiring an undeclared Visual Studio C++ toolchain.
- Canvas number fields can remain empty while being corrected; an incomplete draft blocks generation
  instead of silently restoring a leading or stale value.

### Security and release boundary

- The API listens on loopback by default and rejects unapproved Host and Origin values.
- Authentication is required by default; password hashes use scrypt, browser sessions are opaque and
  state-changing requests require a per-session CSRF token.
- This version is intended for individual creators and trusted self-hosted teams. Public HTTPS
  deployment still requires a hardened reverse proxy; MFA, SSO, recovery email and SaaS tenant
  operations are outside the 0.1.x boundary.
