import { readFileSync } from 'node:fs';
import { ConfigError, loadConfig } from '../config/loadConfig.js';
import { certFingerprint, resolveCertPath } from '../tls/cert.js';
import { runTrust, TrustError } from './trust.js';

const COMMANDS = new Set(['trust', 'untrust', 'cert-path', 'show-cert', 'help', '--help', '-h']);

/** True iff the first argv token is a recognised subcommand (otherwise the server boots). */
export function isCliCommand(argv: readonly string[]): boolean {
  const cmd = argv[2];
  return cmd !== undefined && COMMANDS.has(cmd);
}

function printHelp(out: (msg: string) => void): void {
  out(
    [
      'Entra Local — local Microsoft Entra ID emulator',
      '',
      'Usage:',
      '  entra-local                 Start the emulator (default)',
      '  entra-local trust [--apply] [--remove]',
      '                              Trust the dev certificate (print by default; --apply runs it)',
      '  entra-local untrust [--apply]',
      '                              Remove the dev certificate from the trust store',
      '  entra-local cert-path       Print the path to the certificate clients must trust',
      '  entra-local show-cert       Print the certificate path and SHA-256 fingerprint',
      '  entra-local help            Show this help',
      '',
      'Notes:',
      '  trust/untrust print the exact platform command and a NODE_EXTRA_CA_CERTS hint.',
      '  Pass --apply to execute it (may prompt for elevation on some platforms).',
    ].join('\n'),
  );
}

/** Dispatch a recognised subcommand. Returns the process exit code. */
export async function runCli(argv: readonly string[]): Promise<number> {
  const cmd = argv[2];
  const rest = argv.slice(3);
  const out = (msg: string): void => {
    process.stdout.write(`${msg}\n`);
  };
  const fail = (msg: string): number => {
    process.stderr.write(`${msg}\n`);
    return 1;
  };

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp(out);
    return 0;
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message);
    throw err;
  }

  try {
    switch (cmd) {
      case 'cert-path':
        out(resolveCertPath(config));
        return 0;
      case 'show-cert': {
        const path = resolveCertPath(config);
        const fingerprint = certFingerprint(readFileSync(path, 'utf8'));
        out(`path:        ${path}`);
        out(`fingerprint: ${fingerprint}`);
        return 0;
      }
      case 'trust':
        runTrust({
          config,
          action: rest.includes('--remove') ? 'remove' : 'install',
          apply: rest.includes('--apply'),
          out,
        });
        return 0;
      case 'untrust':
        runTrust({ config, action: 'remove', apply: rest.includes('--apply'), out });
        return 0;
      default:
        printHelp(out);
        return 0;
    }
  } catch (err) {
    if (err instanceof TrustError || err instanceof Error) return fail(err.message);
    throw err;
  }
}
