# NuvioWeb

[Open nuvioweb.space](https://nuvioweb.space/) · [Report a bug](https://github.com/falcononrails/NuvioWeb/issues)

My browser fork of [alphasquare404/NuvioWeb](https://github.com/alphasquare404/NuvioWeb), with selected mobile improvements from [NurvX/NuvioWeb](https://github.com/NurvX/NuvioWeb). Maintained by [falcononrails](https://github.com/falcononrails). This is a community project, independent of the official Nuvio apps.

The site runs the `nightly` branch. Passing builds deploy automatically, so fixes can reach the site before upstream PRs are merged. Updates from alphasquare's `web` branch are merged and checked regularly; conflicts or failed checks stop the update.

[Numbered releases](https://github.com/falcononrails/NuvioWeb/releases) provide tested checkpoints for self-hosting. Beta releases remain marked as pre-releases; nightly keeps moving independently. About shows the package version, build channel and commit automatically. See [releasing](docs/releases.md) for the maintainer workflow.

## What's different here

- UI, icons and player controls adapted toward NuvioDesktop, with responsive layouts and mobile navigation.
- Posters/Text season picker and a release Calendar in Library. Artwork and release dates depend on the metadata your addons provide.
- Fixes for animated collection backdrops, browser playback and audio controls.
- Local AC3, EAC3 and DTS audio decoding with AVPlayer when native playback cannot handle the source. It loads on demand and keeps the existing player controls.
- Embedded text subtitles through the playback service, with language selection, delay controls and seek-aware timing. Image subtitle formats still need an external player or a subtitle addon.
- An open-source [playback service](services/playback-bridge) for files whose audio the browser cannot play. It copies supported video and converts the selected audio track to AAC, starting automatically when needed.

Sign in with your existing Nuvio account and use your synced addons and collections. Browser playback still depends on the source, its server and your device's codec support.

## Playback limits

Direct playback runs in your browser. HTTP sources, missing CORS headers and unsupported codecs can prevent it from working. HTTPS alone doesn't guarantee a playable file.

Playback tries the browser first, then [local audio decoding](docs/local-audio.md) on supported devices, then the server. Local decoding uses WebCodecs for video and WASM for unsupported audio; it does not use a server conversion slot. CORS restrictions and rejected media URLs can still require the server or another source.

Server-assisted playback requires a signed-in Nuvio account. The hosted service allows two sessions overall and one per account, with limits on duration, file size and resources. It supports H.264 and browser-compatible HEVC video with audio converted to stereo AAC. It does **not** convert unsupported video, remove DRM or handle live streams. When a source cannot be handled, choose another source or an external player.

Converted playback uses temporary segments on the server. Sessions expire and are cleaned up; deployments interrupt active conversions. This isn't an unlimited transcoding service or a promise that every source will play. See [deployment notes](docs/nightly.md) for the limits and checks.

## Trakt

**Native Trakt integration is not configured on nuvioweb.space.** The Trakt bridge code is included, but a host must supply its own Trakt application credentials to enable it. Signing in with a Nuvio account doesn't authorize this fork to reuse the official apps' Trakt integration.

Trakt catalogs supplied by addons such as AIOMetadata can still work through those addons' existing connections. Seeing those rows does not mean this website is scrobbling playback to Trakt.

## Docker Compose

Docker with the Compose plugin is all you need; Node.js and FFmpeg are built into the images.

For prebuilt **Linux x86-64** images, download and extract the Compose bundle from a [release](https://github.com/falcononrails/NuvioWeb/releases), then run:

```sh
cp .env.example .env
docker compose up -d --no-build --pull always --wait
```

The bundle pins all five services to the same version. For a source build, including ARM64:

```sh
git clone --branch nightly https://github.com/falcononrails/NuvioWeb.git
cd NuvioWeb
cp .env.example .env
docker compose up -d --build --pull never --wait
```

Open `http://localhost:4173`. Compose builds **this fork** and starts the web app, playback server and the existing integration bridges. The default configuration connects to Nuvio's hosted account backend, so you can use your existing account. Trakt remains unavailable unless you supply your own application credentials.

For a domain or access from another device, configure `NUVIO_ORIGIN` and HTTPS first. See [Docker setup](docs/docker.md) for reverse proxies, updates, logs and playback limits.

## Run locally without Docker

Use Node.js 24 and npm:

```sh
git clone --branch nightly https://github.com/falcononrails/NuvioWeb.git
cd NuvioWeb
npm ci
npm run build
npm run serve
```

Open `http://localhost:4173`. This starts the frontend development server, not the production playback service. See [environment configuration](docs/environment.md) for backend settings and [nightly deployment](docs/nightly.md) for this fork's hosting setup.

Checks: `npm test`, `npm run lint`, `npm run build`.

## Credits and license

- [NuvioMedia](https://github.com/NuvioMedia), [tapframe/NuvioTV](https://github.com/tapframe/NuvioTV), and the official [NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart) and [NuvioDesktop](https://github.com/NuvioMedia/NuvioDesktop) teams for the original apps, code and design.
- [alphasquare404/NuvioWeb](https://github.com/alphasquare404/NuvioWeb) for the browser/PWA fork this repository builds on.
- [NurvX/NuvioWeb](https://github.com/NurvX/NuvioWeb) for the mobile navigation and hero behavior adapted here. This is a selective port, not a full merge of that fork.
- [lucaboox/nuvio-web](https://github.com/lucaboox/nuvio-web) for the Library release-calendar logic used as a reference.
- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile) for the grouped mobile settings and account navigation used as the design reference.
- [WhiteGiso/NuvioTV-WebOS](https://github.com/WhiteGiso/NuvioTV-WebOS), [edoedac0](https://github.com/edoedac0), and [all upstream contributors](https://github.com/alphasquare404/NuvioWeb/graphs/contributors) for the earlier web work and ongoing fixes.
- [Gaoxing Zhao / libmedia](https://github.com/zhaohappy/libmedia) for AVPlayer and its WASM audio decoders (LGPL-3.0-or-later).
- The maintainers of FFmpeg, hls.js, dash.js and the other dependencies used by this project.

Licensed under [GPL-3.0](LICENSE). Existing attribution and license notices are retained. NuvioWeb supplies no media catalog of its own; use sources you are authorized to access.
