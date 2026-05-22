import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

/**
 * Scroll the focused input into view on iOS so the on-screen keyboard
 * doesn't cover it (UX audit Devices 4.3.4, 2026-05-18). iOS Safari
 * tries to do this automatically, but with the dashboard's sticky/
 * fixed shell + the scheduler's nested scroll containers it often
 * gets confused and leaves the input under the keyboard.
 *
 * Delay matches iOS's typical keyboard inflation window — firing
 * scrollIntoView too early lands on stale viewport metrics.
 * `block: 'center'` keeps the input vertically centered, leaving
 * room above and below for nearby labels/errors. The browser de-
 * dupes overlapping scroll calls, so chaining this on top of iOS's
 * own attempt is safe.
 */
function handleFocusScrollIntoView(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  // Reads can lie at focus time on iOS; defer to let the visual
  // viewport settle. 250ms covers most iOS Safari keyboard
  // animations.
  setTimeout(() => {
    // Guard: scrollIntoView is absent in jsdom (test env) and on a few
    // older browsers — calling it unconditionally throws when the deferred
    // timer fires (e.g. after a modal autofocuses an input then closes).
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, 250);
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  id: externalId,
  onFocus,
  ...props
}) => {
  const autoId = useId();
  const id = externalId || (label ? autoId : undefined);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-bold uppercase mb-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </label>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && id ? `${id}-error` : undefined}
        onFocus={(e) => {
          handleFocusScrollIntoView(e);
          onFocus?.(e);
        }}
        className={`w-full p-2.5 border rounded-lg outline-none text-sm font-bold transition focus:ring-2 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : 'focus:ring-[var(--accent-glow)] focus:border-[var(--accent)]'} ${className}`}
        style={{
          backgroundColor: 'var(--input-bg)',
          borderColor: error ? undefined : 'var(--border)',
          color: 'var(--text-primary)',
        }}
        {...props}
      />
      {error && (
        <p
          id={id ? `${id}-error` : undefined}
          role="alert"
          className="mt-1 text-xs"
          style={{ color: 'var(--danger)' }}
        >
          {error}
        </p>
      )}
    </div>
  );
};
