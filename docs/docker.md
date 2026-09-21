# Docker Compose

Images are published under `ghcr.io/falcononrails`. New builds support Linux x86-64 and ARM64, including Docker Desktop's Linux containers. Both architectures are built and tested on native runners; Docker automatically selects the matching image. Releases through `0.2.0-beta.2` only contain x86-64 images.

## Install a numbered release

Download `nuvioweb-v<VERSION>-compose.tar.gz` and `SHA256SUMS` from [Releases](https://github.com/falcononrails/NuvioWeb/releases). Verify the archive with `sha256sum -c SHA256SUMS`, extract it into a directory, then run:

```sh
cp .env.example .env
docker compose up -d --no-build --pull always --wait
```

The supplied `.env.example` pins `NUVIO_IMAGE_TAG` to that release for every service. Use `--no-build` with release bundles: they contain the configuration, not the source tree. No GitHub login is required to pull public images. On PowerShell, use `Copy-Item .env.example .env`.

To change versions, update `NUVIO_IMAGE_TAG` in `.env`, then repeat the command above. Review the target release's notes and Compose configuration before upgrading or rolling back. Keep your private `.env` values. `nightly` follows current development; `stable` and `latest` are only published for non-beta releases and will not exist until the first stable release.

## Build from source

```sh
git clone --branch nightly https://github.com/falcononrails/NuvioWeb.git
cd NuvioWeb
cp .env.example .env
docker compose up -d --build --pull never --wait
```

Open `http://localhost:4173`. On PowerShell, use `Copy-Item .env.example .env` for the copy step. The first build downloads the base images and dependencies; later builds reuse Docker's cache.

The five services are the Nginx frontend, the FFmpeg playback bridge, and the Trakt, debrid and external-player-return bridges. Only the frontend publishes a port. Leave the supplied public Nuvio backend settings in `.env` to use your existing account and synced addons. No separate Supabase installation is needed. Browser settings remain in your browser and account data remains with Nuvio.

Trakt and external-player push notifications are optional. Empty credentials leave those features unconfigured. Private Trakt and push keys are passed only to their respective bridges, never to the frontend. See the [environment reference](environment.md).

## Domain and HTTPS

For remote access, put an HTTPS reverse proxy in front of the frontend. For example, with a proxy running on the same host:

```dotenv
NUVIO_BIND=127.0.0.1
NUVIO_PORT=4173
NUVIO_ORIGIN=https://nuvio.example.com
```

`NUVIO_ORIGIN` must match the exact address in the browser, including any nonstandard port, with no trailing slash. Proxy the **whole site**, including `/api/`, to `http://127.0.0.1:4173`; allow at least 65 seconds for playback preparation. A host-installed Caddy configuration can be as small as:

```caddyfile
nuvio.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

If your reverse proxy is itself in Docker, attach it to this Compose network and use `nuvioweb:80` as its upstream instead. The default loopback binding is not reachable from another container's `localhost`.

Use HTTPS for a domain or LAN address: playback cookies are Secure, and PWA features need a secure context. `http://localhost` is suitable for a local browser. If you change the local port, update both `NUVIO_PORT` and `NUVIO_ORIGIN`. Changing the bind address alone does not configure HTTPS.

Apply `.env` changes with `docker compose up -d --force-recreate`.

## Playback and resources

The browser plays supported sources directly. When conversion is needed, your own playback container verifies the Nuvio account, copies supported H.264/HEVC video and converts one audio track to stereo AAC. It does not contact the playback server on nuvioweb.space.

Limits are two sessions overall, one per account, 1.5 CPU cores, 1 GB memory and 1.5 GB of temporary storage. Input limits remain 25 GB, four hours and 60 Mbps. HEVC still requires browser support; unsupported video is not transcoded. Budget additional memory for the other services and image builds.

Temporary HLS segments live in memory-backed storage and are discarded when the container stops. Restarting or upgrading interrupts active conversions. The bridge runs as an unprivileged user with a read-only filesystem; only its temporary directory is writable. Keep its port internal to Compose.

## Update and troubleshoot

For source builds:

```sh
git pull --ff-only
docker compose up -d --build --pull never --wait
docker compose ps
docker compose logs --tail=100 playback-bridge
```

`/api/playback/health` should return JSON containing `"available":true`. If it returns HTML, the reverse proxy is not routing `/api/` to this stack. A playback sign-in error can also mean that the frontend and playback bridge point at different Nuvio backends, or that `NUVIO_ORIGIN` does not match the browser address.

Stop the stack with `docker compose down`. Source access restrictions and browser codec limitations still apply; Docker packages the app and playback service, it does not remove those limitations.


### Episode release notifications

The external-return bridge also delivers episode release alerts. Set `NUVIO_ORIGIN` to the HTTPS origin of your site, then generate a VAPID key pair locally:

```sh
docker compose run --rm --no-deps external-return-bridge node -e 'console.log(JSON.stringify(require("web-push").generateVAPIDKeys()))'
```

Put the values in `.env` as `NUVIO_WEB_PUSH_PUBLIC_KEY` and `NUVIO_WEB_PUSH_PRIVATE_KEY`. Set `NUVIO_WEB_PUSH_SUBJECT` to a contact URI such as `mailto:you@example.com` or your HTTPS site URL, then recreate the bridge. Keep the private key secret and stable; rotating it requires devices to subscribe again.

The `notifications` volume contains push subscriptions, account IDs and upcoming titles/dates. Preserve it on updates. The service verifies Nuvio sessions using the same account backend as playback, but never saves login tokens. It accepts at most 8 devices per account, 500 devices overall and 300 scheduled episodes per device. Schedules expire after 32 days without a refresh. Run one bridge instance with this volume; its JSON store is not designed for multiple replicas.

Clients refresh upcoming dates every six hours while open, retrying failed checks later. Turning off alerts or signing out revokes the schedule; if the server is unreachable, the client also attempts to unsubscribe and retries the deletion on its next visit. Push delivery is best effort, with at-most-once submission to avoid repeated alerts after a restart. iOS/iPadOS requires a Home Screen installation. No Apple developer account is required.
