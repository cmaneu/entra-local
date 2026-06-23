import type { Config } from '../config/schema.js';
import type { Store } from '../store/store.js';
import type { AppRegistration, User } from '../store/types.js';
import {
  buildAppOnlyAccessClaims,
  buildDelegatedAccessClaims,
  buildIdTokenClaims,
  resolveAudience,
  scopeNames,
  scopeString,
} from './claims.js';
import type { SigningService } from './keys.js';
import { mintAccessToken, mintIdToken } from './mint.js';
import type { RefreshTokenService } from './refresh.js';

/**
 * The OAuth `token_endpoint` success-response builder (spec #5), reused by #6 (auth code), #7
 * (refresh), #8 (client credentials) and #15 (device code). This is the single place tokens are
 * assembled into the wire JSON; it mints the access token (always), the ID token (delegated +
 * `openid`), issues/embeds a refresh token (delegated + `offline_access`), and emits `client_info`
 * for delegated flows only.
 */

/** The grant type that produced this response (informational; shapes refresh/id-token behavior). */
export type GrantType =
  | 'authorization_code'
  | 'refresh_token'
  | 'client_credentials'
  | 'device_code';

/** The standard OAuth token-endpoint success JSON. */
export interface TokenResponse {
  token_type: 'Bearer';
  expires_in: number;
  ext_expires_in: number;
  scope: string;
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  client_info?: string;
}

export interface BuildTokenResponseParams {
  /** The client app (the `client_id`). */
  app: AppRegistration;
  /** Present for delegated (user) flows; omit/null for app-only client credentials. */
  user?: User | null;
  /** Granted scope identifiers (may carry resource prefixes). */
  scopes: readonly string[];
  /** Resource identifier driving the audience rule (app-id-uri, appId, or Graph resource id). */
  resource?: string | null;
  /**
   * Explicit access-token `aud`, used verbatim when present (bypasses the `resource`→audience
   * rule). The client-credentials grant (#8) passes its `.default`-resolved `aud` here so the
   * minted token targets the exact resource identifier it resolved (e.g. an `api://` URI string,
   * not the resolved GUID).
   */
  audience?: string;
  /** Echoed into the ID token when present. */
  nonce?: string | null;
  grant: GrantType;
  /** App-only granted app roles (client credentials). */
  roles?: readonly string[];
  /** Pre-issued refresh token to embed verbatim (e.g. the rotated token from #7). */
  refreshToken?: string | null;
  /** Override the build clock (seconds) for deterministic responses; defaults to the service clock. */
  now?: number;
}

/** MSAL account-identity blob: `base64url(JSON.stringify({ uid:<oid>, utid:<tenantId> }))`. */
export function buildClientInfo(uid: string, utid: string): string {
  return Buffer.from(JSON.stringify({ uid, utid }), 'utf8').toString('base64url');
}

export interface TokenResponseBuilderDeps {
  store: Store;
  signing: SigningService;
  refresh: RefreshTokenService;
  config: Config;
  issuer: string;
  tenantId: string;
  clock: () => number;
}

export interface TokenResponseBuilder {
  buildTokenResponse(params: BuildTokenResponseParams): Promise<TokenResponse>;
}

/** Build the token-response builder bound to the signing/store/refresh services and config. */
export function createTokenResponseBuilder(deps: TokenResponseBuilderDeps): TokenResponseBuilder {
  const { store, signing, refresh, config, issuer, tenantId, clock } = deps;
  const accessLifetime = config.tokenLifetimes.accessToken;
  const idLifetime = config.tokenLifetimes.idToken;

  return {
    async buildTokenResponse(params) {
      const now = params.now ?? clock();
      const user = params.user ?? null;
      const delegated = user !== null;
      const audience = params.audience ?? resolveAudience(params.resource, config, store);
      const names = scopeNames(params.scopes);

      const accessToken = await mintAccessToken(
        signing,
        tenantId,
        delegated
          ? buildDelegatedAccessClaims({
              user,
              app: params.app,
              tenantId,
              issuer,
              audience,
              scopes: params.scopes,
              now,
              lifetimeSeconds: accessLifetime,
            })
          : buildAppOnlyAccessClaims({
              app: params.app,
              tenantId,
              issuer,
              audience,
              roles: params.roles ?? [],
              now,
              lifetimeSeconds: accessLifetime,
            }),
      );

      const response: TokenResponse = {
        token_type: 'Bearer',
        expires_in: accessLifetime,
        ext_expires_in: accessLifetime,
        scope: scopeString(params.scopes),
        access_token: accessToken,
      };

      if (delegated && names.includes('openid')) {
        response.id_token = await mintIdToken(
          signing,
          tenantId,
          buildIdTokenClaims({
            user,
            app: params.app,
            tenantId,
            issuer,
            scopes: params.scopes,
            nonce: params.nonce,
            now,
            lifetimeSeconds: idLifetime,
          }),
        );
      }

      if (params.refreshToken) {
        response.refresh_token = params.refreshToken;
      } else if (delegated && names.includes('offline_access')) {
        response.refresh_token = refresh.issueRefreshToken({
          appId: params.app.appId,
          userId: user.id,
          scopes: params.scopes,
          resource: params.resource ?? null,
        });
      }

      if (delegated) {
        response.client_info = buildClientInfo(user.id, tenantId);
      }

      return response;
    },
  };
}
