# Download and installation

[Home](../README.en.md) · [简体中文](downloads.md)

## Download TakeBoard

**v0.2.0-beta.19** is the current preview for all six platform/architecture combinations. Choose your computer and download
one file. The app runtime is included; no separate Node.js, pnpm or Rust installation is needed.
ComfyUI, models and custom nodes must be installed separately.

The app interface is currently primarily Chinese; the website and getting-started materials have English versions.

| Your computer | Download |
| --- | --- |
| Mac · Apple silicon | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_aarch64.dmg) |
| Mac · Intel | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_x64.dmg) |
| Windows · Intel / AMD | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_x64-setup.exe) |
| Windows · ARM64 | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_arm64-setup.exe) |
| Debian / Ubuntu · Intel / AMD | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_amd64.deb) |
| Debian / Ubuntu · ARM64 | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.19/TakeBoard_0.2.0-beta.19_arm64.deb) |

Check **About This Mac** or Windows **Settings → System → About** for your processor.
DEB packages target Debian/Ubuntu, not every Linux distribution. Other environments can use
[source setup](../CONTRIBUTING.md). See the [release page](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.19) for details.
**Source code** at the bottom is for developers, not an installer.

## Install and open

- **Mac:** open the DMG, drag TakeBoard into Applications, then launch it from Applications.
- **Windows:** run the EXE setup wizard, then launch TakeBoard from Start.
- **Debian / Ubuntu:** open the DEB with your software installer and launch from the applications menu.
  Without a graphical installer, run `sudo apt install ./TakeBoard_0.2.0-beta.19_amd64.deb`
  in the download directory; use the ARM64 filename on ARM devices.

The app starts its local service automatically. Local use needs no registration; login is optional,
and account projects retain authorization. Generation requires separately configured **ComfyUI,
models and Custom Nodes**. Projects, media and the canvas can be used without ComfyUI.

Mac packages are not Apple-notarized and Windows packages are not commercially code-signed, so the OS may show a first-launch warning. On Mac, after verifying that the download came from this repository's Release, follow [Apple's per-app instructions](https://support.apple.com/102445): look for the app under **System Settings → Privacy & Security → Open Anyway**. A damaged-file or malware warning is different: report the exact message rather than treating it as a routine signature warning. Do not disable system protections globally.

**Running the app does not mean your computer can run every model.** GPU and memory requirements depend on the workflow. You can also connect to a remote GPU.

## Your first project

Already using ComfyUI? [Follow the first-session guide](first-session.md#english) to complete a generation. Otherwise, create a project and import an image to explore the canvas and asset library first.

## Connect a server

For remote generation with projects stored on this computer, add remote ComfyUI in **Settings → Device connections**. TakeBoard manages the connection and collects outputs into the current project. See [generation devices and storage](generation-and-storage.md) (Chinese).

To open and manage projects stored on another TakeBoard device, use **Settings → Remote projects**
for SSH, HTTPS or a self-hosted Portal. The desktop Connection menu opens the same settings. SSH needs a reachable
server, system OpenSSH, configured keys and a trusted host fingerprint; Tailscale is not required.
Portal needs deployment and explicit pairing, not just a matching email address. There is no operated
official cloud. See [remote access](remote-access.md) (Chinese).

## Upgrades and support

- Use **Updates → Check for updates** for later releases. If your older version has no update menu,
  download manually. Updates are not installed automatically; remote devices need a separate upgrade.
- Projects default to `~/TakeBoardData` (the user-profile `TakeBoardData` folder on Windows), outside the app.
- Export important projects, stop the old service and back up the full data directory before upgrading.
  Never run two writers against the same data directory.
- Roll back using a separate pre-upgrade backup, not by opening migrated data in an older app.

For [support](https://github.com/Fourques/Takeboard/issues/new/choose), include OS, processor, app
version, connection method and the error. Omit private media and credentials.
For development, see [Contributing](../CONTRIBUTING.md) and the [documentation index](README.md).
