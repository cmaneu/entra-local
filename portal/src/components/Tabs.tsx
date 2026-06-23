interface TabsProps<T extends string> {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

/** Tab strip; the active tab carries the 2px primary underline + primary-30 text. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
}: TabsProps<T>): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`tab${t.id === active ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
