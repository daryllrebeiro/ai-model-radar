import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UsageDetailClient } from '@/components/usage/usage-detail-client';

export const dynamic = 'force-dynamic';

export default function UsageDetailPage({ params }: { params: { id: string } }) {
  if (!params.id) notFound();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href="/usage" className="text-xs font-mono text-gray-400 hover:text-cyan-400">
        ← Back to Usage Imports
      </Link>
      <UsageDetailClient id={params.id} />
    </div>
  );
}
