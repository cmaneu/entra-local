import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Users } from './Users';
import type { User } from '../api/types';
import { installFetch, paged } from '../test/server';
import { expectNoCriticalAxe, renderWithProviders } from '../test/utils';

function user(over: Partial<User> = {}): User {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    userPrincipalName: 'alice@entralocal.dev',
    displayName: 'Alice Adams',
    givenName: 'Alice',
    surname: 'Adams',
    mail: 'alice.adams@contoso.example',
    accountEnabled: true,
    hasPassword: true,
    createdAt: '2026-06-22T00:00:00.000Z',
    ...over,
  };
}

describe('Users', () => {
  it('renders a loaded user list', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) return paged([user()]);
      return undefined;
    });
    renderWithProviders(<Users />);
    expect(await screen.findByText('alice@entralocal.dev')).toBeInTheDocument();
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
  });

  it('shows the empty state when there are no users', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) return paged([]);
      return undefined;
    });
    renderWithProviders(<Users />);
    expect(await screen.findByText('No users yet')).toBeInTheDocument();
  });

  it('shows an assertive error banner when the list fails to load', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) {
        return { status: 500, body: { error: { code: 'internal_error', message: 'Boom.' } } };
      }
      return undefined;
    });
    renderWithProviders(<Users />);
    const banner = (await screen.findByText("Couldn't load users.")).closest('.banner');
    expect(banner).not.toBeNull();
    expect(banner).toHaveTextContent("Couldn't load users.");
    expect(banner).toHaveTextContent('Boom.');
  });

  it('maps a 409 conflict to an inline UPN error', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) return paged([]);
      if (method === 'POST' && path === '/admin/api/users') {
        return {
          status: 409,
          body: {
            error: { code: 'conflict', message: 'A user with this UPN already exists.' },
          },
        };
      }
      return undefined;
    });
    renderWithProviders(<Users />);
    await screen.findByText('No users yet');

    await userEvent.click(screen.getAllByRole('button', { name: /New user/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('User principal name'),
      'dup@entralocal.dev',
    );
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Dup');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(
      await within(dialog).findByText('A user with this UPN already exists.'),
    ).toBeInTheDocument();
  });

  it('maps a 400 validation_error detail to the matching field', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) return paged([]);
      if (method === 'POST' && path === '/admin/api/users') {
        return {
          status: 400,
          body: {
            error: {
              code: 'validation_error',
              message: 'Validation failed.',
              details: [{ field: 'mail', message: 'mail must be a valid email.' }],
            },
          },
        };
      }
      return undefined;
    });
    renderWithProviders(<Users />);
    await screen.findByText('No users yet');

    await userEvent.click(screen.getAllByRole('button', { name: /New user/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('User principal name'), 'x@y.dev');
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('mail must be a valid email.')).toBeInTheDocument();
  });

  it('has no critical accessibility violations (list + drawer)', async () => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users')) return paged([user()]);
      return undefined;
    });
    const { container } = renderWithProviders(<Users />);
    await screen.findByText('alice@entralocal.dev');
    await userEvent.click(screen.getAllByRole('button', { name: /New user/ })[0]!);
    await screen.findByRole('dialog');
    await waitFor(() => expectNoCriticalAxe(container));
  });
});
