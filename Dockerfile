FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# Build generic browser assets only. Public deployment values are written to
# nuvio.env.js by the Nginx runtime entrypoint, never baked into image layers.
ARG NUVIO_RELEASE_CHANNEL=development
ARG NUVIO_BUILD_REVISION
RUN NUVIO_RELEASE_CHANNEL="$NUVIO_RELEASE_CHANNEL" NUVIO_BUILD_REVISION="$NUVIO_BUILD_REVISION" npm run build

FROM nginx:stable-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx-entrypoint.d/40-nuvio-env.sh /docker-entrypoint.d/40-nuvio-env.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-nuvio-env.sh && chmod +x /docker-entrypoint.d/40-nuvio-env.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
