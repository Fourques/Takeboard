# Download and installation

[Home](../README.en.md) · [简体中文](downloads.md)

## Choose a channel

Status checked on September 9, 2026. Published packages and development builds are not interchangeable.

| Channel | Available packages | Audience |
| --- | --- | --- |
| [Public v0.2.0-beta.1](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.1) | Portable previews with an embedded runtime for six OS/CPU combinations; not native installers | Users trying a published preview |
| [Desktop check](https://github.com/Fourques/Takeboard/actions/workflows/desktop-check.yml) | Newer Mac ARM64 DMG and Windows x64 NSIS test installers; retained for 14 days | Testers seeking recent changes |
| [Source main](../CONTRIBUTING.md) | Development code requiring developer tools | Contributors and advanced users |

The public portable release predates recent optional-login and desktop connection-menu changes.
See [Unreleased](../CHANGELOG.md#unreleased) for newer functionality. If no recent package matches your
device, wait for a release or use source setup; building a desktop app is not a prerequisite for trying TakeBoard.

## Portable download

Open the public Release's **Assets** section and choose the matching file. GitHub's automatically
generated **Source code (zip / tar.gz)** downloads are source archives, not ready-to-run packages.

| Device | Filename |
| --- | --- |
| Mac, Apple silicon (M series) | `takeboard-v0.2.0-beta.1-macos-arm64.tar.gz` |
| Mac, Intel | `takeboard-v0.2.0-beta.1-macos-x64.tar.gz` |
| Windows, Intel / AMD 64-bit | `takeboard-v0.2.0-beta.1-windows-x64.tar.gz` |
| Windows, ARM64 | `takeboard-v0.2.0-beta.1-windows-arm64.tar.gz` |
| Linux, Intel / AMD 64-bit | `takeboard-v0.2.0-beta.1-linux-x64.tar.gz` |
| Linux, ARM64 | `takeboard-v0.2.0-beta.1-linux-arm64.tar.gz` |

Check **About This Mac** or Windows **Settings → System → About** if unsure of your processor.
Build availability does not prove every GPU/workflow combination is tested; see the
[compatibility evidence](compatibility-matrix.md) (Chinese).

Extract the entire archive, preserve its folder structure, and open:

| Platform | Launcher |
| --- | --- |
| macOS | `START-TAKEBOARD.command` |
| Windows | `START-TAKEBOARD.cmd` |
| Linux | `./start-takeboard.sh` |

The portable launcher starts a local service and opens your browser. Keep its window open and follow
its shutdown instructions when finished. Node.js, pnpm and Rust do not need separate installation.
ComfyUI, models and Custom Nodes are not included; generation requires a working ComfyUI environment.

## Recent desktop test builds

1. Open Desktop check and choose an entirely successful **main** run. Check its commit and date.
2. Sign in to GitHub and download `takeboard-preview-macos-arm64` or
   `takeboard-preview-windows-x64` from **Artifacts** at the bottom of the run.
3. Extract the Artifact archive, then open the enclosed DMG or NSIS `.exe` installer.
4. If artifacts are missing or expired, use a published preview or wait for a new successful build.
   Do not substitute packages from failed runs.

Linux screenshot artifacts are not installers. The separate maintainer-triggered
[Preview bundles](https://github.com/Fourques/Takeboard/actions/workflows/portable-bundles.yml)
pipeline can build six platforms, but its existence does not mean packages are currently available.

The desktop app starts its local service automatically. Recent builds include **Connection → Connect
device…** for SSH, HTTPS and a self-hosted Portal. SSH needs a reachable server, system OpenSSH,
configured keys and a trusted host fingerprint. Matching email addresses do not automatically pair
devices. See [remote access](remote-access.md) (Chinese).

## Safety and upgrades

- Previews are not Apple-notarized or commercially Windows-code-signed. Operating systems may warn or
  block them. Do not globally disable Gatekeeper, antivirus or other protection. Stop if you cannot verify the source.
- Public portable packages have adjacent `.sha256` files. Checksums check integrity, not publisher
  identity or security. Advanced users can verify supported build attestations with
  `gh attestation verify <downloaded-file> --repo Fourques/Takeboard`.
- Projects default to `~/TakeBoardData` (the `TakeBoardData` folder in your Windows user directory),
  outside the installation directory. Export important projects before upgrading and back up the full
  data directory with the service stopped. Never run two writers against the same data directory.
- Do not open newly migrated data with an older app. Roll back using a separate pre-upgrade backup.
- Current main allows local use without registration; account projects retain their authorization.
  Public deployments require mandatory login and HTTPS. Never expose a login-optional local service publicly.

For support, include OS, CPU, version/commit, package name, connection method and the error in the
[issue chooser](https://github.com/Fourques/Takeboard/issues/new/choose). Omit private media and credentials.

## Release policy

GitHub Releases is the long-lived user download channel; Actions is for testing. Future releases
should identify preview/stable status, source commit, platform, signing state, checksums, upgrade
instructions and limitations. Do not silently replace old tags or reuse an installer name for changed
code. See the [signing and release guide](desktop-production-signing.md) (Chinese).
