import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  error?: string | undefined;
  help?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}

/** A labelled form field with an optional help line and an inline error slot. */
export function Field({
  label,
  htmlFor,
  error,
  help,
  optional,
  children,
}: FieldProps): JSX.Element {
  const errorId = `${htmlFor}-error`;
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {optional && (
          <span className="muted" style={{ fontWeight: 400 }}>
            {' '}
            (optional)
          </span>
        )}
      </label>
      {children}
      {help && !error && <div className="help">{help}</div>}
      {error && (
        <div className="field-error" id={errorId}>
          {error}
        </div>
      )}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

/** Text input bound to a {@link Field}; flips to the error style + aria when `invalid`. */
export function TextInput({ invalid, mono, className, id, ...rest }: TextInputProps): JSX.Element {
  const classes = ['input'];
  if (mono) classes.push('mono');
  if (invalid) classes.push('error');
  if (className) classes.push(className);
  return (
    <input
      id={id}
      className={classes.join(' ')}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

/** Styled select. */
export function Select({ className, children, ...rest }: SelectProps): JSX.Element {
  return (
    <select className={`input${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </select>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

/** Accessible toggle switch (`role="switch"` + `aria-checked`), always paired with a text label. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps): JSX.Element {
  const labelId = useId();
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      <span id={labelId}>{label}</span>
    </button>
  );
}
