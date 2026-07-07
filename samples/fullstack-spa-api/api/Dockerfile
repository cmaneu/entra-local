# Entra Local — full-stack sample: containerized Express resource API.
#
# Runs the same entrypoint as `npm start` (tsx src/server.ts). Intended to be built by this
# sample's docker-compose.yml, which shares the emulator's network namespace so the API can reach
# the emulator at https://localhost:8443 (the exact origin baked into the access token issuer) and
# reads the emulator dev cert from a mounted read-only volume for the JWKS fetch.
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# Install dependencies first (better layer caching). `tsx` (a devDependency) runs the TypeScript
# entrypoint directly, so install ALL deps — do NOT set NODE_ENV=production before this step.
COPY package.json package-lock.json ./
RUN npm ci

# App sources.
COPY tsconfig.json ./
COPY src ./src

# The API listens on plain HTTP (only the emulator is HTTPS). Express binds 0.0.0.0 by default.
ENV PORT=4000
EXPOSE 4000

USER node

# Plain-HTTP healthcheck via a tiny inline Node client (curl/wget are absent in -slim).
# Healthy == HTTP 200 with {"status":"ok"} on /health.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD node -e "const http=require('http');const p=process.env.PORT||4000;const req=http.get({host:'127.0.0.1',port:p,path:'/health',timeout:4000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{let ok=false;try{ok=r.statusCode===200&&JSON.parse(d).status==='ok'}catch{}process.exit(ok?0:1)})});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1)});"

CMD ["npm", "start"]
