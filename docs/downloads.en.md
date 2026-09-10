# Download and installation

[Home](../README.en.md) · [简体中文](downloads.md)

## Download TakeBoard

**v0.2.0-beta.3 desktop preview** provides native installers only. Choose your computer and download
one file. No portable folder to manage and no separate Node.js, pnpm or Rust installation.

| Your computer | Download |
| --- | --- |
| Mac · Apple 芯片 / Apple silicon | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-macos-arm64.dmg) |
| Mac · Intel | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-macos-x64.dmg) |
| Windows · Intel / AMD | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-windows-x64.exe) |
| Windows · ARM64 | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-windows-arm64.exe) |
| Debian / Ubuntu · Intel / AMD | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-linux-x64.deb) |
| Debian / Ubuntu · ARM64 | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.3/TakeBoard-v0.2.0-beta.3-linux-arm64.deb) |

Check **About This Mac** or Windows **Settings → System → About** for your processor.
DEB packages target Debian/Ubuntu, not every Linux distribution. Other environments can use
[source setup](../CONTRIBUTING.md). All installers are also on the
[Release page](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.3).
**Source code** at the bottom is for developers, not an installer.

## Install and open

- **Mac:** open the DMG, drag TakeBoard into Applications, then launch it from Applications.
- **Windows:** run the EXE setup wizard, then launch TakeBoard from Start.
- **Debian / Ubuntu:** open the DEB with your software installer and launch from the applications menu.
  Without a graphical installer, run `sudo apt install ./TakeBoard-v0.2.0-beta.3-linux-x64.deb`
  in the download directory; use the ARM64 filename on ARM devices.

The app starts its local service automatically. Local use needs no registration; login is optional,
and account projects retain authorization. Generation requires separately configured **ComfyUI,
models and Custom Nodes**. Projects, media and the canvas can be used without ComfyUI.

> [!IMPORTANT]
> This preview is not Apple-notarized or commercially Windows-code-signed. Your OS may warn or block it.
> Do not globally disable Gatekeeper, antivirus or other protections. Stop if you cannot verify the source.
> Installer format is not OS trust certification; runtime checks are not exhaustive GPU/workflow validation.

## Connect a server

Use **Connection → Connect device…** for SSH, HTTPS or a self-hosted Portal. SSH needs a reachable
server, system OpenSSH, configured keys and a trusted host fingerprint; Tailscale is not required.
Portal needs deployment and explicit pairing, not just a matching email address. There is no operated
official cloud. See [remote access](remote-access.md) (Chinese).

## Upgrades and support

- Upgrade from `0.2.0-beta.2` manually once. Then use **Updates → Check for updates** for later releases.
  Updates are not installed automatically; remote devices must be upgraded separately.
- Projects default to `~/TakeBoardData` (the user-profile `TakeBoardData` folder on Windows), outside the app.
- Export important projects, stop the old service and back up the full data directory before upgrading.
  Never run two writers against the same data directory.
- Portable packages are retired. An old extracted app folder is not the project data directory;
  check your configured data location before removing old files.
- Roll back using a separate pre-upgrade backup, not by opening migrated data in an older app.
- No separate checksum downloads are needed. Build verification and provenance remain in the
  [release process](desktop-production-signing.md) (Chinese).

For [support](https://github.com/Fourques/Takeboard/issues/new/choose), include OS, processor, app
version, connection method and the error. Omit private media and credentials.
For development, see [Contributing](../CONTRIBUTING.md) and the [documentation index](README.md).
