FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY services/playback-bridge/server.mjs services/playback-bridge/source.mjs services/playback-bridge/tracks.mjs /releases/current/server/playback-bridge/
COPY services/shared /releases/current/server/shared
ARG NUVIO_BUILD_REVISION
RUN NUVIO_BUILD_REVISION="$NUVIO_BUILD_REVISION" node -e "require('node:fs').writeFileSync('/releases/current/release.json', JSON.stringify({commit: process.env.NUVIO_BUILD_REVISION || ''}))"
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/playback/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "/releases/current/server/playback-bridge/server.mjs"]
