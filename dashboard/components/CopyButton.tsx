'use client';

import { useEffect, useState } from 'react';

interface CopyButtonProps {
  value: string;
  label?: string;
  onCopied?: () => void;
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

export function CopyButton({ value, label = 'Copy', onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1100);
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
        onCopied?.();
      }}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
