import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppDetail } from './AppDetail';
import type { App } from '../api/types';
import { installFetch, TENANT_ID } from '../test/server';
import { renderWithProviders } from '../test/utils';

const APP_ID = 'cccccccc-0000-0000-0000-000000000001';

function app(over: Partial<App> = {}): App {
  return {
    id: APP_ID,
    displayName: 'Contoso SPA',
    isConfidential: false,
    appIdUri: null,
    redirectUris: [{ id: 1, uri: 'https://localhost:3000/auth/callback', type: 'spa' }],
    exposedScopes: [],
    appRoles: [],
    secrets: [],
    optionalClaims: { idToken: [], accessToken: [] },
    groupMembershipClaims: 'None',
    groupOverageLimit: null,
    createdAt: '2026-06-22T00:00:00.000Z',
    ...over,
  };
}

function renderDetail(): void {
  renderWithProviders(<AppDetail />, {
    path: 'apps/:id',
    initialEntries: [`/apps/${APP_ID}`],
  });
}

describe('AppDetail — MSAL snippet', () => {
  it('renders a snippet with authority, clientId, redirectUri, scopes, knownAuthorities + graph base', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path === `/admin/api/apps/${APP_ID}`) return { body: app() };
      return undefined;
    });
    renderDetail();

    const snippet = await screen.findByTestId('msal-snippet');
    const text = snippet.textContent ?? '';
    expect(text).toContain(`clientId: "${APP_ID}"`);
    expect(text).toContain(`authority: "https://localhost:8443/${TENANT_ID}"`);
    expect(text).toContain('knownAuthorities: ["localhost:8443"]');
    expect(text).toContain('redirectUri: "https://localhost:3000/auth/callback"');
    expect(text).toContain('"openid", "profile", "email", "offline_access", "User.Read"');
    expect(text).toContain('graphBase: "https://localhost:8443/graph"');
  });
});

describe('AppDetail — secret show-once', () => {
  it('shows the plaintext once and never re-fetches it', async () => {
    const plaintext = 'x7Q~aB3kL9pZ2mN5rT8wYf1Dc4Gh6Jv0Es';
    let created = false;
    installFetch(({ method, path }) => {
      if (method === 'GET' && path === `/admin/api/apps/${APP_ID}`) {
        return {
          body: app({
            isConfidential: true,
            secrets: created
              ? [
                  {
                    id: 's1',
                    displayName: 'CI pipeline',
                    hint: 'x7…Es',
                    expiresAt: '2026-12-31T00:00:00.000Z',
                    createdAt: '2026-06-22T00:00:00.000Z',
                  },
                ]
              : [],
          }),
        };
      }
      if (method === 'POST' && path === `/admin/api/apps/${APP_ID}/secrets`) {
        created = true;
        return {
          body: {
            id: 's1',
            displayName: 'CI pipeline',
            hint: 'x7…Es',
            expiresAt: '2026-12-31T00:00:00.000Z',
            createdAt: '2026-06-22T00:00:00.000Z',
            secretText: plaintext,
          },
        };
      }
      return undefined;
    });
    renderDetail();

    await screen.findByText('Client secrets');
    await userEvent.click(screen.getByRole('button', { name: /New secret/ }));
    await userEvent.type(screen.getByLabelText('Secret description'), 'CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: 'Create secret' }));

    // Plaintext is shown exactly once in the copy-once dialog.
    const dialog = await screen.findByRole('dialog');
    const value = within(dialog).getByTestId('secret-value') as HTMLInputElement;
    expect(value.value).toBe(plaintext);

    // Close the dialog — the plaintext is gone and is never present in the refetched list.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('secret-value')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(plaintext)).not.toBeInTheDocument();
    // The refetched secrets table shows only the masked hint, never the plaintext.
    expect(await screen.findByText('x7…Es')).toBeInTheDocument();
    expect(screen.queryByText(plaintext)).not.toBeInTheDocument();
  });
});

describe('AppDetail — token configuration', () => {
  const supported = {
    idToken: ['email', 'upn', 'given_name', 'family_name', 'groups', 'auth_time', 'ipaddr'],
    accessToken: ['email', 'upn', 'given_name', 'family_name', 'groups', 'ipaddr'],
    groupMembershipClaims: ['None', 'SecurityGroup', 'DirectoryRole', 'ApplicationGroup', 'All'],
    defaultGroupOverageLimit: 200,
  };

  it('renders configured optional claims, flags unsupported claims, and saves edits', async () => {
    let patched: Record<string, unknown> | undefined;
    installFetch(({ method, path, body }) => {
      if (method === 'GET' && path === `/admin/api/apps/${APP_ID}`) {
        return {
          body: app({
            optionalClaims: {
              idToken: [
                { name: 'email', essential: false },
                { name: 'acct', essential: false },
              ],
              accessToken: [],
            },
            groupMembershipClaims: 'SecurityGroup',
            groupOverageLimit: 3,
          }),
        };
      }
      if (method === 'GET' && path === '/admin/api/token-configuration/supported-claims') {
        return { body: supported };
      }
      if (method === 'GET' && path.startsWith('/admin/api/users')) {
        return { body: { value: [], count: 0, top: 100, skip: 0 } };
      }
      if (method === 'PATCH' && path === `/admin/api/apps/${APP_ID}`) {
        patched = body as Record<string, unknown>;
        return { body: app() };
      }
      return undefined;
    });
    renderDetail();

    await screen.findByText('Token configuration');
    // The unsupported 'acct' claim is preserved and flagged; wait for supported-claims to load.
    expect(await screen.findByText('unsupported')).toBeInTheDocument();
    expect(screen.getByText('acct')).toBeInTheDocument();
    // 'upn' should be offered as a supported claim to add once metadata loads.
    await screen.findAllByRole('option', { name: 'upn' });

    // Add a supported ID-token claim, then save.
    await userEvent.selectOptions(screen.getByLabelText('Add optional claim to idToken'), 'upn');
    const idAddRow = screen.getByLabelText('Add optional claim to idToken').closest('div')!;
    await userEvent.click(within(idAddRow).getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Token configuration');
    expect(patched).toBeDefined();
    const claims = (patched!.optionalClaims as { idToken: { name: string }[] }).idToken.map(
      (c) => c.name,
    );
    expect(claims).toContain('email');
    expect(claims).toContain('acct');
    expect(claims).toContain('upn');
    expect(patched!.groupMembershipClaims).toBe('SecurityGroup');
    expect(patched!.groupOverageLimit).toBe(3);
  });

  it('previews a decoded token for a selected user', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path === `/admin/api/apps/${APP_ID}`) return { body: app() };
      if (method === 'GET' && path === '/admin/api/token-configuration/supported-claims') {
        return { body: supported };
      }
      if (method === 'GET' && path.startsWith('/admin/api/users')) {
        return {
          body: {
            value: [
              {
                id: 'u-alice',
                userPrincipalName: 'alice@entralocal.dev',
                displayName: 'Alice Example',
                givenName: 'Alice',
                surname: 'Example',
                mail: 'alice@entralocal.dev',
                accountEnabled: true,
                hasPassword: true,
                createdAt: '2026-06-22T00:00:00.000Z',
              },
            ],
            count: 1,
            top: 100,
            skip: 0,
          },
        };
      }
      if (method === 'POST' && path === `/admin/api/apps/${APP_ID}/token-preview`) {
        return {
          body: {
            tokenType: 'idToken',
            userId: 'u-alice',
            claims: { email: 'alice@entralocal.dev', groups: ['g1', 'g2'] },
            unsupportedClaims: [],
            groupOverage: false,
          },
        };
      }
      return undefined;
    });
    renderDetail();

    await screen.findByText('Token preview');
    await screen.findByRole('option', { name: /Alice Example/ });
    await userEvent.selectOptions(screen.getByLabelText('User'), 'u-alice');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const preview = await screen.findByTestId('token-preview');
    expect(preview.textContent).toContain('alice@entralocal.dev');
    expect(preview.textContent).toContain('groups');
  });
});
