# Docker Compose

This setup builds the checked-out NuvioWeb fork. It does not pull alphasquare's images. Supported targets are Linux x86-64 and ARM64, including Docker Desktop's Linux containers.

## Start

```sh
git clone --branch nightly https://github.com/falcononrails/NuvioWeb.git
cd NuvioWeb
cp .env.example .env
docker compose up -d --build --wait
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

```sh
git pull --ff-only
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100 playback-bridge
```

`/api/playback/health` should return JSON containing `"available":true`. If it returns HTML, the reverse proxy is not routing `/api/` to this stack. A playback sign-in error can also mean that the frontend and playback bridge point at different Nuvio backends, or that `NUVIO_ORIGIN` does not match the browser address.

Stop the stack with `docker compose down`. Source access restrictions and browser codec limitations still apply; Docker packages the app and playback service, it does not remove those limitations.
