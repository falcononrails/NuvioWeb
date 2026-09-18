FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "/releases/current/server/playback-bridge/server.mjs"]
