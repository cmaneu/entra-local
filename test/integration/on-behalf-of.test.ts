import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JWT_BEARER_GRANT } from '../../src/identity/onBehalfOf.js';
import { SEED } from '../../src/store/seed.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

const TOKEN_PATH = `/${TEST_TENANT_ID}/oauth2/v2.0/token`;
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };
const GRAPH = 'https://graph.microsoft.com';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await buildTestApp();
});

afterEach(async () => {
  await ctx.close();
});

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function assertion(
  audience: string = SEED.appOboApiId,
  appId: string = SEED.appOboSpaId,
): Promise<string> {
  const app = ctx.app.store.apps.getByAppId(appId)!;
  const user = ctx.app.store.users.getById(SEED.userBobId)!;
  return (
    await ctx.app.tokenService.buildTokenResponse({
      app,
      user,
      scopes: [`api://${SEED.appOboApiId}/${SEED.oboApiScopeValue}`],
      audience,
      grant: 'authorization_code',
    })
  ).access_token;
}

async function exchange(
  overrides: Record<string, string> = {},
  requestAssertion?: string,
) {
  return ctx.inject({
    method: 'POST',
    url: TOKEN_PATH,
    headers: FORM_HEADERS,
    payload: form({
      grant_type: JWT_BEARER_GRANT,
      requested_token_use: 'on_behalf_of',
      client_id: SEED.appOboApiId,
      client_secret: SEED.oboApiSecret,
      assertion: requestAssertion ?? (await assertion()),
      scope: 'User.Read',
      ...overrides,
    }),
  });
}

async function verifiedClaims(token: string): Promise<Record<string, unknown>> {
  const jwksResponse = await ctx.inject({
    method: 'GET',
    url: `/${TEST_TENANT_ID}/discovery/v2.0/keys`,
  });
  const jwks = createLocalJWKSet(jwksResponse.json() as JSONWebKeySet);
  return (
    await jwtVerify(token, jwks, {
      issuer: ctx.config.issuer,
    })
  ).payload;
}

describe('on-behalf-of token exchange', () => {
  it('exchanges a custom API token for Graph while preserving oid and transitioning azp', async () => {
    const incoming = await assertion();
    const before = Object.fromEntries(
      ['authorization_codes', 'refresh_tokens', 'sessions', 'device_codes'].map((table) => [
        table,
        (ctx.app.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
      ]),
    );

    const response = await exchange({}, incoming);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as Record<string, string>;
    expect(body.id_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
    expect(body.client_info).toBeTruthy();

    const inputClaims = await verifiedClaims(incoming);
    const outputClaims = await verifiedClaims(body.access_token!);
    expect(inputClaims.aud).toBe(SEED.appOboApiId);
    expect(inputClaims.azp).toBe(SEED.appOboSpaId);
    expect(outputClaims).toMatchObject({
      aud: GRAPH,
      oid: SEED.userBobId,
      azp: SEED.appOboApiId,
      appid: SEED.appOboApiId,
      scp: 'User.Read',
    });
    expect(outputClaims.oid).toBe(inputClaims.oid);
    expect(outputClaims.sub).not.toBe(inputClaims.sub);

    const after = Object.fromEntries(
      Object.keys(before).map((table) => [
        table,
        (ctx.app.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
      ]),
    );
    expect(after).toEqual(before);
  });

  it('targets a registered downstream API and applies its token configuration', async () => {
    const response = await exchange({
      scope: `api://${SEED.appTokenApiId}/${SEED.tokenApiScopeValue}`,
    });
    expect(response.statusCode).toBe(200);
    const claims = await verifiedClaims(
      (response.json() as { access_token: string }).access_token,
    );
    expect(claims).toMatchObject({
      aud: SEED.appTokenApiId,
      oid: SEED.userBobId,
      azp: SEED.appOboApiId,
      scp: SEED.tokenApiScopeValue,
      email: 'bob@entralocal.dev',
      upn: 'bob@entralocal.dev',
    });
    expect(claims.groups).toEqual([SEED.groupEngineeringId, SEED.groupDevelopersId]);
  });

  it('permits repeated exchanges while the assertion remains valid', async () => {
    const incoming = await assertion();
    expect((await exchange({}, incoming)).statusCode).toBe(200);
    expect((await exchange({}, incoming)).statusCode).toBe(200);
  });

  it.each([
    ['missing assertion', { assertion: '' }, 'invalid_request'],
    ['missing scope', { scope: '' }, 'invalid_request'],
    ['wrong requested token use', { requested_token_use: 'access_token' }, 'invalid_request'],
    ['OIDC scope', { scope: 'openid' }, 'invalid_scope'],
    ['offline access', { scope: 'offline_access' }, 'invalid_scope'],
    ['default scope', { scope: `${GRAPH}/.default` }, 'invalid_scope'],
    [
      'mixed resources',
      { scope: `User.Read api://${SEED.appTokenApiId}/${SEED.tokenApiScopeValue}` },
      'invalid_scope',
    ],
    ['unknown API scope', { scope: 'api://missing/access_as_user' }, 'invalid_scope'],
  ])('rejects %s', async (_name, overrides, error) => {
    const response = await exchange(overrides);
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe(error);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['unknown client', { client_id: 'missing' }],
    ['wrong secret', { client_secret: 'wrong' }],
    ['public client', { client_id: SEED.appOboSpaId, client_secret: '' }],
  ])('rejects %s as invalid_client', async (_name, overrides) => {
    const response = await exchange(overrides);
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: string }).error).toBe('invalid_client');
  });

  it('rejects malformed and wrong-audience assertions as invalid_grant', async () => {
    const malformed = await exchange({}, 'not-a-jwt');
    expect((malformed.json() as { error: string }).error).toBe('invalid_grant');

    const wrongAudience = await exchange({}, await assertion(GRAPH));
    expect((wrongAudience.json() as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects app-only assertions and missing or disabled users as invalid_grant', async () => {
    const middle = ctx.app.store.apps.getByAppId(SEED.appOboApiId)!;
    const appOnly = (
      await ctx.app.tokenService.buildTokenResponse({
        app: middle,
        user: null,
        scopes: [],
        audience: SEED.appOboApiId,
        grant: 'client_credentials',
      })
    ).access_token;
    expect((await exchange({}, appOnly)).json()).toMatchObject({ error: 'invalid_grant' });

    ctx.app.store.users.update(SEED.userBobId, { accountEnabled: false });
    expect((await exchange()).json()).toMatchObject({ error: 'invalid_grant' });
  });
});
