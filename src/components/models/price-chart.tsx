'use client';

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { ModelSnapshot } from '@/types/models';
import { format } from 'date-fns';
import { formatPricePerMillion } from '@/lib/utils';

interface PriceChartProps {
  snapshots: ModelSnapshot[];
}

export function PriceChart({ snapshots }: PriceChartProps) {
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
        No price history recorded yet.
      </div>
    );
  }

  // Format data points for Recharts ($ / 1M tokens)
  const chartData = snapshots.map((s) => {
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

  return (
    <div className="w-full h-80 pt-4">
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
                          ${Number(entry.value).toFixed(3)} / 1M
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
