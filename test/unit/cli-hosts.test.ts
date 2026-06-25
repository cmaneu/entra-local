import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import {
  applyHostsContent,
  buildHostsBlock,
  desiredHostNames,
  HostsError,
  hostsFilePath,
  runHosts,
} from '../../src/cli/hosts.js';
import { makeTestConfig } from '../helpers/constants.js';

const SUB_ORIGINS = {
  login: 'https://login.entra.localhost:8443',
  portal: 'https://portal.entra.localhost:8443',
  graph: 'https://graph.entra.localhost:8443',
} as const;

function subdomainConfig(localDomains: string[] = []): Config {
  return {
    ...makeTestConfig('unused.db'),
    baseDomain: 'entra.localhost',
    origins: { ...SUB_ORIGINS },
    localDomains: Object.freeze([...localDomains]),
  } as Config;
}

describe('hostsFilePath (#26)', () => {
  it('is the Windows system path on win32 and /etc/hosts elsewhere', () => {
    expect(hostsFilePath('win32')).toBe('C:\\Windows\\System32\\drivers\\etc\\hosts');
    expect(hostsFilePath('linux')).toBe('/etc/hosts');
    expect(hostsFilePath('darwin')).toBe('/etc/hosts');
  });
});

describe('desiredHostNames (#26)', () => {
  it('lists the subdomain origins + apex, sorted, excluding loopback names', () => {
    expect(desiredHostNames(subdomainConfig())).toEqual([
      'entra.localhost',
      'graph.entra.localhost',
      'login.entra.localhost',
      'portal.entra.localhost',
    ]);
  });

  it('expands each LOCAL_DOMAINS extra into apex + login/portal/graph', () => {
    const names = desiredHostNames(subdomainConfig(['contoso.test']));
    expect(names).toContain('contoso.test');
    expect(names).toContain('login.contoso.test');
    expect(names).toContain('portal.contoso.test');
    expect(names).toContain('graph.contoso.test');
  });
});

describe('buildHostsBlock / applyHostsContent (#26)', () => {
  it('wraps every name → 127.0.0.1 in a marked block', () => {
    const block = buildHostsBlock(['a.test', 'b.test']);
    expect(block).toContain('# entra-local BEGIN');
    expect(block).toContain('# entra-local END');
    expect(block).toContain('127.0.0.1\ta.test');
    expect(block).toContain('127.0.0.1\tb.test');
  });

  it('is idempotent: applying twice yields identical content', () => {
    const names = ['login.entra.localhost', 'graph.entra.localhost'];
    const base = '127.0.0.1\tlocalhost\n';
    const once = applyHostsContent(base, names, 'apply');
    const twice = applyHostsContent(once, names, 'apply');
    expect(twice).toBe(once);
    expect(once).toContain('127.0.0.1\tlogin.entra.localhost');
    // Pre-existing content is preserved.
    expect(once).toContain('127.0.0.1\tlocalhost');
  });

  it('remove strips the managed block but keeps the rest of the file', () => {
    const names = ['login.entra.localhost'];
    const withBlock = applyHostsContent('127.0.0.1\tlocalhost\n', names, 'apply');
    const removed = applyHostsContent(withBlock, names, 'remove');
    expect(removed).not.toContain('# entra-local');
    expect(removed).toContain('127.0.0.1\tlocalhost');
  });
});

describe('runHosts (#26)', () => {
  it('print mode lists the entries + elevation hint and never writes', () => {
    const lines: string[] = [];
    const writeFile = vi.fn();
    runHosts({
      config: subdomainConfig(),
      action: 'apply',
      apply: false,
      out: (m) => lines.push(m),
      plat: 'win32',
      readFile: () => '',
      writeFile,
    });
    expect(writeFile).not.toHaveBeenCalled();
    const text = lines.join('\n');
    expect(text).toContain('login.entra.localhost');
    expect(text).toContain('--apply');
    expect(text).toContain('# entra-local BEGIN');
  });

  it('apply mode writes the hosts file with the managed block', () => {
    let written = '';
    runHosts({
      config: subdomainConfig(),
      action: 'apply',
      apply: true,
      out: () => {},
      plat: 'linux',
      readFile: () => '127.0.0.1\tlocalhost\n',
      writeFile: (_p, c) => {
        written = c;
      },
    });
    expect(written).toContain('# entra-local BEGIN');
    expect(written).toContain('127.0.0.1\tgraph.entra.localhost');
    expect(written).toContain('127.0.0.1\tlocalhost');
  });

  it('apply mode throws HostsError when the write is denied', () => {
    expect(() =>
      runHosts({
        config: subdomainConfig(),
        action: 'apply',
        apply: true,
        out: () => {},
        plat: 'linux',
        readFile: () => '',
        writeFile: () => {
          throw new Error('EACCES: permission denied');
        },
      }),
    ).toThrow(HostsError);
  });
});
