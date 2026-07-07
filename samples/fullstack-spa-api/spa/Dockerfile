# Entra Local — full-stack sample: containerized MSAL SPA.
#
# Builds the Vite app (env baked at build time via the code defaults, which target the compat
# origin — emulator on https://localhost:8443, API on http://localhost:4000) and serves the static
# bundle with `vite preview` on the strict port 5173 that the SPA's redirect URI is registered for.
ARG NODE_IMAGE=node:24-slim

# --- Stage 1: build the static bundle (needs devDeps: tsc + vite). ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# --- Stage 2: serve the built bundle with `vite preview`. ---
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
EXPOSE 5173

USER node

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "const http=require('http');http.get({host:'127.0.0.1',port:5173,path:'/',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1));"

# `--host 0.0.0.0` makes the preview server reachable through the published port. The port/strictPort
# are passed on the CLI (not via vite.config.ts) so the non-root `node` user never needs to bundle
# the TS config to a temp file under the root-owned node_modules.
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
