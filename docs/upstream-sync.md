# Upstream review

Last reviewed: alphasquare404/NuvioWeb `web` through `a46c5447e2c1c49899349027b41634ce540a91b5` on 2026-09-21.
Fork baseline: `cb569ddf233b2b5e749953704100a10c88c055c0`.

We backport compatible changes on an isolated branch. We do not merge upstream UI, playback or deployment replacements automatically. `.github/upstream-reviewed.txt` records the reviewed boundary, including changes deliberately excluded; it does not mean every change was copied.

| Upstream commits | Decision |
| --- | --- |
| `ba1aee6e`, `dd0eb3b8` | Import Continue Watching identity deduplication and tracking-source ownership. |
| `567cba17`, `2c99abe7`, `7939a9c6`, `1a64da59`, `7d8aa6bb` | Import stop/background progress reports, Back settlement, explicit refresh, external-player resume and Home reveal refresh. Report before our local/server engines are torn down; retain our explicit-Back suppression override. |
| `503518af`, `fa4722f1`, `a789f2ec` | Import preview stacking, collection focus restoration and partial Home updates that reuse decoded images and preserve scroll. Keep swipe/drag binding state outside reconciled DOM attributes to prevent duplicate handlers on reused nodes. |
| `97bcfe56` | Import browser-compatible MDBList GET ratings. |
| `7fc50814`, `b2d7ba7d` | Import only Continue Watching removal/reconciliation. Retain our accessible card menus. Remote removal deletes playback sessions, never watched history; guard profile changes during async work. |
| `834a8f4b`, `b3e8b83d` | Already covered by our progress-bar logic and collection-hover implementation. |
| `18300255` | Retain our mobile card density and layout. |
| `cb3df8c6` | Retain our existing full-build service-worker fingerprint, which also covers generated assets. |
| `d35792c6`, `09badd48`, `5eb0007c` | Leave formatting-hook policy unchanged; no runtime improvements. |

The scheduled workflow now produces a read-only comparison in its Actions summary. Its former production merge repeatedly conflicted and called the retired standalone deployment workflow. Review new commits, backport only compatible changes, run tests/lint/build plus relevant browser checks, then update the reviewed boundary. Deploy through the existing verified native amd64/arm64 image pipeline.

Preserve the fork's playback fallback engines, embedded subtitles, account/profile behavior, accessibility, calendar, mobile layout, runtime configuration, PWA cache handling and Docker deployment. Do not copy upstream versions of these wholesale.
