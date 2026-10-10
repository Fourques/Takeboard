# Security policy

TakeBoard 0.x is a self-hosted Public Preview and listens on `127.0.0.1` by default. Local use defaults
to optional account login; device access uses its own local identity and session, while account-owned
projects remain protected. The server refuses a non-loopback bind unless authentication is required and
the operator explicitly sets `TAKEBOARD_ALLOW_NON_LOOPBACK=1`; it also rejects unapproved `Host` and
browser `Origin` values to reduce DNS-rebinding and cross-site request risks.

Please do not report vulnerabilities through public issues. Use the repository's
[private security advisory form](https://github.com/Fourques/Takeboard/security/advisories/new).
Include the affected version, reproduction steps and impact, but never include real API keys,
cookies, private media or access tokens unless the maintainer explicitly provides a secure transfer
method.

TakeBoard does not auto-install ComfyUI custom nodes. A custom node is arbitrary Python code and must
be reviewed and installed by the machine owner. Remote access must use an authenticated tunnel or
reverse proxy; exposing the TakeBoard or ComfyUI ports directly to the internet is unsupported.

For an HTTPS reverse proxy, configure its exact public hostname and origin with
`TAKEBOARD_ALLOWED_HOSTS` and `TAKEBOARD_ALLOWED_ORIGINS`, set `TAKEBOARD_SECURE_COOKIES=1`, and keep
ComfyUI private. TakeBoard stores high-cost scrypt password hashes and opaque server-side sessions;
cookies are HttpOnly and SameSite, unsafe requests require a per-session CSRF token, and project
authorization is enforced on the server. SSH forwarding remains the simplest personal path.

The optional TakeBoard Portal is a separate self-hosted service. Public first-run setup requires a
deployment-held high-entropy bootstrap token; each workstation then uses a one-time pairing code and
an independent device credential over an outbound-only connection. Portal cookies and authorization
headers are never forwarded to the workstation, and the local TakeBoard account remains the final
authorization boundary. The Portal does not persist project or media payloads, but it terminates TLS
and can technically observe relayed content in memory. It must not be described as end-to-end
encrypted. Protect the Portal database and master key as one secret-bearing backup set, use wildcard
HTTPS for its device subdomains, and review [the self-hosting guide](docs/portal-self-hosting.md).

The built-in account system is intended for a self-hosted creator or trusted production team. It is
not yet an enterprise identity platform: 0.x does not include MFA, email-based recovery, SSO/SCIM,
tenant billing/quotas, or a managed security operations service. Public Preview operators remain
responsible for TLS, backups, host patching, log review, and account recovery.

Imported project packages are treated as untrusted data. TakeBoard extracts them into an isolated
staging directory, rejects links and path traversal, verifies every declared size and SHA-256 digest,
and opens the database before publishing the project. Imported ComfyUI workflows are not executable
until their bindings and dependencies have been explicitly inspected and trusted.

## Media and build dependency review — 2026-10-10

The current source and lockfiles contain these security fixes:

| Dependency | Fixed version | Advisory / reason |
| --- | --- | --- |
| sharp / bundled librsvg | 0.35.5 / 2.63.2 | [GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w): unsafe native SVG decoding |
| @fastify/busboy | 3.2.2 | [GHSA-gxm5-99cw-xjw9](https://github.com/fastify/busboy/security/advisories/GHSA-gxm5-99cw-xjw9): multipart names can contain bare CR/LF |
| source-map-js | 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): oversized indexed source maps can exhaust resources during builds |
| tauri-utils / urlpattern | 2.10.1 / 0.6.0 | Removes five unmaintained `unic-*` dependencies without forcing an incompatible override |

The two sharp Dependabot entries refer to the same issue in the package manifest and lockfile,
not two independent vulnerabilities. Fastify remains at 5.12.5; the earlier brace-expansion and
fast-uri security floors remain in effect. Security and installer publication workflows now audit
**all Node.js dependencies**, including build tools, with no advisory suppressions and a low-severity
failure threshold. The scheduled audit also scans the complete desktop lockfile against RustSec;
new vulnerabilities and unreviewed memory-safety advisories fail the check. The existing bounded
GTK exception remains visible, as do unmaintained-package warnings.

Validation on 2026-10-10:

- Full Node.js dependency audit: zero known vulnerabilities. Native sharp reports librsvg 2.63.2;
  regression tests cover ordinary SVG/PNG/JPEG/WebP decoding, malformed multipart names and
  oversized/nested source-map offsets in a memory- and time-bounded subprocess.
- Lint, type checks, builds and all package/application/script tests passed. Browser functional
  regressions passed 70 cases; one real-GPU case was skipped. Existing ComfyUI services were untouched.
- An isolated production deployment passed the desktop runtime lifecycle gate, including loaded
  sharp, librsvg and multipart versions. This is not a newly built native installer.
- A full RustSec scan with cargo-audit 0.22.2, using the advisory database updated on 2026-10-09,
  reported zero vulnerability entries and **two unresolved warnings**: `glib 0.18.5`
  (RUSTSEC-2024-0429, unsoundness) and `proc-macro-error 1.0.4` (RUSTSEC-2024-0370, unmaintained).
  Both remain in the Linux GTK3 chain. The latter is required by GTK3/glib proc macros;
  it cannot be replaced by a different-major macro crate through a safe lockfile update.
  A zero vulnerability count must not be presented as a warning-free Rust dependency tree.
- The upgraded desktop passed Linux `cargo check` using isolated development libraries, with
  deprecated URL-opening calls removed; all six native Rust unit tests passed, including URL and
  native-action origin restrictions.
- [beta.20 installer publication](https://github.com/Fourques/Takeboard/actions/runs/38028293338)
  subsequently passed for all six OS/CPU targets. macOS disk images were mounted read-only;
  Windows and Debian packages were installed in CI. Each final package passed the bundled-runtime
  version and lifecycle checks, and its SHA-256 was checked before publication. This verifies the
  packaged runtime, not native UI behavior or real-GPU generation on all six targets.

**[Published beta.20 installers](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.20)
contain these fixes; beta.19 and older installers do not.** Desktop users should install beta.20;
source deployments must reinstall
from the updated lockfile and restart, and container deployments must rebuild. Hosts using a system
libvips/librsvg instead of sharp's bundled libraries must independently install librsvg 2.63.2 or later.
The installed-runtime gate now checks the actual native SVG library and multipart parser so that
stale packaged dependencies cannot pass merely because a source manifest has changed.

## Fastify dependency review — 2026-10-02 (historical)

Server (including the same-GPU gateway) and Portal now pin Fastify **5.12.5**. The shared lockfile
contains that version. The upgrade covers the following upstream advisories:

| Advisory | Affected behavior | Current source review |
| --- | --- | --- |
| [GHSA-9q9j-q6p8-xq58](https://github.com/fastify/fastify/security/advisories/GHSA-9q9j-q6p8-xq58) | Mixed-case header-schema dependencies can bypass validation | Security headers are checked explicitly; no affected Fastify header Schema was found |
| [GHSA-hwr6-493r-vm6h](https://github.com/fastify/fastify/security/advisories/GHSA-hwr6-493r-vm6h) | Boolean `false` request schemas are skipped | No deny-all boolean request Schema was found |
| [GHSA-p68q-wchp-6fh7](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7) | Malformed URLs can reach a sibling's protected not-found handler | Server has a public SPA fallback, but no sibling private fallback; Portal authenticates device requests in its explicit route |
| [GHSA-667r-xxjv-c9mm](https://github.com/fastify/fastify/security/advisories/GHSA-667r-xxjv-c9mm) | Async validation can replace the body with attacker-controlled `value` or interpret its `error` | No `$async` Fastify request Schema or custom validation compiler was found; route data uses explicit parsing and checks |
| [GHSA-4mh8-r7rc-xpvc](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc) | HTTP/2 responses with trailers can terminate Node.js | No HTTP/2 Fastify configuration or `reply.trailer()` usage was found |

These observations narrow the known exposure; they do not justify retaining an affected dependency.
Behavioral tests in `scripts/fastify-security.test.mjs` exercise all five cases against each
application's resolved Fastify, including a real isolated HTTP/2 connection and a follow-up health
request. App tests also verify malformed URL rejection, server API authentication and SPA fallback,
and Portal device authentication. The scheduled audit runs these regressions alongside the package
audit, without suppressing the five advisories.

Validation on 2026-10-02:

- Production and full dependency audits both reported zero known Node.js vulnerabilities after
  the upgrade (before: four high and one moderate Fastify advisory).
- Lint, type checks, builds, all application/package tests and script tests passed. Browser regression
  tests passed 70 cases; one real-GPU case was skipped. No live ComfyUI service was changed.
- Temporary production deployments made with the desktop server and Portal deployment commands
  both resolved Fastify 5.12.5 and passed the ten advisory regressions. This verifies dependency
  packaging, not a newly built native installer or a running container.
- An isolated 5.12.1 baseline failed all five regression cases. Its malformed-URL request timed out;
  this fixture did not reproduce a private-data leak. Its HTTP/2 trailer subprocess terminated,
  and its async-validation fixture replaced the validated body. Fixed-version cases passed.

**Published beta.19 installers contain Fastify 5.12.5.** All six platform/architecture builds passed
their final installed or mounted runtime checks in
[release run 36962531345](https://github.com/Fourques/Takeboard/actions/runs/36962531345), including
execution of the packaged Node to verify its Fastify version. The
[main security audit](https://github.com/Fourques/Takeboard/actions/runs/36962510886) also passed.

Previously published beta.18 installers still contain Fastify 5.12.1. A source update does not patch
an already installed app or an existing Portal container. Desktop users must install beta.19 or later;
remote deployments must update their source and dependencies (or rebuild their container) and restart
through their normal service management. Updating a desktop app does not upgrade a remote deployment.

## Known upstream advisory

Rechecked on 2026-10-10, the **Linux desktop preview only** still inherits
[RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
through Tauri's `wry -> webkit2gtk/gtk -> glib 0.18.5` stack. The affected API is
`glib::VariantStrIter`; TakeBoard does not call it, and a source-tree reachability search found no
reference to that API in TakeBoard code. The Web app, server, Portal,
macOS desktop and Windows desktop do not use this Linux GTK dependency.

The advisory is fixed in `glib >= 0.20`, but the current stable Wry Linux backend still depends on
GTK3 crates that require the 0.18 line. Wry's
[GTK4/WebKitGTK 6 migration](https://github.com/tauri-apps/wry/issues/1474) remains open, with its
[implementation pull request](https://github.com/tauri-apps/wry/pull/1530) still in draft. TakeBoard
will not replace a stable desktop dependency with an unaudited fork merely to silence the scanner.
The bounded exception is machine-readable in `security/rust-advisory-exceptions.json`: CI verifies
the exact dependency version, searches TakeBoard Rust sources for the affected API and rejects the
exception after 2026-12-15. It must also be reviewed before each release and after every Tauri/Wry
update. Once the stable stack supports `glib >= 0.20`, upgrading it is a release blocker. Until then,
the Linux desktop artifact remains explicitly labeled an unsigned preview and is excluded from the
signed production workflow.
