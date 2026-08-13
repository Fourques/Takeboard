# Security policy

TakeBoard is in an early alpha phase and is intended to listen on `127.0.0.1` by default.

Please do not report vulnerabilities through public issues. Until a dedicated security address is
published, contact the repository owner privately. Include the affected version, reproduction steps,
and impact, but never include real API keys, cookies, private media, or access tokens.

TakeBoard does not auto-install ComfyUI custom nodes. A custom node is arbitrary Python code and must
be reviewed and installed by the machine owner. Remote access must use an authenticated tunnel or
reverse proxy; exposing the TakeBoard or ComfyUI ports directly to the internet is unsupported.
