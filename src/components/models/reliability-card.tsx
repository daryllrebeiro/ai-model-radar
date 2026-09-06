import { ShieldCheck, ShieldAlert, ShieldX, Activity, Gauge, Zap, Ban } from 'lucide-react';
import { EndpointTelemetry } from '@/types/telemetry';

interface ReliabilityCardProps {
  telemetry: EndpointTelemetry[];
  modelName: string;
}

/**
 * Live endpoint intelligence card (Pro, APT_PROBE): summarizes the most recent
 * probe results for a single model — health badge, P95 latency, throughput,
 * and rate-limiting evidence.
 */
export function ReliabilityCard({ telemetry, modelName }: ReliabilityCardProps) {
  if (telemetry.length === 0) return null;

  const latest = telemetry[0];
  const onlineSamples = telemetry.filter((t) => t.online).length;
  const rateLimited = telemetry.filter((t) => t.rate_limited).length;
  const uptime = Math.round((onlineSamples / telemetry.length) * 100);

  let status: 'healthy' | 'degraded' | 'down' = 'healthy';
  if (!latest.online) status = 'down';
  else if (latest.p95_latency_ms !== null && latest.p95_latency_ms > 8000) status = 'degraded';
  else if (latest.rate_limited_count / Math.max(1, latest.sample_count) >= 0.5) status = 'degraded';
  else if (latest.is_free && latest.free_tier_active === false) status = 'down';

  const statusCfg = {
    healthy: {
      label: 'Healthy',
      cls: 'text-emerald-300 border-emerald-600/60 bg-emerald-950/60',
      Icon: ShieldCheck,
    },
    degraded: {
      label: 'Degraded',
      cls: 'text-amber-300 border-amber-600/60 bg-amber-950/60',
      Icon: ShieldAlert,
    },
    down: {
      label: 'Down',
      cls: 'text-red-300 border-red-600/60 bg-red-950/60',
      Icon: ShieldX,
    },
  }[status];

  return (
    <section className="p-5 sm:p-6 rounded-2xl border border-gray-800 bg-[#111827]/70 backdrop-blur-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Endpoint Reliability
        </h2>
        <span className={`text-xs font-mono px-2 py-1 rounded-full border ${statusCfg.cls} inline-flex items-center gap-1`}>
          <statusCfg.Icon className="w-3.5 h-3.5" />
          {statusCfg.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono text-gray-400">
        <div className="p-3 rounded-lg bg-[#0d1424]/80 border border-gray-800">
          <div className="text-gray-500 uppercase flex items-center gap-1">
            <Gauge className="w-3 h-3" /> P95 Latency
          </div>
          <div className="text-white mt-1">
            {latest.p95_latency_ms !== null ? `${Math.round(latest.p95_latency_ms)}ms` : 'n/a'}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[#0d1424]/80 border border-gray-800">
          <div className="text-gray-500 uppercase flex items-center gap-1">
            <Zap className="w-3 h-3" /> Throughput
          </div>
          <div className="text-white mt-1">
            {latest.tokens_per_sec !== null ? `${Math.round(latest.tokens_per_sec)} tok/s` : 'n/a'}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[#0d1424]/80 border border-gray-800">
          <div className="text-gray-500 uppercase flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Uptime (24h)
          </div>
          <div className="text-white mt-1">{uptime}%</div>
        </div>
        <div className="p-3 rounded-lg bg-[#0d1424]/80 border border-gray-800">
          <div className="text-gray-500 uppercase flex items-center gap-1">
            <Ban className="w-3 h-3" /> Rate-limited
          </div>
          <div className="text-white mt-1">
            {rateLimited} / {telemetry.length} probes
          </div>
        </div>
      </div>

      {latest.endpoint_url && (
        <p className="text-[11px] font-mono text-gray-600 truncate">
          probed: {latest.endpoint_url}
        </p>
      )}
      {statusCfg.label !== 'Healthy' && (
        <p className="text-xs font-mono text-amber-200/70">
          {modelName}&apos;s endpoint is currently {statusCfg.label.toLowerCase()}; check the live feed for related pricing events.
        </p>
      )}
    </section>
  );
}