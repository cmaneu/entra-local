import { ConfigError, loadConfig } from './config/loadConfig.js';
import { createServer } from './server.js';

/**
 * Process entrypoint (`npm start`). Startup sequence:
 *  1. Load + validate config (fail-fast on error → non-zero exit).
 *  2. Resolve TLS material + build app + listen (HTTPS by default).
 *  3. Log resolved origin / issuer / key endpoints.
 *  4. Graceful shutdown on SIGINT/SIGTERM.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const server = await createServer(config);
  const { app, origin } = server;

  app.log.info(
    {
      origin,
      issuer: config.issuer,
      discovery: `${origin}/${config.tenantId}/v2.0/.well-known/openid-configuration`,
      jwks: `${origin}/${config.tenantId}/discovery/v2.0/keys`,
      tls: config.tls.enabled,
    },
    'Entra Local is listening',
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');
    server
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'Error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
