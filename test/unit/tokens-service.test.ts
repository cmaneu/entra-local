import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config/schema.js';
import { SEED } from '../../src/store/seed.js';
import type { AppRegistration, User } from '../../src/store/types.js';
import { pairwiseSub } from '../../src/tokens/claims.js';
import { createSigningService, type SigningService } from '../../src/tokens/keys.js';
import { buildClientInfo } from '../../src/tokens/response.js';
import { createTokenService, type TokenService } from '../../src/tokens/service.js';
import { TokenValidationError } from '../../src/tokens/validate.js';
import { buildTestStore, type TestStore } from '../helpers/buildTestStore.js';
import { makeTestConfig, TEST_TENANT_ID } from '../helpers/constants.js';
import { testSigningKey } from '../helpers/signingKeyFixture.js';

/** Base clock for all token tests (Nov 2023). Tokens are validated with this same injected clock. */
const BASE_NOW = 1_700_000_000;

/** Deep-merge config overrides (nested tls / tokenLifetimes) like the app harness does. */
function mergeConfig(base: Config, overrides?: Partial<Config>): Config {
  if (!overrides) return base;
  return Object.freeze({
    ...base,
    ...overrides,
    tls: Object.freeze({ ...base.tls, ...overrides.tls }),
    tokenLifetimes: Object.freeze({ ...base.tokenLifetimes, ...overrides.tokenLifetimes }),
  }) satisfies Config;
}

interface Fixture {
  ts: TestStore;
  signing: SigningService;
  config: Config;
  service: TokenService;
  alice: User;
  spa: AppRegistration;
  daemon: AppRegistration;
  jwks: ReturnType<typeof createLocalJWKSet>;
  setNow(n: number): void;
  advance(seconds: number): void;
  close(): void;
}

function makeFixture(overrides?: Partial<Config>): Fixture {
  const ts = buildTestStore();
  ts.store.seed();
  ts.store.signingKeys.insert(testSigningKey(TEST_TENANT_ID));
  const signing = createSigningService(ts.store);
  let now = BASE_NOW;
  const config = mergeConfig(makeTestConfig(ts.dbPath), overrides);
  const service = createTokenService({ store: ts.store, signing, config, clock: () => now });
  return {
    ts,
    signing,
    config,
    service,
    alice: ts.store.users.getById(SEED.userAliceId) as User,
    spa: ts.store.apps.getByAppId(SEED.appSpaId) as AppRegistration,
    daemon: ts.store.apps.getByAppId(SEED.appDaemonId) as AppRegistration,
    jwks: createLocalJWKSet(signing.listJwks(TEST_TENANT_ID)),
    setNow: (n) => {
      now = n;
    },
    advance: (seconds) => {
      now += seconds;
    },
    close: () => ts.close(),
  };
}

const SPA_RESOURCE = `api://${SEED.appSpaId}`;
const SPA_SCOPE = `${SPA_RESOURCE}/${SEED.spaScopeValue}`;
const DELEGATED_SCOPES = ['openid', 'profile', 'email', 'offline_access', SPA_SCOPE];

/** S256 PKCE challenge for a verifier (RFC 7636). */
function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

describe('token service — ID token claims (criterion 1)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('mints an ID token with every claim and correct values, nonce echoed', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      nonce: 'n-12345',
      grant: 'authorization_code',
    });
    expect(res.id_token).toBeDefined();
    const claims = decodeJwt(res.id_token as string);
    expect(claims.iss).toBe(fx.config.issuer);
    expect(claims.aud).toBe(fx.spa.appId);
    expect(claims.ver).toBe('2.0');
    expect(claims.nonce).toBe('n-12345');
    expect(claims.tid).toBe(TEST_TENANT_ID);
    expect(claims.oid).toBe(fx.alice.id);
    expect(claims.sub).toBe(pairwiseSub(fx.alice.id, fx.spa.appId, TEST_TENANT_ID));
    expect(claims.name).toBe(fx.alice.displayName);
    expect(claims.preferred_username).toBe(fx.alice.userPrincipalName);
    expect(claims.email).toBe(fx.alice.mail);
    expect(claims.iat).toBe(BASE_NOW);
    expect(claims.nbf).toBe(BASE_NOW);
    expect(claims.exp).toBe(BASE_NOW + 3600);
  });

  it('omits nonce when not supplied and omits email when email scope absent', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: ['openid', 'profile'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.id_token as string);
    expect(claims.nonce).toBeUndefined();
    expect(claims.email).toBeUndefined();
  });
});

describe('token service — client_info (criterion 2)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('includes client_info for delegated flows with the exact base64url value', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    const expected = buildClientInfo(fx.alice.id, TEST_TENANT_ID);
    expect(res.client_info).toBe(expected);
    const decoded = JSON.parse(Buffer.from(res.client_info as string, 'base64url').toString());
    expect(decoded).toEqual({ uid: fx.alice.id, utid: TEST_TENANT_ID });
  });

  it('omits client_info for app-only (client credentials) flows', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.daemon,
      scopes: [`${fx.config.graphResourceId}/.default`],
      resource: fx.config.graphResourceId,
      roles: [SEED.daemonRoleValue],
      grant: 'client_credentials',
    });
    expect(res.client_info).toBeUndefined();
    expect(res.id_token).toBeUndefined();
    expect(res.refresh_token).toBeUndefined();
  });
});

describe('token service — delegated access token (criterion 3)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('carries scp/azp/appid/oid and the resource audience, no roles', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.access_token);
    // offline_access is a grant marker, excluded from scp; resource prefix stripped.
    expect(claims.scp).toBe('openid profile email access_as_user');
    expect(claims.azp).toBe(fx.spa.appId);
    expect(claims.appid).toBe(fx.spa.appId);
    expect(claims.oid).toBe(fx.alice.id);
    expect(claims.aud).toBe(fx.spa.appId); // api:// uri resolves to the resource app's appId
    expect(claims.roles).toBeUndefined();
    expect(claims.sub).toBe(pairwiseSub(fx.alice.id, fx.spa.appId, TEST_TENANT_ID));
    expect(res.scope).toBe('openid profile email offline_access access_as_user');
  });

  it('defaults audience to the Graph resource when no resource scope is requested', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: ['openid', 'profile', 'email'],
      resource: null,
      grant: 'authorization_code',
    });
    const claims = decodeJwt(res.access_token);
    expect(claims.aud).toBe(fx.config.graphResourceId);
    expect(claims.scp).toBe('openid profile email');
  });
});

describe('token service — app-only access token (criterion 4)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('carries roles array and sub==appId, no oid/scp', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.daemon,
      scopes: [`${fx.config.graphResourceId}/.default`],
      resource: fx.config.graphResourceId,
      roles: [SEED.daemonRoleValue],
      grant: 'client_credentials',
    });
    const claims = decodeJwt(res.access_token);
    expect(claims.roles).toEqual([SEED.daemonRoleValue]);
    expect(claims.sub).toBe(fx.daemon.appId);
    expect(claims.oid).toBeUndefined();
    expect(claims.scp).toBeUndefined();
    expect(claims.aud).toBe(fx.config.graphResourceId);
    expect(claims.appid).toBe(fx.daemon.appId);
    expect(claims.azp).toBe(fx.daemon.appId);
  });
});

describe('token service — signature / JWKS (criterion 5)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('every minted token verifies against the live JWKS', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    const opts = { currentDate: new Date(BASE_NOW * 1000) };
    await expect(jwtVerify(res.access_token, fx.jwks, opts)).resolves.toBeDefined();
    await expect(jwtVerify(res.id_token as string, fx.jwks, opts)).resolves.toBeDefined();
    const header = decodeProtectedHeader(res.access_token);
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(header.kid).toBe(testSigningKey().kid);
  });

  it('fails verification when the payload is tampered', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    const [h, p, s] = res.access_token.split('.');
    const forged = JSON.parse(Buffer.from(p as string, 'base64url').toString());
    forged.oid = '00000000-0000-0000-0000-000000000000';
    const tamperedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    await expect(
      jwtVerify(tampered, fx.jwks, { currentDate: new Date(BASE_NOW * 1000) }),
    ).rejects.toThrow();
  });

  it('fails verification when the kid is swapped to an unknown key', async () => {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    const [, p, s] = res.access_token.split('.');
    const forgedHeader = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'nope' }),
    ).toString('base64url');
    const tampered = `${forgedHeader}.${p}.${s}`;
    await expect(
      jwtVerify(tampered, fx.jwks, { currentDate: new Date(BASE_NOW * 1000) }),
    ).rejects.toThrow();
  });
});

describe('token service — lifetimes (criterion 6)', () => {
  it('exp-iat equals configured lifetimes and expires_in matches access TTL', async () => {
    const fx = makeFixture();
    try {
      const res = await fx.service.buildTokenResponse({
        app: fx.spa,
        user: fx.alice,
        scopes: DELEGATED_SCOPES,
        resource: SPA_RESOURCE,
        grant: 'authorization_code',
      });
      const access = decodeJwt(res.access_token);
      const id = decodeJwt(res.id_token as string);
      expect((access.exp as number) - (access.iat as number)).toBe(3600);
      expect((id.exp as number) - (id.iat as number)).toBe(3600);
      expect(res.expires_in).toBe(3600);
      expect(res.ext_expires_in).toBe(3600);
    } finally {
      fx.close();
    }
  });

  it('honors TOKEN_LIFETIME_* overrides', async () => {
    const fx = makeFixture({
      tokenLifetimes: {
        authCode: 120,
        idToken: 500,
        accessToken: 1000,
        refreshToken: 86400,
        deviceCode: 900,
      },
    });
    try {
      const res = await fx.service.buildTokenResponse({
        app: fx.spa,
        user: fx.alice,
        scopes: DELEGATED_SCOPES,
        resource: SPA_RESOURCE,
        grant: 'authorization_code',
      });
      const access = decodeJwt(res.access_token);
      const id = decodeJwt(res.id_token as string);
      expect((access.exp as number) - (access.iat as number)).toBe(1000);
      expect((id.exp as number) - (id.iat as number)).toBe(500);
      expect(res.expires_in).toBe(1000);
    } finally {
      fx.close();
    }
  });
});

describe('token service — auth code single-use + PKCE (criterion 7)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  function issue(extra?: { codeChallenge?: string; codeChallengeMethod?: string }) {
    return fx.service.issueAuthCode({
      appId: fx.spa.appId,
      userId: fx.alice.id,
      redirectUri: SEED.spaRedirectUri,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      nonce: 'abc',
      ...extra,
    });
  }

  it('redeems once with S256 verifier and returns the grant', () => {
    const verifier = 'verifier-1234567890-abcdefghijklmnop';
    const code = issue({ codeChallenge: s256(verifier), codeChallengeMethod: 'S256' });
    const result = fx.service.redeemAuthCode({
      code,
      appId: fx.spa.appId,
      redirectUri: SEED.spaRedirectUri,
      codeVerifier: verifier,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(fx.alice.id);
      expect(result.scopes).toEqual(DELEGATED_SCOPES);
      expect(result.resource).toBe(SPA_RESOURCE);
      expect(result.nonce).toBe('abc');
    }
  });

  it('validates plain PKCE', () => {
    const verifier = 'plain-verifier-value';
    const code = issue({ codeChallenge: verifier, codeChallengeMethod: 'plain' });
    const result = fx.service.redeemAuthCode({
      code,
      appId: fx.spa.appId,
      redirectUri: SEED.spaRedirectUri,
      codeVerifier: verifier,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects replay (single-use)', () => {
    const verifier = 'verifier-1234567890-abcdefghijklmnop';
    const code = issue({ codeChallenge: s256(verifier), codeChallengeMethod: 'S256' });
    const base = {
      code,
      appId: fx.spa.appId,
      redirectUri: SEED.spaRedirectUri,
      codeVerifier: verifier,
    };
    expect(fx.service.redeemAuthCode(base).ok).toBe(true);
    const replay = fx.service.redeemAuthCode(base);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toBe('invalid_grant');
  });

  it('rejects an expired code', () => {
    const code = issue();
    fx.advance(301);
    const result = fx.service.redeemAuthCode({
      code,
      appId: fx.spa.appId,
      redirectUri: SEED.spaRedirectUri,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects wrong redirect_uri and wrong app_id', () => {
    const code1 = issue();
    expect(
      fx.service.redeemAuthCode({
        code: code1,
        appId: fx.spa.appId,
        redirectUri: 'https://evil.example/callback',
      }).ok,
    ).toBe(false);
    const code2 = issue();
    expect(
      fx.service.redeemAuthCode({
        code: code2,
        appId: fx.daemon.appId,
        redirectUri: SEED.spaRedirectUri,
      }).ok,
    ).toBe(false);
  });

  it('rejects missing and incorrect PKCE verifiers', () => {
    const verifier = 'verifier-1234567890-abcdefghijklmnop';
    const codeMissing = issue({ codeChallenge: s256(verifier), codeChallengeMethod: 'S256' });
    expect(
      fx.service.redeemAuthCode({
        code: codeMissing,
        appId: fx.spa.appId,
        redirectUri: SEED.spaRedirectUri,
      }).ok,
    ).toBe(false);
    const codeWrong = issue({ codeChallenge: s256(verifier), codeChallengeMethod: 'S256' });
    expect(
      fx.service.redeemAuthCode({
        code: codeWrong,
        appId: fx.spa.appId,
        redirectUri: SEED.spaRedirectUri,
        codeVerifier: 'wrong-verifier',
      }).ok,
    ).toBe(false);
  });
});

describe('token service — refresh rotation (criterion 8)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('rotates: new token issued, old revoked, revoked replay → invalid_grant', () => {
    const token = fx.service.issueRefreshToken({
      appId: fx.spa.appId,
      userId: fx.alice.id,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
    });
    const result = fx.service.redeemRefreshToken({ token, appId: fx.spa.appId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRefreshToken).not.toBe(token);
    expect(result.userId).toBe(fx.alice.id);
    expect(result.resource).toBe(SPA_RESOURCE);

    // The new (rotated) token works once, before any replay (rotates B -> C).
    expect(
      fx.service.redeemRefreshToken({ token: result.newRefreshToken, appId: fx.spa.appId }).ok,
    ).toBe(true);

    // Replaying the original (now-revoked) token is reuse → invalid_grant. Per #7's finalized
    // rotation policy this also revokes the rest of the chain (asserted by the #7 reuse test).
    const replay = fx.service.redeemRefreshToken({ token, appId: fx.spa.appId });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toBe('invalid_grant');
  });

  it('enforces subset scope-down and defaults to the original grant', () => {
    const token = fx.service.issueRefreshToken({
      appId: fx.spa.appId,
      userId: fx.alice.id,
      scopes: ['openid', 'profile', SPA_SCOPE],
      resource: SPA_RESOURCE,
    });
    // Requesting a scope outside the grant is rejected.
    const over = fx.service.redeemRefreshToken({
      token,
      appId: fx.spa.appId,
      requestedScopes: ['openid', 'profile', 'Mail.Read'],
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toBe('invalid_scope');

    // A subset narrows the grant.
    const subset = fx.service.redeemRefreshToken({
      token,
      appId: fx.spa.appId,
      requestedScopes: ['openid', SPA_SCOPE],
    });
    expect(subset.ok).toBe(true);
    if (subset.ok) expect(subset.scopes).toEqual(['openid', SPA_SCOPE]);
  });

  it('rejects an unknown app_id and expired token', () => {
    const token = fx.service.issueRefreshToken({
      appId: fx.spa.appId,
      userId: fx.alice.id,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
    });
    expect(fx.service.redeemRefreshToken({ token, appId: fx.daemon.appId }).ok).toBe(false);

    const token2 = fx.service.issueRefreshToken({
      appId: fx.spa.appId,
      userId: fx.alice.id,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
    });
    fx.advance(86_401);
    expect(fx.service.redeemRefreshToken({ token: token2, appId: fx.spa.appId }).ok).toBe(false);
  });
});

describe('token service — validateAccessToken (criterion 9)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  async function delegatedToken(): Promise<string> {
    const res = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      grant: 'authorization_code',
    });
    return res.access_token;
  }

  it('accepts a fresh token with matching aud and required scope', async () => {
    const token = await delegatedToken();
    const result = await fx.service.validateAccessToken(`Bearer ${token}`, {
      audience: fx.spa.appId,
      requiredScopes: ['access_as_user'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects an expired token', async () => {
    const token = await delegatedToken();
    fx.advance(3600 + 120);
    const result = await fx.service.validateAccessToken(token, { audience: fx.spa.appId });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe(TokenValidationError.Expired);
  });

  it('rejects a wrong-issuer token', async () => {
    const forged = await fx.service.mintAccessToken(TEST_TENANT_ID, {
      iss: 'https://attacker.example/v2.0',
      sub: 'x',
      aud: fx.spa.appId,
      exp: BASE_NOW + 3600,
      iat: BASE_NOW,
      nbf: BASE_NOW,
      tid: TEST_TENANT_ID,
      azp: fx.spa.appId,
      appid: fx.spa.appId,
      scp: 'access_as_user',
      ver: '2.0',
    });
    const result = await fx.service.validateAccessToken(forged, { audience: fx.spa.appId });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe(TokenValidationError.InvalidIssuer);
  });

  it('rejects a wrong-audience token', async () => {
    const token = await delegatedToken();
    const result = await fx.service.validateAccessToken(token, { audience: 'some-other-audience' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe(TokenValidationError.InvalidAudience);
  });

  it('rejects a wrong-alg token before signature checks', async () => {
    const hs = await new SignJWT({
      iss: fx.config.issuer,
      aud: fx.spa.appId,
      exp: BASE_NOW + 3600,
      iat: BASE_NOW,
      nbf: BASE_NOW,
      scp: 'access_as_user',
    })
      .setProtectedHeader({ alg: 'HS256', kid: testSigningKey().kid })
      .sign(new TextEncoder().encode('symmetric-key-padding-padding-32'));
    const result = await fx.service.validateAccessToken(hs, { audience: fx.spa.appId });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe(TokenValidationError.InvalidAlgorithm);
  });

  it('rejects a token missing a required scope or role', async () => {
    const token = await delegatedToken();
    const scope = await fx.service.validateAccessToken(token, {
      audience: fx.spa.appId,
      requiredScopes: ['Mail.Read'],
    });
    expect(scope.valid).toBe(false);
    if (!scope.valid) expect(scope.error).toBe(TokenValidationError.InsufficientScope);

    const appRes = await fx.service.buildTokenResponse({
      app: fx.daemon,
      scopes: [`${fx.config.graphResourceId}/.default`],
      resource: fx.config.graphResourceId,
      roles: [SEED.daemonRoleValue],
      grant: 'client_credentials',
    });
    const role = await fx.service.validateAccessToken(appRes.access_token, {
      requiredRoles: ['Directory.ReadWrite.All'],
    });
    expect(role.valid).toBe(false);
    if (!role.valid) expect(role.error).toBe(TokenValidationError.InsufficientRole);
  });

  it('rejects malformed input', async () => {
    const result = await fx.service.validateAccessToken('not-a-jwt');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe(TokenValidationError.Malformed);
  });
});

describe('token service — deterministic sub (criterion 10)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('is stable per (user, app) and differs across apps', async () => {
    const a = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
    });
    const b = await fx.service.buildTokenResponse({
      app: fx.spa,
      user: fx.alice,
      scopes: ['openid'],
      resource: null,
      grant: 'authorization_code',
    });
    const subA = decodeJwt(a.access_token).sub;
    const subB = decodeJwt(b.access_token).sub;
    expect(subA).toBe(subB);
    expect(subA).toBe(pairwiseSub(fx.alice.id, fx.spa.appId, TEST_TENANT_ID));
    expect(pairwiseSub(fx.alice.id, fx.daemon.appId, TEST_TENANT_ID)).not.toBe(subA);
  });
});

describe('token service — clock injection reproducibility (criterion 11)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => fx.close());

  it('produces byte-identical tokens under a fixed clock', async () => {
    const params = {
      app: fx.spa,
      user: fx.alice,
      scopes: DELEGATED_SCOPES,
      resource: SPA_RESOURCE,
      nonce: 'fixed',
      grant: 'authorization_code' as const,
    };
    const first = await fx.service.buildTokenResponse(params);
    const second = await fx.service.buildTokenResponse(params);
    // RS256 (RSASSA-PKCS1-v1_5) is deterministic: identical claims + key → identical JWT.
    expect(second.access_token).toBe(first.access_token);
    expect(second.id_token).toBe(first.id_token);
    const claims = decodeJwt(first.access_token);
    expect(claims.iat).toBe(BASE_NOW);
    expect(claims.exp).toBe(BASE_NOW + 3600);
  });
});
