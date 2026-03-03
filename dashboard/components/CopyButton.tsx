'use client';

import { useEffect, useState } from 'react';

interface CopyButtonProps {
  value: string;
  label?: string;
  redirectUrl?: string;
}

export function CopyButton({ value, label = 'Copy', redirectUrl }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1600);
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

        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (redirectUrl) {
            setTimeout(() => {
              window.location.assign(redirectUrl);
            }, 140);
          }
        } catch {
          setCopied(false);
        }
      }}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
