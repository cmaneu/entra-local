import { describe, expect, it, vi } from 'vitest';
import { buildTrustPlan, executePlan, TrustError } from '../../src/cli/trust.js';

const CERT = '/tmp/data/tls/cert.pem';
const THUMB = 'ABCDEF0123456789';

describe('buildTrustPlan (criterion 3/5)', () => {
  it('win32 install trusts via certutil -addstore in the CurrentUser Root store', () => {
    const plan = buildTrustPlan('install', CERT, THUMB, 'win32');
    expect(plan).toHaveLength(1);
    expect(plan[0]?.file).toBe('certutil');
    expect(plan[0]?.args).toEqual(['-addstore', '-user', '-f', 'Root', CERT]);
    expect(plan[0]?.elevated).toBe(false);
  });

  it('win32 remove deletes by SHA-1 thumbprint', () => {
    const plan = buildTrustPlan('remove', CERT, THUMB, 'win32');
    expect(plan[0]?.args).toEqual(['-delstore', '-user', 'Root', THUMB]);
  });

  it('darwin install adds a trusted root to the login keychain', () => {
    const plan = buildTrustPlan('install', CERT, THUMB, 'darwin');
    expect(plan[0]?.file).toBe('security');
    expect(plan[0]?.args).toContain('add-trusted-cert');
    expect(plan[0]?.args).toContain(CERT);
  });

  it('darwin remove untrusts via security remove-trusted-cert', () => {
    const plan = buildTrustPlan('remove', CERT, THUMB, 'darwin');
    expect(plan[0]?.args).toEqual(['remove-trusted-cert', CERT]);
  });

  it('linux install updates the system CA store and best-effort NSS (optional)', () => {
    const plan = buildTrustPlan('install', CERT, THUMB, 'linux');
    expect(plan.some((c) => c.file === 'sudo' && c.args.includes('update-ca-certificates'))).toBe(
      true,
    );
    const nss = plan.find((c) => c.file === 'certutil');
    expect(nss?.optional).toBe(true);
    expect(nss?.args).toContain('-A');
  });

  it('linux remove deletes the anchor and the NSS entry', () => {
    const plan = buildTrustPlan('remove', CERT, THUMB, 'linux');
    expect(plan.some((c) => c.file === 'sudo' && c.args[0] === 'rm')).toBe(true);
    expect(plan.find((c) => c.file === 'certutil')?.args).toContain('-D');
  });
});

describe('executePlan (criterion 3/4)', () => {
  it('print mode lists the command + NODE_EXTRA_CA_CERTS hint and never executes', () => {
    const lines: string[] = [];
    const exec = vi.fn();
    const plan = buildTrustPlan('install', CERT, THUMB, 'win32');
    executePlan('install', CERT, plan, {
      apply: false,
      out: (m) => lines.push(m),
      exec,
      plat: 'win32',
    });
    expect(exec).not.toHaveBeenCalled();
    const text = lines.join('\n');
    expect(text).toContain('certutil -addstore');
    expect(text).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('apply mode runs each command with the exact file + args', () => {
    const exec = vi.fn();
    const plan = buildTrustPlan('install', CERT, THUMB, 'win32');
    executePlan('install', CERT, plan, { apply: true, out: () => {}, exec, plat: 'win32' });
    expect(exec).toHaveBeenCalledWith('certutil', ['-addstore', '-user', '-f', 'Root', CERT]);
  });

  it('apply mode skips a failing optional step without throwing', () => {
    const exec = vi.fn((file: string) => {
      if (file === 'certutil') throw new Error('libnss3-tools missing');
    });
    const lines: string[] = [];
    const plan = buildTrustPlan('install', CERT, THUMB, 'linux');
    expect(() =>
      executePlan('install', CERT, plan, {
        apply: true,
        out: (m) => lines.push(m),
        exec,
        plat: 'linux',
      }),
    ).not.toThrow();
    expect(lines.join('\n')).toContain('skipped');
  });

  it('apply mode throws TrustError when a required step fails', () => {
    const exec = vi.fn(() => {
      throw new Error('access denied');
    });
    const plan = buildTrustPlan('install', CERT, THUMB, 'win32');
    expect(() =>
      executePlan('install', CERT, plan, { apply: true, out: () => {}, exec, plat: 'win32' }),
    ).toThrow(TrustError);
  });
});
