'use client';

import React, { useState, useEffect } from 'react';
import { AlertRuleConfig, GeneratedDigest } from '@/types/alerts';
import { DEFAULT_ALERT_CONFIG, evaluateAlertRules, evaluateAdvancedAlertRules } from '@/lib/alerts';
import { ModelEvent } from '@/types/events';
import { EventCard } from '@/components/feed/event-card';
import { FeatureGate } from '@/components/FeatureGate';
import {
  Bell,
  Sliders,
  Sparkles,
  Gift,
  Mail,
  Webhook,
  CheckCircle,
  Clock,
  Shield,
  Zap,
} from 'lucide-react';
import { useWatchlist } from '@/components/watchlist/watchlist-context';

export default function AlertsPage() {
  const { watchedIds } = useWatchlist();
  const [config, setConfig] = useState<AlertRuleConfig>(DEFAULT_ALERT_CONFIG);
  const [events, setEvents] = useState<ModelEvent[]>([]);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [webhookSent, setWebhookSent] = useState<boolean>(false);

  useEffect(() => {
    // Load config from localStorage if available
    try {
      const saved = localStorage.getItem('ai_radar_alert_rules');
      if (saved) {
        setConfig(JSON.parse(saved));
      }
    } catch {}

    // Fetch events to compute live digest preview
    fetch('/api/events?limit=100')
      .then((res) => res.json())
      .then((data) => {
        if (data.events) setEvents(data.events);
      })
      .catch((err) => console.error(err));
  }, []);

  const handleSaveConfig = () => {
    try {
      localStorage.setItem('ai_radar_alert_rules', JSON.stringify(config));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch {}
  };

  const digest: GeneratedDigest = evaluateAlertRules(events, config);
  const advancedDigest =
    config.mode === 'advanced' ? evaluateAdvancedAlertRules(events, config, watchedIds) : null;

  const availableProviders = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Meta', 'Mistral', 'Qwen / Alibaba', 'xAI'];

  const toggleProvider = (prov: string) => {
    const list = [...config.selectedProviders];
    const idx = list.indexOf(prov);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(prov);
    setConfig({ ...config, selectedProviders: list });
  };

  const handleTestWebhook = () => {
    setWebhookSent(true);
    setTimeout(() => setWebhookSent(false), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 text-xs font-mono mb-2">
          <Bell className="w-3.5 h-3.5" />
          <span>PERSONALIZED DIGEST &amp; ALERTS</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Alert Rules &amp; Digest Center
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Set custom significance thresholds to filter out noise. Receive periodic digest summaries only when major price drops or free tiers occur.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Rule Configurator */}
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827]/80 backdrop-blur-sm space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                Alert Threshold Rules
              </h2>
              {savedSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
            </div>

            {/* Basic / Advanced Mode */}
            <FeatureGate feature="ADVANCED_ALERT_RULES">
              <div className="flex rounded-xl border border-gray-700 overflow-hidden p-0.5 bg-gray-900">
                <button
                  onClick={() => setConfig({ ...config, mode: 'basic' })}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
                    config.mode !== 'advanced'
                      ? 'bg-cyan-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Basic
                </button>
                <button
                  onClick={() => setConfig({ ...config, mode: 'advanced' })}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                    config.mode === 'advanced'
                      ? 'bg-cyan-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Advanced
                </button>
              </div>
            </FeatureGate>

            {/* Price Drop Threshold Slider */}
            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>Minimum Price Drop Cut</span>
                <span className="font-bold text-emerald-400">{config.minPriceDropPct}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="80"
                step="5"
                value={config.minPriceDropPct}
                onChange={(e) => setConfig({ ...config, minPriceDropPct: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Only notify if prompt or completion drops by at least {config.minPriceDropPct}%.
              </p>
            </div>

            {/* Event Type Toggles */}
            <div className="space-y-3 pt-2 border-t border-gray-800">
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Gift className="w-3.5 h-3.5 text-purple-400" />
                  Alert when models become 100% Free
                </span>
                <input
                  type="checkbox"
                  checked={config.alertOnFreeTier}
                  onChange={(e) => setConfig({ ...config, alertOnFreeTier: e.target.checked })}
                  className="rounded accent-cyan-500 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Alert on Brand New Model Releases
                </span>
                <input
                  type="checkbox"
                  checked={config.alertOnNewModels}
                  onChange={(e) => setConfig({ ...config, alertOnNewModels: e.target.checked })}
                  className="rounded accent-cyan-500 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Alert on Context Length Increases
                </span>
                <input
                  type="checkbox"
                  checked={config.alertOnContextExpansion}
                  onChange={(e) => setConfig({ ...config, alertOnContextExpansion: e.target.checked })}
                  className="rounded accent-cyan-500 w-4 h-4"
                />
              </label>
            </div>

            {/* Watched Providers */}
            <div className="pt-2 border-t border-gray-800 space-y-2">
              <span className="text-xs font-semibold text-gray-300 block">
                Target Lab Providers
              </span>
              <div className="flex flex-wrap gap-1.5">
                {availableProviders.map((p) => {
                  const active = config.selectedProviders.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleProvider(p)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition-all ${
                        active
                          ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                          : 'bg-gray-900 border-gray-800 text-gray-400'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Webhook Endpoint */}
            <div className="pt-2 border-t border-gray-800 space-y-2">
              <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <Webhook className="w-3.5 h-3.5 text-cyan-400" />
                Slack / Discord Webhook URL
              </span>
              <input
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={config.webhookUrl}
                onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                className="w-full bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg p-2 focus:outline-none focus:border-cyan-500"
              />
              {config.webhookUrl && (
                <button
                  onClick={handleTestWebhook}
                  className="w-full text-xs font-semibold py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-cyan-300 transition-colors"
                >
                  {webhookSent ? '✅ Test Payload Dispatched!' : 'Send Test Webhook'}
                </button>
              )}
            </div>

            {/* Advanced Controls (Pro) */}
            <FeatureGate feature="ADVANCED_ALERT_RULES">
              {config.mode === 'advanced' && (
                <div className="pt-2 border-t border-gray-800 space-y-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                    <Zap className="w-3.5 h-3.5" /> Advanced Compound Filters
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Min absolute $ drop /1M</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={config.minAbsoluteDropUsd ?? ''}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            minAbsoluteDropUsd: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="0.50"
                        className="w-full bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg p-2 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Min context (tokens)</label>
                      <input
                        type="number"
                        min="0"
                        value={config.minContextWindowTokens ?? ''}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            minContextWindowTokens:
                              e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="32000"
                        className="w-full bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg p-2 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Model ID contains</label>
                    <input
                      type="text"
                      value={config.matchModelId ?? ''}
                      onChange={(e) =>
                        setConfig({ ...config, matchModelId: e.target.value || undefined })
                      }
                      placeholder="claude, gpt, deepseek…"
                      className="w-full bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg p-2 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer">
                    <span className="flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5 text-cyan-400" />
                      Only recognize model families
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(config.requireFamousFamilies)}
                      onChange={(e) =>
                        setConfig({ ...config, requireFamousFamilies: e.target.checked })
                      }
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              )}
            </FeatureGate>

            <button
              onClick={handleSaveConfig}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors shadow-sm"
            >
              Save Alert Preferences
            </button>
          </div>
        </div>

        {/* Right 2 Cols: Live Filtered Digest Stream */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Mail className="w-4 h-4 text-cyan-400" />
              Live Digest Preview (
              {config.mode === 'advanced'
                ? advancedDigest?.total ?? 0
                : digest.totalMatchingEvents}{' '}
              Qualifying Events)
            </h2>
            <span className="text-xs font-mono text-gray-400">
              {config.mode === 'advanced'
                ? 'Advanced compound filters active'
                : `Noise filtered out: ${events.length - digest.totalMatchingEvents} minor events`}
            </span>
          </div>

          <div className="p-4 rounded-xl border border-gray-800 bg-gray-900/40 text-xs text-gray-300 font-mono">
            {config.mode === 'advanced' ? (
              <>
                <span className="text-cyan-400 font-bold">Advanced Summary: </span>
                {advancedDigest?.total ?? 0} events match your compound filters; top score{' '}
                {advancedDigest?.events[0]?.score ?? 0}/100.
              </>
            ) : (
              <>
                <span className="text-cyan-400 font-bold">Digest Summary: </span>
                {digest.priceDropEvents.length} price cuts (≥ {config.minPriceDropPct}%), {digest.freeTierEvents.length} free additions, and {digest.newModelEvents.length} releases match your rules.
              </>
            )}
          </div>

          {config.mode === 'advanced' ? (
            advancedDigest && advancedDigest.events.length > 0 ? (
              <div className="space-y-3">
                {advancedDigest.events.map(({ event: e, score, reasons }) => (
                  <div key={e.id || `${e.model_id}-${score}`} className="rounded-xl border border-cyan-900/40 bg-[#111827]/70 p-3">
                    <EventCard event={e} />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {reasons.map((r) => (
                          <span
                            key={r}
                            className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/50 px-1.5 py-0.5 rounded"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                      <span className="text-xs font-mono font-bold text-cyan-300 shrink-0">
                        Score {score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center rounded-2xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
                No events match your advanced compound filters.
              </div>
            )
          ) : digest.totalMatchingEvents > 0 ? (
            <div className="space-y-3">
              {[
                ...digest.priceDropEvents,
                ...digest.freeTierEvents,
                ...digest.newModelEvents,
                ...digest.otherEvents,
              ].map((e, idx) => (
                <EventCard key={e.id || `${e.model_id}-${idx}`} event={e} />
              ))}
            </div>
          ) : (
            <div className="p-12 text-center rounded-2xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
              No recent events meet your current threshold of ≥ {config.minPriceDropPct}% drop. Try lowering the threshold to see more candidate events.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
