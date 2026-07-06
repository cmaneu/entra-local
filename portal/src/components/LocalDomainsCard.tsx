import type { Health } from '../api/types';
import type { Line } from '../lib/msalSnippet';
import { useEmulator } from './EmulatorContext';
import { Banner } from './Banner';
import { CodeBlock } from './CodeBlock';
import { EndpointRow } from './EndpointRow';
import { StatusDot } from './StatusDot';

/** Loopback host labels that always resolve without a hosts entry. */
const COMPAT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Hostname of an origin URL, lower-cased (empty when it cannot be parsed). */
function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Whether the three advertised origins collapse onto a single host (compat / `PUBLIC_ORIGIN`). */
function isCollapsed(origins: Health['origins']): boolean {
  return origins.login === origins.portal && origins.login === origins.graph;
}

/**
 * The de-duplicated subdomain hostnames the emulator advertises and therefore wants mapped to
 * `127.0.0.1` (the apex is derived from the shared parent of the `login.`/`portal.`/`graph.` hosts).
 * Loopback labels are skipped. Mirrors the server's `desiredHostNames` for the common case.
 */
function desiredHostNames(origins: Health['origins']): string[] {
  const names = new Set<string>();
  for (const origin of [origins.login, origins.portal, origins.graph]) {
    const host = hostnameOf(origin);
    if (host && !COMPAT_HOSTS.has(host)) names.add(host);
  }
  // Derive the apex (`entra.localhost`) from a subdomain host (`login.entra.localhost`).
  const login = hostnameOf(origins.login);
  const dot = login.indexOf('.');
  if (dot > 0) {
    const apex = login.slice(dot + 1);
    if (apex && !COMPAT_HOSTS.has(apex)) names.add(apex);
  }
  return [...names].sort();
}

/**
 * "Local domains" section: explains that the emulator advertises `login.`/`portal.`/`graph.`
 * subdomain origins on the one shared listener (routed by `Host` header), and — because
 * `*.entra.localhost` does not auto-resolve on every OS — hands the developer the exact hosts-file
 * entries plus the `entra-local hosts --apply` command to map them to `127.0.0.1`.
 *
 * This is the Docker-friendly counterpart to the `hosts` CLI (like {@link CertTrustCard} is for
 * `trust`): container users can't usefully run the CLI inside the container, so the portal shows the
 * block to paste into their **host** machine's hosts file. Rendered only when the subdomain origins
 * are active; a collapsed/compat single-origin config (`PUBLIC_ORIGIN`) hides it entirely.
 */
export function LocalDomainsCard(): JSX.Element | null {
  const { health } = useEmulator();

  // Nothing to show until health loads, or when every surface is collapsed onto one host.
  if (!health || isCollapsed(health.origins)) return null;

  const names = desiredHostNames(health.origins);
  if (names.length === 0) return null;

  const currentHost = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase();
  const onCompatHost = COMPAT_HOSTS.has(currentHost);
  const onSubdomainHost = names.includes(currentHost);

  const hostsBlock: Line[] = [
    [{ t: '# entra-local BEGIN', k: 'com' }],
    ...names.map((n): Line => [{ t: `127.0.0.1\t${n}` }]),
    [{ t: '# entra-local END', k: 'com' }],
  ];

  const cliBlock: Line[] = [
    [{ t: '# single-file binary', k: 'com' }],
    [{ t: 'entra-local hosts --apply' }],
    [{ t: '# from a repo checkout', k: 'com' }],
    [{ t: 'npm start -- hosts --apply' }],
  ];

  return (
    <section className="card" aria-labelledby="local-domains-title">
      <div className="msal-head">
        <div>
          <h2 className="h-md" id="local-domains-title">
            Local domains
          </h2>
          <p className="muted b-sm" style={{ marginTop: 4 }}>
            The emulator advertises three subdomain origins on the one shared listener, routed by
            the <span className="mono">Host</span> header. <span className="mono">*.localhost</span>{' '}
            does not auto-resolve on every OS, so map the names to{' '}
            <span className="mono">127.0.0.1</span> before pointing MSAL at them.
          </p>
        </div>
      </div>

      <div className="kv mb16">
        <div className="k">Login (STS)</div>
        <EndpointRow label="Login origin" value={health.origins.login} />
        <div className="k">Portal</div>
        <EndpointRow label="Portal origin" value={health.origins.portal} />
        <div className="k">Graph</div>
        <EndpointRow label="Graph origin" value={health.origins.graph} />
      </div>

      {onSubdomainHost ? (
        <Banner tone="success" className="mb16">
          <StatusDot tone="ok" /> You're viewing the portal on{' '}
          <span className="mono">{currentHost}</span>, so the subdomains already resolve here.
        </Banner>
      ) : onCompatHost ? (
        <Banner tone="caution" className="mb16">
          You're on the <strong>compatibility origin</strong> (
          <span className="mono">{currentHost}</span>), which serves every surface. MSAL clients
          that use the advertised subdomain endpoints (issuer, authorize, token, Graph) need the
          names below mapped to <span className="mono">127.0.0.1</span> first.
        </Banner>
      ) : null}

      <p className="b-sm" style={{ marginBottom: 8 }}>
        Run the built-in <span className="mono">hosts</span> command (prints the plan by default;{' '}
        <span className="mono">--apply</span> writes the file and needs Administrator/sudo):
      </p>
      <CodeBlock lines={cliBlock} ariaLabel="hosts CLI command" data-testid="local-domains-cli" />

      <p className="b-sm" style={{ margin: '12px 0 8px' }}>
        No CLI on this machine (e.g. the Docker image)? Paste this block into your{' '}
        <strong>host</strong> machine's hosts file instead —{' '}
        <span className="mono">C:\Windows\System32\drivers\etc\hosts</span> on Windows,{' '}
        <span className="mono">/etc/hosts</span> on macOS/Linux:
      </p>
      <CodeBlock
        lines={hostsBlock}
        ariaLabel="hosts file entries"
        data-testid="local-domains-hosts"
      />

      <p className="b-sm muted" style={{ marginTop: 8 }}>
        Prefer a single host? Start the emulator with{' '}
        <span className="mono">PUBLIC_ORIGIN=https://localhost:8443</span> to collapse every surface
        onto <span className="mono">localhost</span> (the backward-compatible origin) — no hosts
        entries needed.
      </p>
    </section>
  );
}
