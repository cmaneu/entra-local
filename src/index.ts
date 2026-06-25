#!/usr/bin/env node
import { ConfigError, loadConfig } from './config/loadConfig.js';
import { createServer } from './server.js';
import { isCliCommand, runCli } from './cli/index.js';

/**
 * Boot the emulator server. Startup sequence:
 *  1. Load + validate config (fail-fast on error → non-zero exit).
 *  2. Resolve TLS material + build app + listen (HTTPS by default).
 *  3. Log resolved origin / issuer / key endpoints.
 *  4. Graceful shutdown on SIGINT/SIGTERM.
 */
async function startServer(): Promise<void> {
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

  const collapsed =
    config.origins.login === config.origins.portal &&
    config.origins.portal === config.origins.graph;

  app.log.info(
    {
      origin,
      issuer: config.issuer,
      origins: config.origins,
      discovery: `${config.origins.login}/${config.tenantId}/v2.0/.well-known/openid-configuration`,
      jwks: `${config.origins.login}/${config.tenantId}/discovery/v2.0/keys`,
      graph: `${config.origins.graph}/v1.0`,
      tls: config.tls.enabled,
    },
    'Entra Local is listening',
  );

  if (!collapsed) {
    app.log.info(
      { hint: 'entra-local hosts --apply' },
      `Local domains active: login=${config.origins.login} portal=${config.origins.portal} ` +
        `graph=${config.origins.graph}. If these names do not resolve, run "entra-local hosts ` +
        `--apply" to map them to 127.0.0.1.`,
    );
  }

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

/**
 * Process entrypoint. Recognised subcommands (`trust`, `untrust`, `cert-path`, `show-cert`, `help`)
 * are dispatched to the CLI; anything else (including no subcommand) boots the server. The CLI layer
 * is inherited by every run target, including the single-executable binary.
 */
async function main(): Promise<void> {
  if (isCliCommand(process.argv)) {
    process.exit(await runCli(process.argv));
  }
  await startServer();
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
