import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import { SEED } from '../../src/store/seed.js';
import type { AppRegistration, User } from '../../src/store/types.js';
import { createSigningService, type SigningService } from '../../src/tokens/keys.js';
import { createTokenService, type TokenService } from '../../src/tokens/service.js';
import { LOCAL_IP_ADDRESS } from '../../src/tokens/tokenConfig.js';
import { buildTestStore, type TestStore } from '../helpers/buildTestStore.js';
import { makeTestConfig, TEST_TENANT_ID } from '../helpers/constants.js';
import { testSigningKey } from '../helpers/signingKeyFixture.js';

/**
 * Token-configuration parity (optional claims + group claims). Alice is seeded into 4 groups
 * (Engineering, Developers, Data Team, Local Admins) which exceeds the sample overage limit of 3,
 * so her tokens carry the overage payload; Bob is in 2 groups and receives a `groups` array.
 */

const BASE_NOW = 1_700_000_000;

interface Fixture {
  ts: TestStore;
  signing: SigningService;
  config: Config;
  service: TokenService;
  alice: User;
  bob: User;
  webClient: AppRegistration;
  tokenApi: AppRegistration;
  close(): void;
}

function makeFixture(): Fixture {
  const ts = buildTestStore();
  ts.store.seed();
  ts.store.signingKeys.insert(testSigningKey(TEST_TENANT_ID));
  const signing = createSigningService(ts.store);
  const config = makeTestConfig(ts.dbPath);
  const service = createTokenService({ store: ts.store, signing, config, clock: () => BASE_NOW });
  return {
    ts,
    signing,
    config,
    service,
    alice: ts.store.users.getById(SEED.userAliceId) as User,
    bob: ts.store.users.getById(SEED.userBobId) as User,
    webClient: ts.store.apps.getByAppId(SEED.appWebClientId) as AppRegistration,
    tokenApi: ts.store.apps.getByAppId(SEED.appTokenApiId) as AppRegistration,
    close: () => ts.close(),
  };
}

describe('token configuration — optional claims', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('OptionalClaims_IdToken_UsesClientAppConfiguration', async () => {
    // local-web-client configures email/upn/given_name/family_name/groups on the ID token.
    const res = await fx.service.buildTokenResponse({
      app: fx.webClient,
      user: fx.bob,
      scopes: ['openid', 'profile'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string);
    expect(claims.email).toBe(fx.bob.mail);
    expect(claims.upn).toBe(fx.bob.userPrincipalName);
    expect(claims.given_name).toBe(fx.bob.givenName);
    expect(claims.family_name).toBe(fx.bob.surname);
    // Bob is under the overage limit, so `groups` is a stable array of local group IDs.
    expect(claims.groups).toEqual(
      expect.arrayContaining([SEED.groupEngineeringId, SEED.groupDevelopersId]),
    );
  });

  it('OptionalClaims_AccessToken_UsesResourceAppConfiguration', async () => {
    // Client is local-web-client; the resource is local-api, whose access-token config applies.
    const res = await fx.service.buildTokenResponse({
      app: fx.webClient,
      user: fx.bob,
      scopes: ['openid', `api://${SEED.appTokenApiId}/${SEED.tokenApiScopeValue}`],
      resource: `api://${SEED.appTokenApiId}`,
      grant: 'authorization_code',
    });
    const access = decodeJwt(res.access_token);
    expect(access.aud).toBe(SEED.appTokenApiId);
    // local-api configures email/upn/groups on the access token.
    expect(access.email).toBe(fx.bob.mail);
    expect(access.upn).toBe(fx.bob.userPrincipalName);
    expect(access.groups).toEqual(
      expect.arrayContaining([SEED.groupEngineeringId, SEED.groupDevelopersId]),
    );
    // The client (local-web-client) has no access-token claims; given_name must NOT leak in.
    expect(access.given_name).toBeUndefined();
  });

  it('OptionalClaims_UnsupportedClaim_IsNotEmitted', async () => {
    const warnings: string[] = [];
    const service = createTokenService({
      store: fx.ts.store,
      signing: fx.signing,
      config: fx.config,
      clock: () => BASE_NOW,
      warn: (m) => warnings.push(m),
    });
    fx.ts.store.apps.update(SEED.appWebClientId, {
      optionalClaims: {
        idToken: [
          { name: 'email', essential: false },
          { name: 'acct', essential: false },
        ],
        accessToken: [],
      },
    });
    const app = fx.ts.store.apps.getByAppId(SEED.appWebClientId) as AppRegistration;
    const res = await service.buildTokenResponse({
      app,
      user: fx.bob,
      scopes: ['openid', 'profile'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string);
    expect(claims.email).toBe(fx.bob.mail);
    expect(claims.acct).toBeUndefined();
    expect(warnings.some((w) => w.includes("'acct'"))).toBe(true);
  });

  it('sources the ipaddr claim from the request when configured', async () => {
    fx.ts.store.apps.update(SEED.appWebClientId, {
      optionalClaims: {
        idToken: [{ name: 'ipaddr', essential: false }],
        accessToken: [],
      },
    });
    const app = fx.ts.store.apps.getByAppId(SEED.appWebClientId) as AppRegistration;
    const withIp = await fx.service.buildTokenResponse({
      app,
      user: fx.bob,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
      ipAddress: '10.1.2.3',
    });
    expect(decodeJwt(withIp.id_token as string).ipaddr).toBe('10.1.2.3');
    const noIp = await fx.service.buildTokenResponse({
      app,
      user: fx.bob,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
    });
    expect(decodeJwt(noIp.id_token as string).ipaddr).toBe(LOCAL_IP_ADDRESS);
  });
});

describe('token configuration — group claims', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('GroupClaims_Disabled_DoesNotEmitGroups', async () => {
    // The default seeded SPA has group claims disabled and no `groups` optional claim.
    const spa = fx.ts.store.apps.getByAppId(SEED.appSpaId) as AppRegistration;
    const res = await fx.service.buildTokenResponse({
      app: spa,
      user: fx.alice,
      scopes: ['openid', 'profile'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string);
    expect(claims.groups).toBeUndefined();
    expect(claims._claim_names).toBeUndefined();
  });

  it('GroupClaims_Enabled_EmitsGroupIds', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.webClient,
      user: fx.bob,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string);
    expect(Array.isArray(claims.groups)).toBe(true);
    expect(claims.groups).toHaveLength(2);
    expect(claims._claim_names).toBeUndefined();
  });

  it('GroupClaims_OverLimit_EmitsOveragePayload', async () => {
    // Alice is in 4 groups > the sample overage limit (3): expect the overage claim payload.
    const res = await fx.service.buildTokenResponse({
      app: fx.webClient,
      user: fx.alice,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string) as Record<string, unknown>;
    expect(claims.groups).toBeUndefined();
    expect(claims._claim_names).toEqual({ groups: 'src1' });
    const sources = claims._claim_sources as { src1: { endpoint: string } };
    expect(sources.src1.endpoint).toContain('/graph/v1.0/me/memberOf');
  });
});

describe('token configuration — preview (Portal_TokenPreview_MatchesIssuedToken)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('ID-token preview matches the issued ID token optional/group claims', async () => {
    const preview = fx.service.previewToken({
      app: fx.webClient,
      user: fx.bob,
      tokenType: 'idToken',
      now: BASE_NOW,
    });
    const res = await fx.service.buildTokenResponse({
      app: fx.webClient,
      user: fx.bob,
      scopes: ['openid', 'profile', 'email'],
      resource: null,
      grant: 'authorization_code',
    });
    const issued = decodeJwt(res.id_token as string);
    expect(preview.claims.email).toBe(issued.email);
    expect(preview.claims.upn).toBe(issued.upn);
    expect(preview.claims.given_name).toBe(issued.given_name);
    expect(preview.claims.groups).toEqual(issued.groups);
    expect(preview.groupOverage).toBe(false);
  });

  it('access-token preview reflects the resource app configuration and overage', () => {
    const preview = fx.service.previewToken({
      app: fx.tokenApi,
      user: fx.alice,
      tokenType: 'accessToken',
      now: BASE_NOW,
    });
    expect(preview.claims.email).toBe(fx.alice.mail);
    expect(preview.claims.upn).toBe(fx.alice.userPrincipalName);
    expect(preview.groupOverage).toBe(true);
    expect(preview.claims._claim_names).toEqual({ groups: 'src1' });
  });
});
