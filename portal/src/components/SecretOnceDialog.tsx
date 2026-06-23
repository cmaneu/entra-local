import { useEffect, useState } from 'react';
import type { CreatedSecret } from '../api/types';
import { copyText, shortDate } from '../lib/format';
import { useShell } from '../hooks/useToast';
import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface SecretOnceDialogProps {
  secret: CreatedSecret;
  onClose: () => void;
}

/**
 * Copy-once secret dialog: shows the one-time `secretText`, warns it cannot be retrieved again, and
 * never auto-dismisses. The plaintext lives only in this component's props/state — it is never
 * persisted or re-fetchable.
 */
export function SecretOnceDialog({ secret, onClose }: SecretOnceDialogProps): JSX.Element {
  const { toast, announce } = useShell();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    announce('Secret created. Copy it now; it will not be shown again.');
  }, [announce]);

  async function onCopy(): Promise<void> {
    const ok = await copyText(secret.secretText);
    if (!ok) return;
    setCopied(true);
    toast("Client secret copied — you won't see it again.");
  }

  return (
    <Dialog
      title="Client secret created"
      onClose={onClose}
      describedById="sec-d"
      wide
      actions={
        <Button autoFocus onClick={onClose}>
          Close
        </Button>
      }
    >
      <Banner tone="caution" id="sec-d" className="mb16">
        <strong>Copy this secret now.</strong> For security it is shown only once and cannot be
        retrieved again. If you lose it, delete this secret and create a new one.
      </Banner>
      <label htmlFor="sec-v">Secret value</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          id="sec-v"
          className="input mono"
          readOnly
          value={secret.secretText}
          data-testid="secret-value"
          style={{ background: 'var(--neutral-95)' }}
        />
        <Button variant="primary" onClick={() => void onCopy()}>
          {copied ? '✓ Copied' : '⧉ Copy'}
        </Button>
      </div>
      <div className="kv" style={{ gridTemplateColumns: '120px 1fr', marginBottom: 8 }}>
        <div className="k">Description</div>
        <div>{secret.displayName ?? '—'}</div>
        <div className="k">Hint</div>
        <div>
          <span className="chip">{secret.hint ?? '—'}</span>
        </div>
        <div className="k">Expires</div>
        <div>{shortDate(secret.expiresAt)}</div>
      </div>
    </Dialog>
  );
}
