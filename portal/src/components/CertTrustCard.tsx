import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { useEmulator } from './EmulatorContext';
import { Banner } from './Banner';
import { CodeBlock } from './CodeBlock';
import { IdChip } from './IdChip';
import { Tabs } from './Tabs';
import {
  detectPlatform,
  nodeCaHint,
  trustScript,
  TRUST_PLATFORMS,
  type TrustPlatform,
} from '../lib/certTrust';

/**
 * "Trust the certificate" section: explains why the browser warned, offers a one-click download of
 * the self-signed dev cert, and shows a copy-paste trust script per OS (Windows / macOS / Linux).
 *
 * This is the Docker-friendly counterpart to the `entra-local trust` CLI command: container users
 * have no host CLI, so the portal hands them the exact script to run on their machine instead.
 */
export function CertTrustCard(): JSX.Element | null {
  const { discovery } = useEmulator();
  const [platform, setPlatform] = useState<TrustPlatform>(detectPlatform);
  const cert = useAsync(
    useCallback(() => api.certificate(), []),
    [],
  );

  // TLS disabled → nothing to trust; hide the section entirely.
  if (cert.data && cert.data.enabled === false) {
    return null;
  }

  const origin = discovery ? new URL(discovery.issuer).origin : window.location.origin;
  const info = cert.data?.enabled ? cert.data : undefined;

  return (
    <section className="card" aria-labelledby="cert-trust-title">
      <div className="msal-head">
        <div>
          <h2 className="h-md" id="cert-trust-title">
            Trust the certificate
          </h2>
          <p className="muted b-sm" style={{ marginTop: 4 }}>
            The emulator serves HTTPS with a self-signed certificate, so browsers and MSAL show a
            security warning until you trust it. Download it and run the script for your OS.
          </p>
        </div>
        {info?.downloadPath && (
          <a
            className="btn btn-primary"
            href={`${origin}${info.downloadPath}`}
            download={info.fileName ?? 'entra-local-ca.crt'}
          >
            ⭳ Download certificate
          </a>
        )}
      </div>

      {cert.error ? (
        <Banner tone="error" role="alert" className="mb16">
          <strong>Couldn't load the certificate.</strong> {cert.error.message}
        </Banner>
      ) : (
        <>
          {info && (
            <div className="kv mb16">
              <div className="k">Subject</div>
              <div className="mono b-sm">Entra Local emulator (CN=localhost)</div>
              <div className="k">SHA-256</div>
              <div>
                <IdChip value={info.fingerprintSha256 ?? ''} full title="SHA-256 fingerprint" />
              </div>
              <div className="k">Valid until</div>
              <div className="b-sm">{info.validTo ?? '—'}</div>
            </div>
          )}

          <Tabs
            ariaLabel="Operating system"
            active={platform}
            onChange={setPlatform}
            tabs={TRUST_PLATFORMS}
          />
          <CodeBlock
            lines={trustScript(platform, origin)}
            ariaLabel={`Trust script for ${platform}`}
            data-testid="cert-trust-script"
          />

          <p className="b-sm muted" style={{ marginTop: 8 }}>
            Node-based clients ignore the OS trust store — point them at the downloaded cert
            instead:
            <br />
            <span className="mono">{nodeCaHint(platform)}</span>
          </p>

          <Banner tone="caution" className="mt12">
            Verify the SHA-256 fingerprint above matches your emulator before trusting. Inside
            Docker the container's trust store isn't your host's — run the script on the host
            machine.
          </Banner>
        </>
      )}
    </section>
  );
}
