import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/schema.js';
import { buildIssuer } from '../identity/metadata.js';
import type { Store } from '../store/store.js';
import type { Clock } from '../store/util.js';
import { systemClock } from '../store/util.js';
import {
  createAuthCodeService,
  type IssueAuthCodeParams,
  type RedeemAuthCodeParams,
  type RedeemAuthCodeResult,
} from './authCode.js';
import type { AccessTokenClaims, IdTokenClaims } from './claims.js';
import { buildDelegatedAccessClaims, buildIdTokenClaims, pairwiseSub } from './claims.js';
import type { SigningService } from './keys.js';
import { mintAccessToken, mintIdToken } from './mint.js';
import type { AppRegistration, User } from '../store/types.js';
import { resolveAppTokenClaims, type OptionalClaimKind } from './tokenConfig.js';
import {
  createRefreshTokenService,
  type IssueRefreshTokenParams,
  type RedeemRefreshTokenParams,
  type RedeemRefreshTokenResult,
} from './refresh.js';
import {
  createTokenResponseBuilder,
  type BuildTokenResponseParams,
  type TokenResponse,
} from './response.js';
import {
  createAccessTokenValidator,
  type ValidateAccessTokenOptions,
  type ValidateAccessTokenResult,
} from './validate.js';

/**
 * The aggregate token service (feature #5): the single source of truth for JWT claim sets, token
 * lifetimes and the auth-code/refresh-token issuance + validation contracts. Exposed to grant
 * endpoints as the `app.tokenService` decorator. #6 calls `redeemAuthCode` + `buildTokenResponse`;
 * #7 calls `redeemRefreshToken` + `buildTokenResponse`; #8 calls `buildTokenResponse` (app-only);
 * #9/#10 call `validateAccessToken`.
 */
export interface TokenService {
  /** Build the OAuth token-endpoint success JSON (access/id/refresh tokens + `client_info`). */
  buildTokenResponse(params: BuildTokenResponseParams): Promise<TokenResponse>;
  /** Mint a signed ID token from assembled claims (low-level; `buildTokenResponse` is preferred). */
  mintIdToken(tenantId: string, claims: IdTokenClaims): Promise<string>;
  /** Mint a signed access token from assembled claims (low-level). */
  mintAccessToken(tenantId: string, claims: AccessTokenClaims): Promise<string>;
  /** Validate an incoming bearer access token (signature/iss/aud/exp/nbf/scope/role). */
  validateAccessToken(
    bearer: string,
    opts?: ValidateAccessTokenOptions,
  ): Promise<ValidateAccessTokenResult>;
  /** Issue an opaque single-use authorization code (persisted). Returns the code. */
  issueAuthCode(params: IssueAuthCodeParams): string;
  /** Redeem + consume an authorization code (validates app/redirect/PKCE binding). */
  redeemAuthCode(params: RedeemAuthCodeParams): RedeemAuthCodeResult;
  /** Issue an opaque refresh token (stored hashed). Returns the plaintext token. */
  issueRefreshToken(params: IssueRefreshTokenParams): string;
  /** Redeem + rotate a refresh token (revoke old, issue new; subset scope-down). */
  redeemRefreshToken(params: RedeemRefreshTokenParams): RedeemRefreshTokenResult;
  /** Deterministic pairwise subject for (user, app, tenant). */
  pairwiseSub(userId: string, appId: string, tenantId: string): string;
  /**
   * Build a decoded (unsigned) token-claims preview for a selected user + token type, applying the
   * app's configured optional/group claims exactly as issuance would. Powers the portal preview so
   * the shown payload provably matches the issued token.
   */
  previewToken(params: TokenPreviewParams): TokenPreviewResult;
}

/** Parameters for {@link TokenService.previewToken}. */
export interface TokenPreviewParams {
  /** The app being configured: the client app for `idToken`, the resource/API app for `accessToken`. */
  app: AppRegistration;
  user: User;
  tokenType: OptionalClaimKind;
  /** Override the preview clock (seconds); defaults to the service clock. */
  now?: number;
}

/** Result of a token-claims preview. */
export interface TokenPreviewResult {
  /** The decoded claim payload that would be issued (never signed). */
  claims: Record<string, unknown>;
  /** Configured optional-claim names Entra Local does not support (preserved, not emitted). */
  unsupportedClaims: string[];
  /** Whether the group overage payload was emitted instead of a `groups` array. */
  groupOverage: boolean;
}

export interface CreateTokenServiceDeps {
  store: Store;
  signing: SigningService;
  config: Config;
  /** Injectable clock (seconds). Threaded through mint/issue/validate for deterministic tests. */
  clock?: Clock;
  /** Optional warning sink for unsupported configured optional claims (defaults to no-op). */
  warn?: (message: string) => void;
}

/** Assemble the token service over the store, signing service and config. */
export function createTokenService(deps: CreateTokenServiceDeps): TokenService {
  const { store, signing, config } = deps;
  const clock = deps.clock ?? systemClock;
  const issuer = buildIssuer(config);
  const tenantId = config.tenantId;

  const authCodes = createAuthCodeService(store, clock, config.tokenLifetimes.authCode);
  const refresh = createRefreshTokenService(store, clock, config.tokenLifetimes.refreshToken);
  const responseBuilder = createTokenResponseBuilder({
    store,
    signing,
    refresh,
    config,
    issuer,
    tenantId,
    clock,
    ...(deps.warn !== undefined ? { warn: deps.warn } : {}),
  });
  const validator = createAccessTokenValidator(signing, config, issuer, clock);

  return {
    buildTokenResponse: (params) => responseBuilder.buildTokenResponse(params),
    mintIdToken: (tid, claims) => mintIdToken(signing, tid, claims),
    mintAccessToken: (tid, claims) => mintAccessToken(signing, tid, claims),
    validateAccessToken: (bearer, opts) => validator(bearer, opts),
    issueAuthCode: (params) => authCodes.issueAuthCode(params),
    redeemAuthCode: (params) => authCodes.redeemAuthCode(params),
    issueRefreshToken: (params) => refresh.issueRefreshToken(params),
    redeemRefreshToken: (params) => refresh.redeemRefreshToken(params),
    pairwiseSub,
    previewToken: (params) => {
      const now = params.now ?? clock();
      const { app, user, tokenType } = params;
      const resolved = resolveAppTokenClaims({ app, kind: tokenType, user, store, config, now });
      const base: Record<string, unknown> =
        tokenType === 'idToken'
          ? {
              ...buildIdTokenClaims({
                user,
                app,
                tenantId,
                issuer,
                // Representative scopes so base OIDC claims (e.g. email) reflect a real sign-in.
                scopes: ['openid', 'profile', 'email'],
                now,
                lifetimeSeconds: config.tokenLifetimes.idToken,
              }),
            }
          : {
              ...buildDelegatedAccessClaims({
                user,
                app,
                tenantId,
                issuer,
                // The viewed app acts as the resource/API app (the access-token audience).
                audience: app.appIdUri ?? app.appId,
                scopes: [],
                now,
                lifetimeSeconds: config.tokenLifetimes.accessToken,
              }),
            };
      return {
        claims: { ...base, ...resolved.claims },
        unsupportedClaims: resolved.unsupportedClaims,
        groupOverage: resolved.groupOverage,
      };
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Token service (feature #5): mints/validates ID & access JWTs and issues/redeems auth codes +
     * refresh tokens. Grant endpoints (#6/#7/#8/#15) and resource APIs (#9/#10) consume it.
     */
    tokenService: TokenService;
  }
}

/**
 * Decorate `app.tokenService`. Must run after the store (`registerStore`) and signing service
 * (`registerTokens`) are live, since it closes over both. Uses wall-clock at runtime.
 */
export function registerTokenService(app: FastifyInstance): void {
  const tokenService = createTokenService({
    store: app.store,
    signing: app.signing,
    config: app.config,
    warn: (message) => app.log.warn(message),
  });
  app.decorate('tokenService', tokenService);
}
