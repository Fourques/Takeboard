# Changelog

TakeBoard follows [Semantic Versioning](https://semver.org/) from the first public preview. Until
1.0, project packages and database migrations remain forward-oriented: always keep a verified backup
before moving production work to a newer minor version.

## 0.1.0 — 2026-08-29

First self-hosted public preview.

### Added

- A project canvas for assets, shots, semantic connections, generation runs and approved takes.
- Native and explicitly bound ComfyUI workflows with dependency diagnostics and content hashes.
- Real ComfyUI progress, cancellation, reconnect recovery and result provenance.
- Streaming, integrity-checked `.takeboard.tgz` project export and import.
- Automatic pre-migration SQLite backups with rollback when a migration fails.
- Cross-platform easy launchers, SSH remote access and guarded local ComfyUI start.
- Recoverable project deletion, workflow archiving and command history with undoable operations.

### Security and release boundary

- The API listens on loopback by default and rejects unapproved Host and Origin values.
- There is no account or multi-tenant permission system. Public internet exposure is unsupported;
  remote access requires SSH or an authenticated reverse proxy.
- This version is intended for individual creators and trusted teams as a Public Preview, not as a
  hosted multi-user production service.
