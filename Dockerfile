# Claude Code Academy: web app + backend in one image.
# Build:  docker build -t academy .
# Run:    docker run -p 8080:8080 -v academy-data:/data academy

# 1. build the web app (site/) from src/
FROM node:22-bookworm-slim AS site
RUN apt-get update && apt-get install -y --no-install-recommends python3 zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY build.sh index.html ./
COPY src ./src
COPY web ./web
RUN mkdir -p dist && ./build.sh

# 2. production dependencies for the server
FROM node:22-bookworm-slim AS deps
# build tools only in this stage: better-sqlite3 compiles from source when no prebuilt binary can be downloaded
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 3. runtime: small, non-root, with a health check
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/academy.db SITE_DIR=/app/site BACKUP_DIR=/data/backups BACKUP_EVERY_HOURS=24
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=site /app/site /app/site
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
