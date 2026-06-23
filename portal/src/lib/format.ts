/** Small presentation + clipboard helpers shared across the portal. */

/** Initials (1–2 chars) derived from a display name, for avatars. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const AVATAR_COLORS = [
  'var(--primary-60)',
  'var(--accent-60)',
  'var(--neutral-60)',
  'var(--primary-40)',
  'var(--accent-40)',
] as const;

/** Deterministic avatar background keyed by an id. */
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Middle-ellipsis a long identifier ("8f2a1c9b…c1d9"), preserving head/tail. */
export function middleEllipsis(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Mask the host of an origin to a compact "host:port" label. */
export function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Format an ISO date as a short `YYYY-MM-DD` (or "—" when null). */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

/**
 * Copy text to the clipboard, resolving `true` on success. Falls back to a hidden textarea +
 * `execCommand` when the async Clipboard API is unavailable (insecure context / older engine).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
