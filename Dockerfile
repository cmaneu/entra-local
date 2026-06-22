# Entra Local — container image.
#
# STUB for feature #1. The runnable, hardened multi-stage image (build portal + server,
# persisted data volume, non-root user, HEALTHCHECK against /health) is finalized in
# feature #14 (Run targets). This stub documents the intended shape and is not yet
# part of the supported run targets.

FROM node:24-slim

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build server + portal assets.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8443
EXPOSE 8443

# Persisted SQLite DB + auto-generated TLS cert live under /app/data (mount a volume).
VOLUME ["/app/data"]

# Healthcheck wiring is finalized in #14.
# HEALTHCHECK --interval=10s --timeout=3s CMD node -e "..." || exit 1

CMD ["node", "dist/index.js"]
