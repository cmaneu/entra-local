import { readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { platform as osPlatform } from 'node:os';
import type { Config } from '../config/schema.js';

/**
 * Cross-platform `hosts` file management for the local-domains experience (#26). `*.entra.localhost`
 * does NOT auto-resolve on Windows (only the bare `localhost` label does), so the advertised
 * subdomains need explicit `127.0.0.1` entries. Mirrors the `trust` command's ergonomics: prints the
 * plan by default and only writes the file with `--apply` (which usually needs elevation).
 */
export type HostsAction = 'apply' | 'remove';

/** Thrown when an `--apply` write fails, so the CLI can exit non-zero cleanly. */
export class HostsError extends Error {}

const BLOCK_BEGIN = '# entra-local BEGIN';
const BLOCK_END = '# entra-local END';
const LOOPBACK = '127.0.0.1';

/** Absolute path of the OS hosts file for `plat`. */
export function hostsFilePath(plat: NodeJS.Platform = osPlatform()): string {
  return plat === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
}

/** Hostname of an origin URL, lower-cased (empty string when it cannot be parsed). */
function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Whether a host needs no hosts entry (loopback label or a literal IP). */
function isLoopbackName(host: string): boolean {
  return host === 'localhost' || isIP(host) !== 0;
}

/**
 * The de-duplicated, sorted list of hostnames the emulator advertises and therefore wants mapped to
 * `127.0.0.1`: each subdomain origin's host, the apex base domain, and every `LOCAL_DOMAINS` extra
 * (apex + its `login.`/`portal.`/`graph.` subdomains). Loopback/IP hosts are skipped.
 */
export function desiredHostNames(config: Config): string[] {
  const names = new Set<string>();

  for (const origin of [config.origins.login, config.origins.portal, config.origins.graph]) {
    const host = hostnameOf(origin);
    if (host && !isLoopbackName(host)) names.add(host);
  }

  const base = config.baseDomain.trim().toLowerCase();
  if (base && !isLoopbackName(base)) names.add(base);

  for (const extra of config.localDomains) {
    const d = extra.trim().toLowerCase();
    if (!d || isLoopbackName(d)) continue;
    names.add(d);
    names.add(`login.${d}`);
    names.add(`portal.${d}`);
    names.add(`graph.${d}`);
  }

  return [...names].sort();
}

/** Render the managed `# entra-local BEGIN/END` block mapping every name to `127.0.0.1`. */
export function buildHostsBlock(names: readonly string[]): string {
  const lines = [BLOCK_BEGIN, ...names.map((n) => `${LOOPBACK}\t${n}`), BLOCK_END];
  return lines.join('\n');
}

/** Strip any existing managed block (and the surrounding blank lines) from hosts-file content. */
function stripManagedBlock(content: string): string {
  const begin = content.indexOf(BLOCK_BEGIN);
  if (begin === -1) return content;
  const endMarker = content.indexOf(BLOCK_END, begin);
  if (endMarker === -1) return content;
  const before = content.slice(0, begin).replace(/\n+$/, '');
  const after = content.slice(endMarker + BLOCK_END.length).replace(/^\n+/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Compute the new hosts-file content for an action. Idempotent: any previous managed block is
 * removed first, then (for `apply`) a fresh block is appended. `remove` just drops the block. The
 * result always ends with a single trailing newline.
 */
export function applyHostsContent(
  existing: string,
  names: readonly string[],
  action: HostsAction,
): string {
  const stripped = stripManagedBlock(existing).replace(/\n+$/, '');
  if (action === 'remove' || names.length === 0) {
    return stripped ? `${stripped}\n` : '';
  }
  const block = buildHostsBlock(names);
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
}

export interface RunHostsOptions {
  readonly config: Config;
  readonly action: HostsAction;
  /** When true, write the file; otherwise just print the plan. */
  readonly apply: boolean;
  /** Sink for human-readable output (default: stdout). */
  readonly out?: (msg: string) => void;
  /** Target platform (default: the host platform). */
  readonly plat?: NodeJS.Platform;
  /** Hosts-file reader (default: `readFileSync`). Injectable for tests. */
  readonly readFile?: (path: string) => string;
  /** Hosts-file writer (default: `writeFileSync`). Injectable for tests. */
  readonly writeFile?: (path: string, content: string) => void;
}

function elevationHint(plat: NodeJS.Platform, path: string): string {
  return plat === 'win32'
    ? `  Run an elevated (Administrator) shell, then: entra-local hosts ${''}--apply`
    : `  Re-run with sudo: sudo entra-local hosts --apply  (edits ${path})`;
}

/**
 * Print (default) or execute (`apply`) the hosts-file plan. Reads the current file to show an
 * idempotent diff-free result; on `--apply` writes it back, surfacing an elevation hint and throwing
 * {@link HostsError} when the write is denied (e.g. not elevated).
 */
export function runHosts(options: RunHostsOptions): void {
  const out = options.out ?? ((msg: string) => process.stdout.write(`${msg}\n`));
  const plat = options.plat ?? osPlatform();
  const read = options.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const write = options.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, 'utf8'));
  const path = hostsFilePath(plat);
  const names = desiredHostNames(options.config);
  const verb = options.action === 'apply' ? 'Map' : 'Remove';

  out(`${verb} the Entra Local local domains in the hosts file`);
  out(`  file: ${path}`);
  out('');

  if (options.action === 'apply') {
    if (names.length === 0) {
      out('No local domains are configured (set BASE_DOMAIN / LOCAL_DOMAINS) — nothing to map.');
      return;
    }
    out('Entries (all → 127.0.0.1):');
    for (const n of names) out(`  ${n}`);
    out('');
  }

  let existing: string;
  try {
    existing = read(path);
  } catch {
    existing = '';
  }
  const updated = applyHostsContent(existing, names, options.action);

  if (!options.apply) {
    out('Re-run with --apply to write the file (requires Administrator/sudo):');
    out('');
    out(elevationHint(plat, path));
    out('');
    out(`Managed block that will be ${options.action === 'apply' ? 'written' : 'removed'}:`);
    for (const line of buildHostsBlock(names).split('\n')) out(`  ${line}`);
    return;
  }

  try {
    write(path, updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out(`  failed: ${message}`);
    out(elevationHint(plat, path));
    throw new HostsError('Failed to update the hosts file.');
  }
  out(options.action === 'apply' ? 'Hosts entries written.' : 'Hosts entries removed.');
}
