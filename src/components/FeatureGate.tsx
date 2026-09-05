'use client';

import React from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { FEATURES, hasAccess, AccessTier, FeatureKey } from '@/lib/feature-flags';

interface FeatureGateProps {
  feature: FeatureKey;
  userTier?: AccessTier | string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

function DefaultUpgradePrompt({ feature }: { feature: FeatureKey }) {
  const flag = FEATURES[feature];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-[#111827]/80 p-8 text-center space-y-4">
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-950/10 to-transparent pointer-events-none" />
      <div className="relative w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center mx-auto text-cyan-400">
        <Lock className="w-6 h-6" />
      </div>
      <div className="relative">
        <h3 className="text-lg font-bold text-white">{flag.label}</h3>
        <p className="text-sm text-gray-400 mt-1">
          Upgrade to <span className="text-cyan-400 font-semibold capitalize">{flag.minTier}</span> to access {flag.label.toLowerCase()}.
        </p>
      </div>
      <Link
        href="/pricing"
        className="relative inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors"
      >
        View Plans
      </Link>
    </div>
  );
}

/**
 * Client-side feature gate.
 * Wraps content that requires a specific tier. Shows upgrade prompt when locked.
 */
export function FeatureGate({
  feature,
  userTier = 'free',
  children,
  fallback,
}: FeatureGateProps) {
  const allowed = hasAccess(userTier, feature);
  if (allowed) return <>{children}</>;
  return <>{fallback || <DefaultUpgradePrompt feature={feature} />}</>;
}
