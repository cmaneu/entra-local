import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { Config } from './config/schema.js';
import { resolveTlsMaterial } from './tls/cert.js';

export interface RunningServer {
  app: FastifyInstance;
  /** Resolved origin the server is listening on (e.g. `https://localhost:8443`). */
  origin: string;
  close(): Promise<void>;
}

/**
 * Resolve TLS material, build the app, and start listening. HTTPS by default (auto-generated
 * self-signed cert) or plain HTTP when `TLS_ENABLED=false`.
 */
export async function createServer(config: Config): Promise<RunningServer> {
  const tls = resolveTlsMaterial(config);
  const app = await buildApp(config, tls ? { https: tls } : {});

  await app.listen({ host: config.host, port: config.port });

  const address = app.server.address();
  const boundPort = address && typeof address === 'object' ? address.port : config.port;
  const origin = `${config.scheme}://${config.host}:${boundPort}`;
  return {
    app,
    origin,
    close: () => app.close(),
  };
}
