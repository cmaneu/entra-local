import { describe, expect, it } from 'vitest';
import { buildOAuthError, type OAuthErrorCode } from '../../src/identity/oauthErrors.js';
import { createAuthStateSigner, type AuthorizeState } from '../../src/identity/authState.js';

/**
 * Unit tests for the canonical OAuth error helper (#6, reused by #7/#8/#15) and the signed
 * transient-state used to carry the authorize request across the interactive sign-in POST.
 */

describe('buildOAuthError (canonical AADSTS-style shape)', () => {
  it('emits error/error_description/error_codes/timestamp/trace_id/correlation_id', () => {
    const body = buildOAuthError({ error: 'invalid_grant', description: 'Code expired.' });
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toBe('Code expired.');
    expect(Array.isArray(body.error_codes)).toBe(true);
    expect(body.error_codes.length).toBeGreaterThan(0);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.trace_id).toMatch(/[0-9a-f-]{36}/);
    expect(body.correlation_id).toMatch(/[0-9a-f-]{36}/);
  });

  it('maps each error code to a default AADSTS numeric code', () => {
    const codes: OAuthErrorCode[] = [
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'unsupported_grant_type',
      'invalid_scope',
    ];
    for (const error of codes) {
      const body = buildOAuthError({ error, description: 'x' });
      expect(body.error).toBe(error);
      expect(typeof body.error_codes[0]).toBe('number');
    }
  });

  it('echoes a provided correlation id and allows overriding error_codes', () => {
    const body = buildOAuthError({
      error: 'invalid_client',
      description: 'x',
      correlationId: 'corr-123',
      errorCodes: [7000215, 7000222],
    });
    expect(body.correlation_id).toBe('corr-123');
    expect(body.error_codes).toEqual([7000215, 7000222]);
  });
});

describe('createAuthStateSigner', () => {
  const sample: AuthorizeState = {
    clientId: 'cccccccc-0000-0000-0000-000000000001',
    redirectUri: 'https://localhost:3000',
    scope: 'openid profile',
    responseMode: 'query',
    resource: null,
    scopes: ['openid', 'profile'],
    state: 'abc',
    nonce: 'n1',
  };

  it('round-trips a signed state', () => {
    const signer = createAuthStateSigner();
    const token = signer.sign(sample);
    expect(signer.verify(token)).toEqual(sample);
  });

  it('rejects a tampered payload', () => {
    const signer = createAuthStateSigner();
    const token = signer.sign(sample);
    const [payload, sig] = token.split('.');
    const forged = `${payload}x.${sig}`;
    expect(signer.verify(forged)).toBeUndefined();
  });

  it('rejects a state signed with a different key', () => {
    const a = createAuthStateSigner();
    const b = createAuthStateSigner();
    expect(b.verify(a.sign(sample))).toBeUndefined();
  });

  it('rejects malformed tokens', () => {
    const signer = createAuthStateSigner();
    expect(signer.verify('no-dot')).toBeUndefined();
    expect(signer.verify('.justdot')).toBeUndefined();
    expect(signer.verify('')).toBeUndefined();
  });
});
