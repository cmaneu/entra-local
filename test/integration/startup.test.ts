import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Run src/index.ts via tsx with a given env, returning the exit result. */
function runEntrypoint(extraEnv: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TLS_ENABLED: 'false',
      CONFIG_FILE: './does-not-exist.config.json',
      ...extraEnv,
    },
  });
}

describe('Startup fail-fast on invalid config (criterion 2)', () => {
  it('aborts with a non-zero exit and names the offending key', () => {
    const result = runEntrypoint({ TENANT_ID: 'not-a-guid' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid configuration');
    expect(result.stderr).toContain('TENANT_ID');
  });

  it('aborts on a both-or-neither TLS violation naming TLS_KEY', () => {
    const result = runEntrypoint({ TLS_ENABLED: 'true', TLS_CERT: './cert.pem' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TLS_KEY');
  });
});
