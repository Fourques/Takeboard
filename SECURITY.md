# Security policy

TakeBoard 0.1.x is a self-hosted Public Preview and listens on `127.0.0.1` by default. The server
refuses a non-loopback bind unless the operator explicitly sets `TAKEBOARD_ALLOW_NON_LOOPBACK=1`,
and rejects unapproved `Host` and browser `Origin` values to reduce DNS-rebinding and cross-site
request risks.

Please do not report vulnerabilities through public issues. Until a dedicated security address is
published, contact the repository owner privately. Include the affected version, reproduction steps,
and impact, but never include real API keys, cookies, private media, or access tokens.

TakeBoard does not auto-install ComfyUI custom nodes. A custom node is arbitrary Python code and must
be reviewed and installed by the machine owner. Remote access must use an authenticated tunnel or
reverse proxy; exposing the TakeBoard or ComfyUI ports directly to the internet is unsupported.

`TAKEBOARD_ALLOW_NON_LOOPBACK=1` does not add authentication. When an authenticated reverse proxy is
required, configure its exact public hostname and origin with `TAKEBOARD_ALLOWED_HOSTS` and
`TAKEBOARD_ALLOWED_ORIGINS`, keep the TakeBoard upstream private, and enforce authentication at the
proxy. SSH forwarding remains the recommended personal remote-access path.

Imported project packages are treated as untrusted data. TakeBoard extracts them into an isolated
staging directory, rejects links and path traversal, verifies every declared size and SHA-256 digest,
and opens the database before publishing the project. Imported ComfyUI workflows are not executable
until their bindings and dependencies have been explicitly inspected and trusted.
