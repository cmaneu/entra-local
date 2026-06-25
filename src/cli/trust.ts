import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config/schema.js';
import { certThumbprint, resolveCertPath } from '../tls/cert.js';

/** Install = trust the cert; remove = untrust it. */
export type TrustAction = 'install' | 'remove';

export interface TrustCommand {
  /** Human-readable label for the step. */
  readonly label: string;
  /** Executable to run. */
  readonly file: string;
  /** Arguments (passed as an array — never a shell string). */
  readonly args: readonly string[];
  /** Whether the step typically needs elevation (sudo / admin). */
  readonly elevated: boolean;
  /** Optional steps are best-effort: a failure is reported and skipped, not fatal. */
  readonly optional: boolean;
}

/** Thrown when a required `--apply` step fails, so the CLI can exit non-zero cleanly. */
export class TrustError extends Error {}

const NSS_NICKNAME = 'entra-local';
const LINUX_ANCHOR = '/usr/local/share/ca-certificates/entra-local.crt';

/**
 * Build the per-platform list of commands that trust (or untrust) the dev certificate. Pure: takes
 * the resolved cert path + SHA-1 thumbprint and the target platform, returns the command plan.
 */
export function buildTrustPlan(
  action: TrustAction,
  certPath: string,
  thumbprint: string,
  plat: NodeJS.Platform = osPlatform(),
): TrustCommand[] {
  if (plat === 'win32') {
    return action === 'install'
      ? [
          {
            label: 'Trust in the CurrentUser Root store',
            file: 'certutil',
            args: ['-addstore', '-user', '-f', 'Root', certPath],
            elevated: false,
            optional: false,
          },
        ]
      : [
          {
            label: 'Remove from the CurrentUser Root store',
            file: 'certutil',
            args: ['-delstore', '-user', 'Root', thumbprint],
            elevated: false,
            optional: false,
          },
        ];
  }

  if (plat === 'darwin') {
    const keychain = join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
    return action === 'install'
      ? [
          {
            label: 'Trust in the login keychain',
            file: 'security',
            args: ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, certPath],
            elevated: false,
            optional: false,
          },
        ]
      : [
          {
            label: 'Remove trust from the login keychain',
            file: 'security',
            args: ['remove-trusted-cert', certPath],
            elevated: false,
            optional: false,
          },
        ];
  }

  // Linux / other: system CA anchor (sudo) + best-effort browser NSS store.
  const nssdb = `sql:${join(homedir(), '.pki', 'nssdb')}`;
  if (action === 'install') {
    return [
      {
        label: 'Copy the cert into the system anchor dir',
        file: 'sudo',
        args: ['cp', certPath, LINUX_ANCHOR],
        elevated: true,
        optional: false,
      },
      {
        label: 'Update the system CA store',
        file: 'sudo',
        args: ['update-ca-certificates'],
        elevated: true,
        optional: false,
      },
      {
        label: 'Trust in the browser NSS store (needs libnss3-tools)',
        file: 'certutil',
        args: ['-d', nssdb, '-A', '-t', 'C,,', '-n', NSS_NICKNAME, '-i', certPath],
        elevated: false,
        optional: true,
      },
    ];
  }
  return [
    {
      label: 'Remove the cert from the system anchor dir',
      file: 'sudo',
      args: ['rm', '-f', LINUX_ANCHOR],
      elevated: true,
      optional: false,
    },
    {
      label: 'Update the system CA store',
      file: 'sudo',
      args: ['update-ca-certificates'],
      elevated: true,
      optional: false,
    },
    {
      label: 'Remove from the browser NSS store',
      file: 'certutil',
      args: ['-d', nssdb, '-D', '-n', NSS_NICKNAME],
      elevated: false,
      optional: true,
    },
  ];
}

/** Format a command for copy/paste, quoting any argument that contains whitespace. */
function formatCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printNodeHint(out: (msg: string) => void, certPath: string, plat: NodeJS.Platform): void {
  out('');
  out('Node-based clients ignore the OS trust store — point them at the cert instead:');
  if (plat === 'win32') {
    out(`  PowerShell:  $env:NODE_EXTRA_CA_CERTS = "${certPath}"`);
  } else {
    out(`  bash/zsh:    export NODE_EXTRA_CA_CERTS="${certPath}"`);
  }
}

export interface ExecutePlanOptions {
  /** When true, run the commands; otherwise just print them. */
  readonly apply: boolean;
  /** Sink for human-readable output (default: stdout). */
  readonly out?: (msg: string) => void;
  /** Command runner (default: `execFileSync` with inherited stdio). Injectable for tests. */
  readonly exec?: (file: string, args: readonly string[]) => void;
  /** Target platform (default: the host platform). */
  readonly plat?: NodeJS.Platform;
}

function defaultExec(file: string, args: readonly string[]): void {
  execFileSync(file, [...args], { stdio: 'inherit' });
}

/**
 * Print (default) or execute (`apply`) a trust plan. Optional steps that fail are skipped with a
 * note; a failing required step throws `TrustError`. Always prints the `NODE_EXTRA_CA_CERTS` hint.
 */
export function executePlan(
  action: TrustAction,
  certPath: string,
  plan: readonly TrustCommand[],
  options: ExecutePlanOptions,
): void {
  const out = options.out ?? ((msg: string) => process.stdout.write(`${msg}\n`));
  const plat = options.plat ?? osPlatform();
  const verb = action === 'install' ? 'Trust' : 'Untrust';

  out(`${verb} the Entra Local dev certificate`);
  out(`  cert: ${certPath}`);
  out('');

  if (!options.apply) {
    const what = action === 'install' ? 'trust' : 'untrust';
    out(`Run the following to ${what} it, or re-run with --apply to execute automatically:`);
    out('');
    for (const cmd of plan) {
      out(`  # ${cmd.label}${cmd.optional ? ' (optional)' : ''}`);
      out(`  ${formatCommand(cmd.file, cmd.args)}`);
    }
    printNodeHint(out, certPath, plat);
    return;
  }

  const exec = options.exec ?? defaultExec;
  for (const cmd of plan) {
    out(`→ ${cmd.label}…`);
    try {
      exec(cmd.file, cmd.args);
    } catch (err) {
      if (cmd.optional) {
        out(`  skipped (optional step failed: ${errMessage(err)})`);
        continue;
      }
      out(`  failed: ${errMessage(err)}`);
      out(`  run it manually: ${formatCommand(cmd.file, cmd.args)}`);
      throw new TrustError(
        `Failed to ${action === 'install' ? 'trust' : 'untrust'} the certificate.`,
      );
    }
  }
  out('');
  out(`Certificate ${action === 'install' ? 'trusted' : 'untrusted'}.`);
  printNodeHint(out, certPath, plat);
}

export interface RunTrustOptions extends ExecutePlanOptions {
  readonly config: Config;
  readonly action: TrustAction;
}

/** Resolve the cert from disk, build the platform plan, then print or apply it. */
export function runTrust(options: RunTrustOptions): void {
  const certPath = resolveCertPath(options.config); // throws if TLS is disabled
  const thumbprint = certThumbprint(readFileSync(certPath, 'utf8'));
  const plat = options.plat ?? osPlatform();
  const plan = buildTrustPlan(options.action, certPath, thumbprint, plat);
  executePlan(options.action, certPath, plan, { ...options, plat });
}
