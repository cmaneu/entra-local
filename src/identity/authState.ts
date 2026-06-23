import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed transient state used to carry the original authorize request across the interactive
 * sign-in POST. The validated authorize params are serialized to JSON and HMAC-SHA256 signed with a
 * per-process ephemeral key, so a tampered hidden field (e.g. a swapped `redirect_uri`) is rejected
 * before any redirect. The token is short-lived and only meaningful within one running instance —
 * the GET (render) and POST (submit) happen on the same emulator process.
 *
 * Defense-in-depth only: the POST handler ALSO re-validates `client_id`/`redirect_uri` against the
 * store, so a forged state can never produce a redirect to an unregistered URI.
 */

/** The authorize params preserved across sign-in (already validated at render time). */
export interface AuthorizeState {
  clientId: string;
  redirectUri: string;
  scope: string;
  responseMode: 'query' | 'fragment';
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource: string | null;
  scopes: string[];
}

export interface AuthStateSigner {
  sign(state: AuthorizeState): string;
  verify(token: string): AuthorizeState | undefined;
}

/** Create a state signer bound to a fresh per-process HMAC key. */
export function createAuthStateSigner(key: Buffer = randomBytes(32)): AuthStateSigner {
  const mac = (payload: string): Buffer => createHmac('sha256', key).update(payload).digest();

  return {
    sign(state) {
      const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
      const sig = mac(payload).toString('base64url');
      return `${payload}.${sig}`;
    },
    verify(token) {
      const dot = token.indexOf('.');
      if (dot <= 0) return undefined;
      const payload = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      let expected: Buffer;
      let provided: Buffer;
      try {
        expected = mac(payload);
        provided = Buffer.from(sig, 'base64url');
      } catch {
        return undefined;
      }
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return undefined;
      }
      try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthorizeState;
      } catch {
        return undefined;
      }
    },
  };
}
