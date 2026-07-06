import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { LocalDomainsCard } from './LocalDomainsCard';
import { HEALTH, installFetch } from '../test/server';
import type { Health } from '../api/types';
import { expectNoCriticalAxe, renderWithProviders } from '../test/utils';

const SUBDOMAIN_HEALTH: Health = {
  ...HEALTH,
  origins: {
    login: 'https://login.entra.localhost:8443',
    portal: 'https://portal.entra.localhost:8443',
    graph: 'https://graph.entra.localhost:8443',
  },
};

/** Serve a health payload whose three origins are distinct subdomains (local domains active). */
function installSubdomainHealth(): void {
  installFetch(({ path }) => (path === '/health' ? { body: SUBDOMAIN_HEALTH } : undefined));
}

describe('LocalDomainsCard', () => {
  it('renders nothing when the origins collapse onto one host (compat / PUBLIC_ORIGIN)', async () => {
    installFetch(); // default HEALTH collapses every origin onto https://localhost:8443
    renderWithProviders(<LocalDomainsCard />);
    // Give the emulator context a tick to resolve, then assert the card never appears.
    await waitFor(() => expect(screen.queryByText('Local domains')).not.toBeInTheDocument());
  });

  describe('with subdomain origins', () => {
    beforeEach(() => installSubdomainHealth());

    it('lists the three advertised origins', async () => {
      renderWithProviders(<LocalDomainsCard />);
      await screen.findByText('Local domains');
      expect(screen.getByText(SUBDOMAIN_HEALTH.origins.login)).toBeInTheDocument();
      expect(screen.getByText(SUBDOMAIN_HEALTH.origins.portal)).toBeInTheDocument();
      expect(screen.getByText(SUBDOMAIN_HEALTH.origins.graph)).toBeInTheDocument();
    });

    it('warns that the compat origin needs hosts entries and shows the mapping block', async () => {
      renderWithProviders(<LocalDomainsCard />);
      await screen.findByText('Local domains');

      // jsdom serves the portal from localhost → the compatibility-origin caution is shown.
      expect(screen.getByText(/compatibility origin/i)).toBeInTheDocument();

      const hosts = screen.getByTestId('local-domains-hosts');
      expect(hosts.textContent).toContain('127.0.0.1\tlogin.entra.localhost');
      expect(hosts.textContent).toContain('127.0.0.1\tentra.localhost');

      const cli = screen.getByTestId('local-domains-cli');
      expect(cli.textContent).toContain('entra-local hosts --apply');
    });

    it('has no critical accessibility violations', async () => {
      const { container } = renderWithProviders(<LocalDomainsCard />);
      await screen.findByText('Local domains');
      await expectNoCriticalAxe(container);
    });
  });
});
