'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceDot,
} from 'recharts';
import { ModelSnapshot } from '@/types/models';
import { ModelEvent } from '@/types/events';
import { format } from 'date-fns';

interface PriceChartProps {
  snapshots: ModelSnapshot[];
  events?: ModelEvent[];
}

const ANNOTATABLE_EVENTS = ['PRICE_CHANGE', 'BECAME_FREE', 'LEFT_FREE'];

// Build a lookup of event timestamp -> nearest snapshot point index
function buildAnnotations(
  snapshotTimes: string[],
  events: ModelEvent[] | undefined
): { dataIndex: number; type: string; pct: number | null }[] {
  if (!events || events.length === 0 || snapshotTimes.length === 0) return [];

  const times = snapshotTimes.map((t) => new Date(t).getTime());

  return events
    .filter((e) => ANNOTATABLE_EVENTS.includes(e.event_type))
    .map((e) => {
      const eventTime = new Date(e.detected_at).getTime();
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < times.length; i++) {
        const dist = Math.abs(times[i] - eventTime);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return { dataIndex: bestIdx, type: e.event_type, pct: e.pct_change };
    })
    .filter((a, i, arr) => arr.findIndex((x) => x.dataIndex === a.dataIndex) === i);
}

export function PriceChart({ snapshots, events }: PriceChartProps) {
  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    return snapshots.map((s) => {
      const promptPer1M = s.price_prompt !== null ? s.price_prompt * 1_000_000 : null;
      const compPer1M = s.price_completion !== null ? s.price_completion * 1_000_000 : null;
      let label = 'Unknown';
      try {
        label = format(new Date(s.polled_at), 'MMM d, HH:mm');
      } catch {
        label = s.polled_at;
      }

      return {
        date: label,
        rawTime: s.polled_at,
        'Prompt ($/1M)': promptPer1M,
        'Completion ($/1M)': compPer1M,
        promptRaw: s.price_prompt,
        compRaw: s.price_completion,
      };
    });
  }, [snapshots]);

  const annotations = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    return buildAnnotations(
      snapshots.map((s) => s.polled_at),
      events
    );
  }, [snapshots, events]);

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
        No price history recorded yet.
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div className="h-80 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              fontSize={11}
              tickLine={false}
              dy={10}
              fontFamily="monospace"
            />
            <YAxis
              stroke="#6B7280"
              fontSize={11}
              tickLine={false}
              tickFormatter={(val) => `$${val}`}
              fontFamily="monospace"
              dx={-5}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl font-mono text-xs">
                      <p className="text-gray-400 font-semibold mb-2">{label}</p>
                      {payload.map((entry: any, index: number) => (
                        <div key={`item-${index}`} className="flex items-center justify-between gap-4 my-1">
                          <span style={{ color: entry.color }} className="font-medium">
                            {entry.name}:
                          </span>
                          <span className="text-white font-bold">
                            {typeof entry.value === 'number' && Number.isFinite(entry.value)
                              ? `$${entry.value.toFixed(3)} / 1M`
                              : 'N/A'}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: 12 }}
              formatter={(value) => <span className="text-xs font-mono text-gray-300">{value}</span>}
            />
            <Line
              type="stepAfter"
              dataKey="Prompt ($/1M)"
              stroke="#06B6D4"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#06B6D4', stroke: '#083344', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="stepAfter"
              dataKey="Completion ($/1M)"
              stroke="#10B981"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#10B981', stroke: '#064E3B', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            />
            {annotations.map((a, idx) => (
              <ReferenceDot
                key={`ann-${idx}`}
                x={chartData[a.dataIndex]?.date}
                y={chartData[a.dataIndex]?.['Prompt ($/1M)'] ?? 0}
                r={5}
                fill="#F59E0B"
                stroke="#78350F"
                strokeWidth={1.5}
                shape={() => (
                  <path
                    d="M 5 0 L 0 5 L -5 0 L 0 -5 Z"
                    fill="#F59E0B"
                    stroke="#78350F"
                    strokeWidth={1.5}
                  />
                )}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {annotations.length > 0 && (
        <p className="text-[11px] font-mono text-gray-500 flex items-center gap-1.5 pl-1">
          <span className="inline-block w-2 h-2 rotate-45 bg-amber-500 border border-amber-900"></span>
          Diamond markers indicate price-change events
        </p>
      )}
    </div>
  );
}