import { describe, expect, it, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from './Dashboard';
import { DISCOVERY, HEALTH, installFetch, paged, TENANT_ID } from '../test/server';
import { expectNoCriticalAxe, renderWithProviders } from '../test/utils';

describe('Dashboard', () => {
  beforeEach(() => {
    installFetch(({ method, path }) => {
      if (method === 'GET' && path.startsWith('/admin/api/users'))
        return paged(new Array(3).fill(0));
      if (method === 'GET' && path.startsWith('/admin/api/groups'))
        return paged(new Array(2).fill(0));
      if (method === 'GET' && path.startsWith('/admin/api/apps'))
        return paged(new Array(5).fill(0));
      return undefined;
    });
  });

  it('renders /health + discovery values and directory counts', async () => {
    renderWithProviders(<Dashboard />);

    // Discovery-derived endpoints.
    await screen.findByText(DISCOVERY.issuer);
    expect(screen.getByText(DISCOVERY.jwks_uri)).toBeInTheDocument();
    expect(screen.getByText(DISCOVERY.token_endpoint)).toBeInTheDocument();

    // Health version + tenant.
    expect(screen.getAllByText(HEALTH.version).length).toBeGreaterThan(0);
    expect(screen.getAllByText((t) => t.includes(TENANT_ID)).length).toBeGreaterThan(0);

    // Counts from the three list calls.
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('copies an endpoint URL via the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithProviders(<Dashboard />);
    await screen.findByText(DISCOVERY.issuer);

    const copyButtons = screen.getAllByRole('button', { name: /Copy .* URL/ });
    await userEvent.click(copyButtons[0]!);
    expect(writeText).toHaveBeenCalled();
  });

  it('has no critical accessibility violations', async () => {
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText(DISCOVERY.issuer);
    await expectNoCriticalAxe(container);
  });
});
