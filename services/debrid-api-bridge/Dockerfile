FROM node:22-alpine

WORKDIR /app
ARG NUVIO_BUILD_REVISION
RUN NUVIO_BUILD_REVISION="$NUVIO_BUILD_REVISION" node -e "require('node:fs').writeFileSync('/release.json', JSON.stringify({commit: process.env.NUVIO_BUILD_REVISION || ''}))"
COPY services/debrid-api-bridge ./

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/debrid/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
