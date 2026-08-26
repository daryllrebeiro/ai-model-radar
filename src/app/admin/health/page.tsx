import React from 'react';
import { getLatestIngestionRuns, getMarketStats } from '@/lib/db/queries';
import { isPostgres } from '@/lib/db/client';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Lock,
  Clock,
  ShieldCheck,
  Server,
  Layers,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { secret?: string };
}

export default async function AdminHealthPage({ searchParams }: PageProps) {
  const adminSecret = process.env.ADMIN_SECRET;

  // If ADMIN_SECRET is configured, require match via query param
  if (adminSecret && searchParams.secret !== adminSecret) {
    return (
      <div className="max-w-md mx-auto my-20 p-8 rounded-2xl border border-gray-800 bg-[#111827]/90 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-950/80 border border-rose-800/80 flex items-center justify-center mx-auto text-rose-400">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight">
          Admin Authentication Required
        </h1>
        <p className="text-xs text-gray-400">
          This internal pipeline health monitor is protected by <code className="text-cyan-400">ADMIN_SECRET</code>. Please pass the secret in the URL query parameter or authenticate via bearer token.
        </p>
        <form method="GET" className="pt-2 space-y-3">
          <input
            type="password"
            name="secret"
            placeholder="Enter ADMIN_SECRET..."
            className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono"
            required
          />
          <button
            type="submit"
            className="w-full py-2 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold uppercase tracking-wider transition-colors"
          >
            Access Dashboard
          </button>
        </form>
      </div>
    );
  }

  const [runs, stats] = await Promise.all([
    getLatestIngestionRuns(25),
    getMarketStats(),
  ]);

  const recentFailures = runs.filter((r) => r.status === 'failed').length;
  const isHealthy = recentFailures === 0;

  const sources = [
    { id: 'openrouter', name: 'OpenRouter Market Feed', pollFreq: 'Every 60 min' },
    { id: 'github', name: 'GitHub Research Labs', pollFreq: 'Every 6 hours' },
    { id: 'huggingface', name: 'Hugging Face Hub', pollFreq: 'Every 12 hours' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
            <Activity className="w-3.5 h-3.5" />
            <span>INTERNAL OBSERVABILITY &amp; HEALTH</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Pipeline Health &amp; Audit Log
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-gray-400">
            Real-time ingestion pipeline diagnostics, transaction records, and database integrity monitors.
          </p>
        </div>

        {/* Global Status Pill */}
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
            isHealthy
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-400'
          }`}
        >
          {isHealthy ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
          <span className="text-xs font-mono font-bold uppercase">
            {isHealthy ? 'All Pipelines Healthy' : `${recentFailures} Recent Failures Detected`}
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* DB Engine */}
        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>Storage Engine</span>
            <Database className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-lg font-bold text-white">
            {isPostgres() ? 'PostgreSQL (Neon/RDS)' : 'Local File Storage'}
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            {isPostgres() ? 'Production connection pool active' : 'Zero-config local mode'}
          </div>
        </div>

        {/* Active Models */}
        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>Current Tracked Models</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-white">
            {stats.totalActiveModels.toLocaleString()} Models
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            Across {stats.totalProviders} AI research labs
          </div>
        </div>

        {/* Last Polled */}
        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>Last Successful Ingestion</span>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-lg font-bold text-white truncate">
            {stats.lastPolledAt ? formatRelativeTime(stats.lastPolledAt) : 'Never'}
          </div>
          <div className="text-[11px] text-gray-500 font-mono truncate">
            {stats.lastPolledAt ? new Date(stats.lastPolledAt).toLocaleTimeString() : 'N/A'}
          </div>
        </div>

        {/* Ingestion Runs Logged */}
        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>Audit History Records</span>
            <Server className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-bold text-white">
            {runs.length} Cycles Tracked
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            Logged in ingestion_runs table
          </div>
        </div>
      </div>

      {/* Sources Health Grid */}
      <div>
        <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider mb-3">
          Ingestion Pipelines by Source
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sources.map((src) => {
            const latestRun = runs.find((r) => r.source === src.id);
            const status = latestRun?.status || 'idle';
            const isOk = status === 'success';

            return (
              <div
                key={src.id}
                className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/80 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{src.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      isOk
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}
                  >
                    {status}
                  </span>
                </div>

                <div className="space-y-1 text-xs font-mono text-gray-400">
                  <div className="flex justify-between">
                    <span>Schedule:</span>
                    <span className="text-gray-200">{src.pollFreq}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Run:</span>
                    <span className="text-gray-200">
                      {latestRun?.started_at ? formatRelativeTime(latestRun.started_at) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Models Processed:</span>
                    <span className="text-cyan-400 font-semibold">{latestRun?.models_seen || 0}</span>
                  </div>
                </div>

                {latestRun?.error_detail && (
                  <div className="p-2 rounded bg-rose-950/40 border border-rose-800/40 text-[11px] font-mono text-rose-300">
                    <strong>Error: </strong>
                    {latestRun.error_detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Ingestion Runs Audit Log Table */}
      <div className="space-y-3">
        <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider">
          Recent Ingestion Runs Audit Log
        </h2>

        <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Models Seen</th>
                <th className="py-3 px-4 text-right">Events Emitted</th>
                <th className="py-3 px-4">Diagnostics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-gray-300">
              {runs.map((run, idx) => {
                const isSuccess = run.status === 'success';
                return (
                  <tr key={idx} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap text-gray-300">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-cyan-400 border border-gray-700">
                        {run.source}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          isSuccess
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950/80 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {isSuccess ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        {run.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-200">
                      {run.models_seen?.toLocaleString() || 0}
                    </td>
                    <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                      {run.events_emitted || 0}
                    </td>
                    <td className="py-3 px-4 text-gray-400 max-w-xs truncate">
                      {run.error_detail || <span className="text-gray-600">Clean execution</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
