import type { KeyboardEvent } from 'react';

interface TabsProps<T extends string> {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** `horizontal` (default) renders an underline strip; `vertical` renders a left rail. */
  orientation?: 'horizontal' | 'vertical';
}

/**
 * Tab strip. Horizontal tabs carry the 2px primary underline + primary-30 text;
 * vertical tabs render as a left rail (Entra-portal style) with a primary left border.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
  orientation = 'horizontal',
}: TabsProps<T>): JSX.Element {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    if (e.key !== nextKey && e.key !== prevKey) return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.id === active);
    if (index === -1) return;
    const delta = e.key === nextKey ? 1 : -1;
    const nextIndex = (index + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.id);
    // Move focus to the newly selected tab so the roving tabindex stays on the active tab.
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[nextIndex]?.focus();
  }

  return (
    <div
      className={`tabs${orientation === 'vertical' ? ' vertical' : ''}`}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          tabIndex={t.id === active ? 0 : -1}
          className={`tab${t.id === active ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
