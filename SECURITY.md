# Security policy

TakeBoard 0.1.x is a self-hosted Public Preview and listens on `127.0.0.1` by default. Authentication
is required by default. The server refuses a non-loopback bind unless authentication is required and
the operator explicitly sets `TAKEBOARD_ALLOW_NON_LOOPBACK=1`; it also rejects unapproved `Host` and
browser `Origin` values to reduce DNS-rebinding and cross-site request risks.

Please do not report vulnerabilities through public issues. Until a dedicated security address is
published, contact the repository owner privately. Include the affected version, reproduction steps,
and impact, but never include real API keys, cookies, private media, or access tokens.

TakeBoard does not auto-install ComfyUI custom nodes. A custom node is arbitrary Python code and must
be reviewed and installed by the machine owner. Remote access must use an authenticated tunnel or
reverse proxy; exposing the TakeBoard or ComfyUI ports directly to the internet is unsupported.

For an HTTPS reverse proxy, configure its exact public hostname and origin with
`TAKEBOARD_ALLOWED_HOSTS` and `TAKEBOARD_ALLOWED_ORIGINS`, set `TAKEBOARD_SECURE_COOKIES=1`, and keep
ComfyUI private. TakeBoard stores high-cost scrypt password hashes and opaque server-side sessions;
cookies are HttpOnly and SameSite, unsafe requests require a per-session CSRF token, and project
authorization is enforced on the server. SSH forwarding remains the recommended personal path.

The built-in account system is intended for a self-hosted creator or trusted production team. It is
not yet an enterprise identity platform: 0.1.x does not include MFA, email-based recovery, SSO/SCIM,
tenant billing/quotas, or a managed security operations service. Public Preview operators remain
responsible for TLS, backups, host patching, log review, and account recovery.

Imported project packages are treated as untrusted data. TakeBoard extracts them into an isolated
staging directory, rejects links and path traversal, verifies every declared size and SHA-256 digest,
and opens the database before publishing the project. Imported ComfyUI workflows are not executable
until their bindings and dependencies have been explicitly inspected and trusted.
