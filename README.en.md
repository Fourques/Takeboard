# TakeBoard

<p align="right">English · <a href="README.md">简体中文</a></p>

<p align="center">
  <strong>From a reference image to a sequence of shots.</strong><br />
  An open-source, local-first AI filmmaking workspace for ComfyUI creators.
</p>

<p align="center">
  <a href="docs/downloads.en.md"><strong>Download</strong></a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-315EFB.svg" /></a>
  <a href="https://github.com/Fourques/Takeboard/releases"><img alt="Public preview release" src="https://img.shields.io/github/v/release/Fourques/Takeboard?include_prereleases&label=public%20preview&color=D99A46" /></a>
</p>

![TakeBoard project hub](docs/assets/takeboard-home.webp)

Keep reference media, generated shots and workflows on one canvas. Connect inputs, adjust parameters,
compare results and keep the takes you want. TakeBoard complements ComfyUI's node editor with a
project workspace and traceable generation history.

## Download and start

**You do not need to read the source or install developer tools to use a packaged build.**

Follow the [download guide](docs/downloads.en.md) for your platform. Portable and desktop previews
include Node.js; no separate Node.js, pnpm or Rust installation is needed.
**ComfyUI, models and Custom Nodes are not bundled.** You can organize projects and media without
ComfyUI; generation requires a working local or remote ComfyUI environment.

> [!IMPORTANT]
> As of September 9, 2026, the public Release is the `v0.2.0-beta.1` portable preview.
> Newer desktop previews are Actions artifacts, not an equivalent published installer release.
> This README describes current `main`, not every feature in the older Release.
> Previews are not Apple-notarized or commercially Windows-code-signed.

1. **Open the workspace:** download and extract or install the appropriate package.
2. **Create a project:** name it and add your images, videos and reference media.
3. **Connect ComfyUI:** check its status, choose an available workflow, connect inputs and generate.

Current development builds allow local use without registration. Login is optional, with separate
authorization for device projects and account projects. Older releases may require login.
Projects default to `~/TakeBoardData`; back them up before upgrading.

## One canvas, from inputs to results

- **Media and shots:** preserve original images and videos; connect first frames, last frames and references.
- **Workflows and generation:** built-in Recipes and explicit bindings for trusted custom workflows,
  actual node progress when available, cancellation and output recovery.
- **Review and provenance:** candidate takes, approval, storyboard ordering and saved generation parameters.
- **Project ownership:** self-contained data, recoverable deletion, project import/export and optional backups.
- **Remote access:** standard SSH, HTTPS and an optional self-hosted Portal; Tailscale is not required.
- **Optional extensions:** rough-cut preview, cost insights, batch review and delivery QC stay disabled until enabled.

Importing a workflow does not automatically make it executable. Dependency checks, parameter bindings
and explicit trust are required. Generation depends on your ComfyUI installation, models, nodes and
hardware. See the [creator guide](docs/creator-workstation.md) and
[compatibility evidence](docs/compatibility-matrix.md) (Chinese).

## Choose your path

| What you need | Start here |
| --- | --- |
| Use a packaged application | [Download and installation](docs/downloads.en.md) |
| Connect to a GPU server | [Remote access](docs/remote-access.md) (Chinese) |
| Manage login and project roles | [Accounts and access](docs/access-control.md) (Chinese) |
| Run a persistent server | [Self-hosting](docs/self-hosting.md) (Chinese) |
| Access paired devices through a portal | [Portal self-hosting](docs/portal-self-hosting.md) (Chinese) |
| Configure workflows or extensions | [Creator guide](docs/creator-workstation.md) · [Extension protocol](docs/extensions.md) (Chinese) |
| Build from source or contribute | [Contributing](CONTRIBUTING.md) · [Source configuration](docs/source-guide.md) (Chinese) |

The server defaults to loopback. Public deployments require mandatory authentication, HTTPS and access
restrictions. Never expose ComfyUI's port directly. Portal is self-hosted software, not an operated
official cloud. Data stays on infrastructure you choose; remote generation transfers authorized inputs.

## Documentation and feedback

[Documentation index](docs/README.md) · [Changelog](CHANGELOG.md) ·
[Roadmap](docs/roadmap.md) · [Security](SECURITY.md)

For problems, check the task center's runtime diagnostics and use the
[issue chooser](https://github.com/Fourques/Takeboard/issues/new/choose).
Do not upload private media, credentials or API keys. Report vulnerabilities privately.

## Open source and license

TakeBoard keeps its source public while making packaged downloads a separate entry for everyday users.
Core local creation does not require an official cloud account or a hosted-service subscription.

Code is licensed under [Apache License 2.0](LICENSE). Models, Custom Nodes and dependencies retain
their own licenses; TakeBoard's license does not grant additional rights to them.
