'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Phase = 'guide' | 'closing' | 'done';

interface SetupGuideTransitionProps {
  showGuide: boolean;
  animateOut: boolean;
  guide: ReactNode;
  done: ReactNode;
}

export function SetupGuideTransition({ showGuide, animateOut, guide, done }: SetupGuideTransitionProps) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (showGuide) {
      return 'guide';
    }
    if (animateOut) {
      return 'closing';
    }
    return 'done';
  });

  useEffect(() => {
    if (showGuide) {
      setPhase('guide');
      return;
    }

    if (animateOut) {
      setPhase('closing');
      const timer = setTimeout(() => setPhase('done'), 520);
      return () => clearTimeout(timer);
    }

    setPhase('done');
  }, [showGuide, animateOut]);

  if (phase === 'guide') {
    return <>{guide}</>;
  }

  if (phase === 'closing') {
    return <div className="setup-guide-genie">{guide}</div>;
  }

  return <>{done}</>;
}
