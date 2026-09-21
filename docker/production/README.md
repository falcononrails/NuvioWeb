# Hosted image deployments

The public `docker-compose.yml` remains the self-hosting entry point. This directory contains the small overrides for the ARM64 server running nuvioweb.space.

Publishing builds each of the five images on native amd64 and ARM64 runners. Both complete stacks are then pulled anonymously and checked, including FFmpeg audio conversion and build identity. Only successful nightly builds reach the deployment workflow, which also checks browser accessibility.

The existing HTTPS receiver accepts an authenticated commit ID and queues it in `/srv/nuvio-web/image-requests/pending`. It runs as `nuvio-deploy`, without Docker access. `nuvio-images.path` starts the root-owned worker. The worker accepts only a full Git SHA and fixed `ghcr.io/falcononrails` repositories, verifies the ARM64 platform and OCI revision, and pins each image by digest before starting Compose. No source code is mounted into the application containers.

The installation uses these root-owned files in `/opt/nuvio-web/images`:

- `compose.yaml`: the public Compose configuration.
- `production.yaml`: `compose.override.yaml` from this directory.
- `.env`: existing public account configuration and private notification keys; mode 0600. Set `NUVIO_ORIGIN=https://nuvioweb.space`, `NUVIO_BIND=127.0.0.1`, and `NUVIO_PORT=4873`.
- `current.json` and `previous.json`: the current and last healthy image digest sets.

Only the frontend joins the existing HTTPS proxy network. The bridges stay on the application network. The Caddy container keeps the deployment and manual media-test routes and forwards app requests to `nuvio-frontend`. TLS remains with the existing outer proxy.

Notification data stays at `/opt/nuvio-web/notifications-data`, with the same VAPID keys. Never run the old and new notification schedulers against that directory together. The original source deployment is retained as an initial migration backup; its three `.deployed` watchers are disabled.

Install the scripts as `/usr/local/bin/nuvio-deploy-http` and `/usr/local/bin/nuvio-deploy-images`; install the systemd units in `/etc/systemd/system`. The request directory belongs to `nuvio-deploy`, while scripts, Compose configuration and image locks belong to root. The receiver's systemd write access should be limited to that queue and `/run/nuvio-deploy`. Changes to host configuration or deployment scripts require a separate reviewed installation; pushing application code only deploys images.

Inspect a deployment:

```sh
sudo journalctl -u nuvio-images.service -n 100
sudo cat /opt/nuvio-web/images/current.json
curl -fsS https://nuvioweb.space/release.json
```

Startup or endpoint verification failure automatically restores the current healthy digest set. To explicitly switch back to the previous healthy set:

```sh
sudo /usr/local/bin/nuvio-deploy-images --rollback
```

The command takes the same deployment lock and verifies the restored services. Rollbacks preserve notification data and environment settings. Container restarts interrupt active server-converted playback, as before. Do not prune previous images while they are your rollback target.
