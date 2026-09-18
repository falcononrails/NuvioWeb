# Nightly deployment

`nightly` is the deployed branch of falcononrails/NuvioWeb. Pushes run tests, lint and the production build before publishing to https://nuvioweb.space. Deployment checks both the frontend revision and the playback service revision.

The upstream workflow checks alphasquare404/NuvioWeb's `web` branch every three hours. It merges normally, tests the result and deploys it. Conflicts or failing checks stop the update; local fixes are never force-reset.

## Playback service

Compatibility playback is an explicit action in Audio or on a playback error. It verifies the user's existing Nuvio session, copies H.264/HEVC video and converts one selected audio track to stereo AAC. It does not transcode video, process DRM or accept live playlists.

Limits: two sessions overall, one per account, 90 seconds without a heartbeat, four hours per session, 25 GB source files, 60 Mbps input, 1.5 CPU cores, 1 GB memory and 1.5 GB temporary storage. Private network addresses and unsafe redirects are rejected. Stream URLs and authorization headers are never logged by the service.

The VPS runs `/opt/nuvio-web/compose.yaml`. The deployment receiver can write releases only. A systemd path unit restarts the fixed playback container when `.deployed` changes. Compatibility sessions are interrupted when that container restarts; ordinary direct playback stays in the browser.

The previous release remains at `/srv/nuvio-web/previous`. Roll back by atomically pointing `current` to that release and writing its commit to `/srv/nuvio-web/.deployed`. Deployment credentials are GitHub secrets; runtime backend configuration stays in `/opt/nuvio-web/playback.env`.

## Validation

`npm test` and `npm run build` cover the application. The optional `NUVIO_BRIDGE_FIXTURE_URL` conversion test needs FFmpeg and a public, synthetic H.264 file with two E-AC3 audio tracks. It checks decoded, non-silent AAC output, track selection, seeking and session deletion. Production authentication is never bypassed.

The phone navigation styling and hero swipe thresholds are adapted from [NurvX/NuvioWeb](https://github.com/NurvX/NuvioWeb), under GPL-3.0. Existing routes, catalog data and desktop layout are retained.
