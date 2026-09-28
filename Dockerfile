# syntax=docker/dockerfile:1
#
# MK-OSINT single-container image: one Node process serves the REST API, the WebSocket feed and
# the built frontend on port 4000. See docs/development.md#deployment.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------------------------
# build: install every workspace (dev deps included) and compile backend + frontend.
# python3/make/g++ let better-sqlite3 compile from source if no prebuilt binary matches.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
  && mkdir -p sources.d analysis.d

# ---------------------------------------------------------------------------------------------
# deps: production-only node_modules for the backend workspace (native module built here, on
# the same base image the runtime uses).
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=backend --include-workspace-root=false --no-audit --no-fund \
  && npm cache clean --force

# ---------------------------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
  PORT=4000 \
  DB_PATH=/data/mk-osint.db \
  SOURCES_DIR=/app/sources.d \
  MKOSINT_SERVE_FRONTEND=true
WORKDIR /app

COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/backend/package.json ./backend/package.json
COPY --from=build --chown=root:root /app/backend/dist ./backend/dist
COPY --from=build --chown=root:root /app/frontend/dist ./frontend/dist
COPY --from=build --chown=root:root /app/sources.d ./sources.d
COPY --from=build --chown=root:root /app/analysis.d ./analysis.d

# The DB directory is the only writable path; a named volume mounted here inherits this owner.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM directly (npm would not forward it), so the
# graceful shutdown in backend/src/index.ts closes the WebSocket clients and the database.
CMD ["node", "backend/dist/index.js"]
