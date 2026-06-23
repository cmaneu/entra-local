interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  width?: number;
}

/** Search box with a leading magnifier; maps to the Admin API `?search=` query. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
  width = 220,
}: SearchBoxProps): JSX.Element {
  return (
    <div className="search">
      <span className="ic" aria-hidden="true">
        ⌕
      </span>
      <input
        className="input"
        style={{ width }}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
