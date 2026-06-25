import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import { createHostRouter, hostRole } from '../../src/http/hostRouting.js';
import { makeTestConfig } from '../helpers/constants.js';

const SUB_ORIGINS = {
  login: 'https://login.entra.localhost:8443',
  portal: 'https://portal.entra.localhost:8443',
  graph: 'https://graph.entra.localhost:8443',
} as const;

/** A config with three distinct subdomain origins (host-routing active). */
function subdomainConfig(): Config {
  return { ...makeTestConfig('unused.db'), origins: { ...SUB_ORIGINS } } as Config;
}

/** The default test config collapses all origins onto one host (routing disabled). */
function collapsedConfig(): Config {
  return makeTestConfig('unused.db');
}

describe('hostRole classifier (#26)', () => {
  it('maps each subdomain Host header to its slice', () => {
    const cfg = subdomainConfig();
    expect(hostRole('login.entra.localhost:8443', cfg)).toBe('login');
    expect(hostRole('portal.entra.localhost:8443', cfg)).toBe('portal');
    expect(hostRole('graph.entra.localhost:8443', cfg)).toBe('graph');
  });

  it('treats the loopback compat host (and unknown hosts) as compat', () => {
    const cfg = subdomainConfig();
    expect(hostRole('localhost:8443', cfg)).toBe('compat');
    expect(hostRole('127.0.0.1:8443', cfg)).toBe('compat');
    expect(hostRole('[::1]:8443', cfg)).toBe('compat');
    expect(hostRole('something-else.test', cfg)).toBe('compat');
    expect(hostRole(undefined, cfg)).toBe('compat');
  });

  it('is case-insensitive and port-agnostic on the hostname', () => {
    const cfg = subdomainConfig();
    expect(hostRole('LOGIN.Entra.LocalHost:8443', cfg)).toBe('login');
    expect(hostRole('graph.entra.localhost', cfg)).toBe('graph');
  });

  it('always returns compat when the three origins collapse to one host', () => {
    const cfg = collapsedConfig();
    expect(hostRole('login.entra.localhost:8443', cfg)).toBe('compat');
    expect(hostRole('graph.entra.localhost:8443', cfg)).toBe('compat');
    expect(hostRole('localhost:8443', cfg)).toBe('compat');
  });
});

describe('host router rewriteUrl (#26)', () => {
  it('prefixes /graph to root Graph paths only on the graph host', () => {
    const router = createHostRouter(subdomainConfig());
    const graph = 'graph.entra.localhost:8443';
    expect(router.rewriteUrl('/v1.0/me', graph)).toBe('/graph/v1.0/me');
    expect(router.rewriteUrl('/v1.0/users?$top=1', graph)).toBe('/graph/v1.0/users?$top=1');
    expect(router.rewriteUrl('/oidc/userinfo', graph)).toBe('/graph/oidc/userinfo');
  });

  it('leaves already-prefixed, non-graph, and other-host paths untouched', () => {
    const router = createHostRouter(subdomainConfig());
    const graph = 'graph.entra.localhost:8443';
    expect(router.rewriteUrl('/graph/v1.0/me', graph)).toBe('/graph/v1.0/me');
    expect(router.rewriteUrl('/', graph)).toBe('/');
    // Not the graph host → never rewritten.
    expect(router.rewriteUrl('/v1.0/me', 'login.entra.localhost:8443')).toBe('/v1.0/me');
  });

  it('never rewrites under a collapsed config', () => {
    const router = createHostRouter(collapsedConfig());
    expect(router.rewriteUrl('/v1.0/me', 'graph.entra.localhost:8443')).toBe('/v1.0/me');
  });
});
