import { createLocalJWKSet, decodeJwt, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED } from '../../src/store/seed.js';
import type { AppRegistration, User } from '../../src/store/types.js';
import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js';
import { TEST_TENANT_ID } from '../helpers/constants.js';

/**
 * Integration: the `app.tokenService` decorator is wired (after store + signing) and a token minted
 * through it verifies against the live JWKS served at `/{tenant}/discovery/v2.0/keys` — proving the
 * end-to-end mint→publish→verify loop that #6/#7/#8/#9/#10 rely on.
 */
describe('app.tokenService wiring (feature #5)', () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await buildTestApp();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('decorates app.tokenService and mints a token that verifies against the published JWKS', async () => {
    expect(ctx.app.tokenService).toBeDefined();
    const alice = ctx.app.store.users.getById(SEED.userAliceId) as User;
    const spa = ctx.app.store.apps.getByAppId(SEED.appSpaId) as AppRegistration;

    const res = await ctx.app.tokenService.buildTokenResponse({
      app: spa,
      user: alice,
      scopes: ['openid', 'profile', 'email', 'offline_access', `api://${spa.appId}/access_as_user`],
      resource: `api://${spa.appId}`,
      nonce: 'wire-test',
      grant: 'authorization_code',
    });
    expect(res.access_token).toBeTruthy();
    expect(res.id_token).toBeTruthy();
    expect(res.refresh_token).toBeTruthy();
    expect(res.client_info).toBeTruthy();

    const jwksResponse = await ctx.inject({
      method: 'GET',
      url: `/${TEST_TENANT_ID}/discovery/v2.0/keys`,
    });
    expect(jwksResponse.statusCode).toBe(200);
    const jwks = createLocalJWKSet(JSON.parse(jwksResponse.body) as JSONWebKeySet);

    const verified = await jwtVerify(res.access_token, jwks);
    expect(verified.payload.iss).toBe(ctx.config.issuer);
    expect(decodeJwt(res.id_token as string).aud).toBe(spa.appId);

    // Round-trip validation via the service itself.
    const validation = await ctx.app.tokenService.validateAccessToken(res.access_token, {
      audience: spa.appId,
      requiredScopes: ['access_as_user'],
    });
    expect(validation.valid).toBe(true);
  });
});
