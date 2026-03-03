'use client';

import { useEffect, useState } from 'react';

interface CopyButtonProps {
  value: string;
  label?: string;
  redirectUrl?: string;
}

function fallbackCopy(value: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(input);
  return ok;
}

export function CopyButton({ value, label = 'Copy', redirectUrl }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="button-secondary"
      onClick={async () => {
        if (!value) {
          return;
        }

        let success = false;
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            success = true;
          }
        } catch {
          success = false;
        }

        if (!success) {
          success = fallbackCopy(value);
        }

        if (!success) {
          setCopied(false);
          return;
        }

        setCopied(true);

        if (redirectUrl) {
          requestAnimationFrame(() => {
            window.location.assign(redirectUrl);
          });
        }
      }}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
