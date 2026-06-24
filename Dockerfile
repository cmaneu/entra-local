# Entra Local — hardened multi-stage container image (feature #14, Run targets).
#
# Same entrypoint (`node dist/index.js`) and one config/data model as `npm start`: the only
# difference is that `data/` lives in the mounted volume at /app/data. The Node base must be
# >=22.13 so the built-in `node:sqlite` driver works without native bindings and without the
# `--experimental-sqlite` flag (locked decision).
ARG NODE_IMAGE=node:24-slim

# --- Stage 1: build the server + the single-file admin portal (needs devDeps via `npm ci`). ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: resolve production-only dependencies (no react/vite/test toolchain). ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Stage 3: lean, non-root runtime. Carries only what the server needs at runtime: the
#     compiled server (dist/), the prebuilt portal asset (portal/dist/index.html, served as a
#     static file), prod node_modules, and package.json (read by version + SPA fallback). ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8443
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/portal/dist ./portal/dist
COPY --chown=node:node package.json ./

# Persisted SQLite DB (DB_PATH) + auto-generated TLS cert (TLS_CERT_DIR) live under /app/data.
# Create + own it as `node` BEFORE declaring the VOLUME so a fresh named volume inherits the
# non-root ownership (lets the unprivileged process write the DB + first-run cert).
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8443
VOLUME ["/app/data"]

# TLS-aware healthcheck WITHOUT curl/wget (absent in -slim): a tiny inline Node client hits the
# container's own loopback HTTPS /health, bypassing verification of its self-signed cert (in-
# container loopback only). Healthy == HTTP 200 with {"status":"ok"}.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "const https=require('https');const p=process.env.PORT||8443;const req=https.get({host:'127.0.0.1',port:p,path:'/health',rejectUnauthorized:false,timeout:4000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{let ok=false;try{ok=r.statusCode===200&&JSON.parse(d).status==='ok'}catch{}process.exit(ok?0:1)})});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1)});"

CMD ["node", "dist/index.js"]
