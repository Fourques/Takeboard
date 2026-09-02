# Security policy

TakeBoard 0.x is a self-hosted Public Preview and listens on `127.0.0.1` by default. Authentication
is required by default. The server refuses a non-loopback bind unless authentication is required and
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

## Known upstream advisory

As of 2026-09-02, the **Linux desktop preview only** inherits
[RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
through Tauri's `wry -> webkit2gtk/gtk -> glib 0.18.5` stack. The affected API is
`glib::VariantStrIter`; TakeBoard does not call it, and a source-tree reachability search found no
reference to that API in TakeBoard code. The Web app, server, Portal, portable distributions,
macOS desktop and Windows desktop do not use this Linux GTK dependency.

The advisory is fixed in `glib >= 0.20`, but the current stable Wry Linux backend still depends on
GTK3 crates that require the 0.18 line. Wry's
[GTK4/WebKitGTK 6 migration](https://github.com/tauri-apps/wry/issues/1474) remains open, with its
[implementation pull request](https://github.com/tauri-apps/wry/pull/1530) still in draft. TakeBoard
will not replace a stable desktop dependency with an unaudited fork merely to silence the scanner.
The Dependabot alert remains open and this exception must be reviewed before each release and after
every Tauri/Wry update. Once the stable stack supports `glib >= 0.20`, upgrading it is a release
blocker. Until then, the Linux desktop artifact remains explicitly labeled an unsigned preview.
