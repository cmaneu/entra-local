import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CertTrustCard } from './CertTrustCard';
import { CERTIFICATE, installFetch } from '../test/server';
import { expectNoCriticalAxe, renderWithProviders } from '../test/utils';

describe('CertTrustCard', () => {
  beforeEach(() => {
    installFetch(); // default fallback serves CERTIFICATE for /admin/api/certificate
  });

  it('shows the cert facts and a download link', async () => {
    renderWithProviders(<CertTrustCard />);

    await screen.findByText('Trust the certificate');
    expect(screen.getByText(CERTIFICATE.fingerprintSha256!)).toBeInTheDocument();

    const download = screen.getByRole('link', { name: /Download certificate/ });
    expect(download).toHaveAttribute('href', expect.stringContaining('/admin/api/certificate/pem'));
    expect(download).toHaveAttribute('download', 'entra-local-ca.crt');
  });

  it('switches the trust script per platform', async () => {
    renderWithProviders(<CertTrustCard />);
    await screen.findByText('Trust the certificate');

    await userEvent.click(screen.getByRole('tab', { name: 'Windows' }));
    expect(screen.getByTestId('cert-trust-script').textContent).toContain('Import-Certificate');

    await userEvent.click(screen.getByRole('tab', { name: 'macOS' }));
    expect(screen.getByTestId('cert-trust-script').textContent).toContain(
      'security add-trusted-cert',
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Linux' }));
    expect(screen.getByTestId('cert-trust-script').textContent).toContain('update-ca-certificates');
  });

  it('copies the active script to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithProviders(<CertTrustCard />);
    await screen.findByText('Trust the certificate');

    const codeBlock = screen.getByTestId('cert-trust-script');
    await userEvent.click(within(codeBlock).getByRole('button', { name: /Copy/ }));
    expect(writeText).toHaveBeenCalled();
  });

  it('renders nothing when TLS is disabled', async () => {
    installFetch(({ path }) =>
      path === '/admin/api/certificate' ? { body: { enabled: false } } : undefined,
    );
    renderWithProviders(<CertTrustCard />);

    await waitFor(() =>
      expect(screen.queryByText('Trust the certificate')).not.toBeInTheDocument(),
    );
  });

  it('has no critical accessibility violations', async () => {
    const { container } = renderWithProviders(<CertTrustCard />);
    await screen.findByText('Trust the certificate');
    await expectNoCriticalAxe(container);
  });
});
