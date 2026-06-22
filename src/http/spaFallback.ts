import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isReservedApiPath } from './pathmap.js';
import { sendJsonNotFound } from './errors.js';

// Resolves to <repo>/portal/dist/index.html from both src/http (tsx) and dist/http (built).
const PLACEHOLDER_PATH = fileURLToPath(new URL('../../portal/dist/index.html', import.meta.url));

let cachedHtml: string | undefined;

function loadPlaceholder(): string {
  if (cachedHtml === undefined) {
    cachedHtml = readFileSync(PLACEHOLDER_PATH, 'utf8');
  }
  return cachedHtml;
}

/**
 * Register the SPA fallback as the app's global not-found handler.
 *
 * Non-API GET requests serve the placeholder portal `index.html` (text/html). Any request
 * targeting a reserved API prefix that didn't match a route — and any non-GET — returns a
 * JSON 404 (never the SPA HTML), so API routes are never shadowed by the SPA.
 */
export function registerSpaFallback(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply): void => {
    if (request.method === 'GET' && !isReservedApiPath(request.url)) {
      void reply.code(200).type('text/html; charset=utf-8').send(loadPlaceholder());
      return;
    }
    sendJsonNotFound(request, reply);
  });
}
