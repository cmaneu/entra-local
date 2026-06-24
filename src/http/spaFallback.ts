import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readTextAsset } from '../runtime/assets.js';
import { isReservedApiPath } from './pathmap.js';
import { sendJsonNotFound } from './errors.js';

let cachedHtml: string | undefined;

function loadPlaceholder(): string {
  if (cachedHtml === undefined) {
    // Resolves to <repo>/portal/dist/index.html from src/http (tsx) and dist/http (built); inside
    // a Node SEA single executable (#17) the same HTML is read from the embedded
    // `portal-index-html` asset instead.
    cachedHtml = readTextAsset(
      'portal-index-html',
      () => new URL('../../portal/dist/index.html', import.meta.url),
    );
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
