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
import { pairwiseSub } from './claims.js';
import type { SigningService } from './keys.js';
import { mintAccessToken, mintIdToken } from './mint.js';
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
}

export interface CreateTokenServiceDeps {
  store: Store;
  signing: SigningService;
  config: Config;
  /** Injectable clock (seconds). Threaded through mint/issue/validate for deterministic tests. */
  clock?: Clock;
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
  });
  app.decorate('tokenService', tokenService);
}
