// Phase 5 — shared components built on the design tokens. Main screens
// use these so the same button / card / input looks the same everywhere.
import React from 'react';

export const AdCard: React.FC<{
  children: React.ReactNode;
  testid?: string;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}> = ({ children, testid, className = '', onClick, ariaLabel }) => {
  const shared = `ad-card p-4 shadow-sm ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        data-testid={testid}
        aria-label={ariaLabel}
        onClick={onClick}
        className={`${shared} w-full text-left`}
      >
        {children}
      </button>
    );
  }
  return (
    <div data-testid={testid} className={shared}>
      {children}
    </div>
  );
};

type BtnVariant = 'primary' | 'danger' | 'ghost';

export const AdButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  testid?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}> = ({ children, onClick, variant = 'primary', testid, ariaLabel, disabled, className = '', type = 'button' }) => (
  <button
    type={type}
    data-testid={testid}
    aria-label={ariaLabel}
    aria-disabled={disabled || undefined}
    disabled={disabled}
    onClick={onClick}
    className={`ad-btn ad-btn-${variant} ${className}`}
  >
    {children}
  </button>
);

export const AdInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  testid?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}> = ({ value, onChange, placeholder, ariaLabel, testid, type = 'text', inputMode }) => (
  <input
    type={type}
    inputMode={inputMode}
    data-testid={testid}
    aria-label={ariaLabel}
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="ad-input"
  />
);
