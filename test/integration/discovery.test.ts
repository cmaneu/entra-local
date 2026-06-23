import { afterEach, describe, expect, it } from 'vitest';
import type { DiscoveryMetadata } from '../../src/identity/metadata.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_HOST, TEST_PORT, TEST_TENANT_ID } from '../helpers/constants.js';

const ORIGIN = `http://${TEST_HOST}:${TEST_PORT}`;

let ctx: TestApp;

afterEach(async () => {
  await ctx?.close();
});

/** Fetch + parse the discovery document for a given tenant segment. */
async function getDiscovery(
  app: TestApp,
  tenant: string,
): Promise<{ status: number; headers: Record<string, unknown>; doc: DiscoveryMetadata }> {
  const res = await app.inject({
    method: 'GET',
    url: `/${tenant}/v2.0/.well-known/openid-configuration`,
  });
  return {
    status: res.statusCode,
    headers: res.headers,
    doc: res.json() as DiscoveryMetadata,
  };
}

describe('OIDC discovery document shape (criterion 1)', () => {
  it('returns 200 JSON with all required fields as absolute URLs from PUBLIC_ORIGIN', async () => {
    ctx = await buildTestApp();
    const { status, headers, doc } = await getDiscovery(ctx, TEST_TENANT_ID);

    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/json');

    // Exact MSAL-tuned field set (spec #4), verbatim.
    expect(doc).toEqual({
      issuer: `${ORIGIN}/${TEST_TENANT_ID}/v2.0`,
      authorization_endpoint: `${ORIGIN}/${TEST_TENANT_ID}/oauth2/v2.0/authorize`,
      token_endpoint: `${ORIGIN}/${TEST_TENANT_ID}/oauth2/v2.0/token`,
      jwks_uri: `${ORIGIN}/${TEST_TENANT_ID}/discovery/v2.0/keys`,
      userinfo_endpoint: `${ORIGIN}/graph/oidc/userinfo`,
      end_session_endpoint: `${ORIGIN}/${TEST_TENANT_ID}/oauth2/v2.0/logout`,
      response_types_supported: ['code'],
      response_modes_supported: ['query', 'fragment'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      subject_types_supported: ['pairwise'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      code_challenge_methods_supported: ['S256', 'plain'],
      claims_supported: [
        'sub',
        'iss',
        'aud',
        'exp',
        'iat',
        'nbf',
        'tid',
        'oid',
        'name',
        'preferred_username',
        'email',
        'nonce',
        'ver',
      ],
    });

    // Every URL field is an absolute URL on the configured origin.
    for (const field of [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'userinfo_endpoint',
      'end_session_endpoint',
    ] as const) {
      expect(doc[field], field).toMatch(/^https?:\/\//);
      expect(doc[field].startsWith(ORIGIN), field).toBe(true);
    }
  });
});

describe('OIDC discovery alias issuer parity (criterion 3)', () => {
  it('returns the same GUID-form issuer and identical endpoint URLs for every alias', async () => {
    ctx = await buildTestApp();
    const bodies: string[] = [];
    for (const tenant of [TEST_TENANT_ID, 'common', 'organizations', 'consumers']) {
      const { status, doc } = await getDiscovery(ctx, tenant);
      expect(status, tenant).toBe(200);
      // Issuer is always the concrete GUID, never the alias literal.
      expect(doc.issuer, tenant).toBe(`${ORIGIN}/${TEST_TENANT_ID}/v2.0`);
      if (tenant !== TEST_TENANT_ID) {
        expect(doc.issuer, tenant).not.toContain(tenant);
      }
      bodies.push(JSON.stringify(doc));
    }
    // The entire document (issuer + all endpoint URLs) is byte-identical across aliases.
    for (const body of bodies) {
      expect(body).toBe(bodies[0]);
    }
  });
});

describe('OIDC discovery invalid tenant (criterion 4)', () => {
  it('rejects an unknown tenant with a JSON 404 (never SPA HTML)', async () => {
    ctx = await buildTestApp();
    const res = await ctx.inject({
      method: 'GET',
      url: '/not-a-tenant/v2.0/.well-known/openid-configuration',
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).not.toContain('<!doctype html');
    expect(res.body).not.toContain('<html');
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('tenant_not_found');
  });
});

describe('OIDC discovery Iteration 1 lockstep (criterion 5)', () => {
  it('omits the device endpoint/grant and form_post; advertises exactly query+fragment', async () => {
    ctx = await buildTestApp();
    const { doc } = await getDiscovery(ctx, TEST_TENANT_ID);

    // No device-code grant, no device_authorization_endpoint (added by #15).
    expect(doc.grant_types_supported).not.toContain('urn:ietf:params:oauth:grant-type:device_code');
    expect(doc).not.toHaveProperty('device_authorization_endpoint');

    // response_modes_supported is exactly ["query","fragment"] — no form_post in Iteration 1.
    expect(doc.response_modes_supported).toEqual(['query', 'fragment']);
    expect(doc.response_modes_supported).not.toContain('form_post');

    // No Microsoft cloud-host fields.
    for (const msField of [
      'tenant_region_scope',
      'cloud_instance_name',
      'cloud_graph_host_name',
      'msgraph_host',
      'rbac_url',
    ]) {
      expect(doc).not.toHaveProperty(msField);
    }
  });

  it('advertises only endpoints that resolve to a registered route (never a bare 404/SPA)', async () => {
    ctx = await buildTestApp();
    const { doc } = await getDiscovery(ctx, TEST_TENANT_ID);

    const advertised = [
      doc.authorization_endpoint,
      doc.token_endpoint,
      doc.jwks_uri,
      doc.userinfo_endpoint,
      doc.end_session_endpoint,
    ];

    for (const url of advertised) {
      const path = new URL(url).pathname;
      // An advertised endpoint may be registered under GET and/or POST. Probe both; at least
      // one must resolve to a registered route (non-404), and the registered response is JSON.
      const get = await ctx.inject({ method: 'GET', url: path });
      const post = await ctx.inject({ method: 'POST', url: path });
      const registered = [get, post].filter((r) => r.statusCode !== 404);
      expect(registered.length, `${path} should map to a registered route`).toBeGreaterThan(0);
      for (const res of registered) {
        // A registered route returns JSON (a 200/JSON handler or a 501 stub) or, for the
        // interactive `/authorize` sign-in endpoint (#6), a server-rendered HTML page — never the
        // SPA placeholder (reserved API paths resolve to a real handler or JSON 404, not the SPA).
        const contentType = res.headers['content-type'] ?? '';
        expect(
          contentType.includes('application/json') || contentType.includes('text/html'),
          path,
        ).toBe(true);
      }
    }
  });
});

describe('OIDC discovery JWKS link (criterion 6)', () => {
  it('jwks_uri equals the live #3 JWKS path and fetching it returns a JWK Set', async () => {
    ctx = await buildTestApp();
    const { doc } = await getDiscovery(ctx, TEST_TENANT_ID);

    expect(doc.jwks_uri).toBe(`${ORIGIN}/${TEST_TENANT_ID}/discovery/v2.0/keys`);

    const jwksPath = new URL(doc.jwks_uri).pathname;
    const res = await ctx.inject({ method: 'GET', url: jwksPath });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const jwks = res.json() as { keys: unknown[] };
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });
});

describe('OIDC discovery cache headers (criterion 8)', () => {
  it('sets Cache-Control: public, max-age=3600', async () => {
    ctx = await buildTestApp();
    const { headers } = await getDiscovery(ctx, TEST_TENANT_ID);
    expect(headers['cache-control']).toBe('public, max-age=3600');
  });
});
