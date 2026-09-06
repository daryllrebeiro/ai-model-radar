'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Loader2,
  Users,
  Eye,
  Scale,
} from 'lucide-react';
import { FeatureGate } from '@/components/FeatureGate';
import { AccessTier } from '@/lib/feature-flags';
import { GovernanceStatusReport, BudgetRuleEvaluation, ShadowAiFinding, MigrationApproval, BudgetAlertRecord } from '@/types/governance';
import { Team } from '@/types/teams';

interface GovernanceClientProps {
  featureTier: AccessTier;
}

export function GovernanceClient({ featureTier }: GovernanceClientProps) {
  const [status, setStatus] = useState<GovernanceStatusReport | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const [teamId, setTeamId] = useState<string>('');
  const [budget, setBudget] = useState('1000');
  const [threshold, setThreshold] = useState('0.8');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [statusRes, teamsRes] = await Promise.all([
        fetch('/api/v1/governance/status'),
        fetch('/api/teams'),
      ]);
      if (statusRes.status === 401 || statusRes.status === 403) {
        setError(`Authentication required to view governance (${statusRes.status}).`);
        setLoading(false);
        return;
      }
      if (!statusRes.ok) throw new Error('Failed to load governance status');
      setStatus(await statusRes.json());
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        setTeams((teamsData.teams || []) as Team[]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createRule = async () => {
    if (busy) return;
    setBusy(true);
    setFormMsg(null);
    try {
      const res = await fetch('/api/v1/governance/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ruleName.trim() || undefined,
          scope,
          team_id: scope === 'team' && teamId ? Number(teamId) : null,
          monthly_budget_usd: Number(budget),
          alert_threshold_pct: Number(threshold),
          approval_required: approvalRequired,
          notify_email: notifyEmail.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormMsg((data?.error || 'Failed to create budget rule') as string);
        return;
      }
      setRuleName('');
      setNotifyEmail('');
      setFormMsg(`Budget rule #${data.rule.id} created.`);
      await load();
    } catch (err: any) {
      setFormMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approvalId: number, decision: 'approved' | 'rejected') => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/governance/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) return;
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading governance status…
      </div>
    );
  }

  const evaluations: BudgetRuleEvaluation[] = status?.rules || [];
  const overCount = evaluations.filter((e) => e.status === 'over').length;
  const approachingCount = evaluations.filter((e) => e.status === 'approaching').length;

  return (
    <FeatureGate feature="GOVERNANCE" userTier={featureTier}>
      <div className="space-y-8">
        {error && (
          <div className="rounded-2xl border border-rose-800/60 bg-rose-950/30 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {status && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Kpi label="Total Budget" value={`$${(status.total_budget_usd || 0).toLocaleString()}`} icon={<Wallet className="w-4 h-4 text-cyan-400" />} />
              <Kpi label="Projected Spend" value={`$${(status.projected_monthly_usd || 0).toLocaleString()}`} icon={<Scale className="w-4 h-4 text-violet-400" />} />
              <Kpi label="Rules" value={String(evaluations.length)} icon={<Shield className="w-4 h-4 text-emerald-400" />} />
              <Kpi label="Pending Approvals" value={String((status.pending_approvals || []).length)} icon={<Eye className="w-4 h-4 text-amber-400" />} />
              <Kpi label="Shadow-AI Models" value={String((status.shadow_ai || []).length)} icon={<AlertTriangle className="w-4 h-4 text-rose-400" />} />
            </div>

            {/* Create rule */}
            <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" /> New Budget Rule
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-gray-500">NAME</label>
                  <input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="Monthly inference budget"
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-gray-500">SCOPE</label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as 'personal' | 'team')}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
                  >
                    <option value="personal">Personal</option>
                    <option value="team" disabled={teams.length === 0}>Team</option>
                  </select>
                </div>
                {scope === 'team' && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-gray-500">TEAM</label>
                    <select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
                    >
                      <option value="">Select team…</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-gray-500">MONTHLY BUDGET (USD)</label>
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    type="number"
                    min="1"
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-gray-500">ALERT THRESHOLD (0-1)</label>
                  <input
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-gray-500">NOTIFY EMAIL</label>
                  <input
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="finance@company.com"
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
                  />
                </div>
                <label className="flex items-center gap-2 sm:col-span-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={approvalRequired}
                    onChange={(e) => setApprovalRequired(e.target.checked)}
                    className="accent-cyan-600"
                  />
                  Require approval before migration switches when over budget
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={createRule}
                  disabled={busy || !Number(budget) || Number(budget) <= 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create Rule
                </button>
                {formMsg && <span className="text-xs text-gray-400">{formMsg}</span>}
              </div>
            </div>

            {/* Rules */}
            <div className="space-y-4">
              <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" /> Budget Rules
                {overCount > 0 && <span className="text-rose-400">({overCount} over)</span>}
                {approachingCount > 0 && <span className="text-amber-400">({approachingCount} approaching)</span>}
              </h2>
              {evaluations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400 text-sm">
                  No budget rules yet. Create one above to start governing spend.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5">
                  {evaluations.map((e) => (
                    <RuleCard key={e.rule.id} evaluation={e} />
                  ))}
                </div>
              )}
            </div>

            {/* Shadow AI */}
            <div>
              <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider mb-3">
                Shadow-AI Detection (undocumented endpoints)
              </h2>
              {(status.shadow_ai || []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-700 p-8 text-center text-gray-400 text-sm">
                  No undocumented model spend detected — all usage is against tracked/approved endpoints.
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400">
                        <th className="py-3 px-4">Model Endpoint</th>
                        <th className="py-3 px-4 text-right">Est. Monthly Spend</th>
                        <th className="py-3 px-4">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60 text-gray-300">
                      {(status.shadow_ai || []).map((f: ShadowAiFinding) => (
                        <tr key={f.model_id} className="hover:bg-gray-800/40 transition-colors">
                          <td className="py-3 px-4 text-rose-300 font-semibold">{f.model_id}</td>
                          <td className="py-3 px-4 text-right text-amber-400 font-bold">
                            ${f.estimated_monthly_usd.toLocaleString()}/mo
                          </td>
                          <td className="py-3 px-4 text-gray-400">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pending approvals */}
            <div>
              <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider mb-3">
                Migration Switch Approvals
              </h2>
              {(status.pending_approvals || []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-700 p-8 text-center text-gray-400 text-sm">
                  No pending migration-switch approvals.
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-400">
                        <th className="py-3 px-4">Rule</th>
                        <th className="py-3 px-4">Switch</th>
                        <th className="py-3 px-4 text-right">Savings</th>
                        <th className="py-3 px-4">Requested By</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60 text-gray-300">
                      {status.pending_approvals.map((a: MigrationApproval) => (
                        <tr key={a.id} className="hover:bg-gray-800/40 transition-colors">
                          <td className="py-3 px-4 text-gray-400">#{a.rule_id}</td>
                          <td className="py-3 px-4">
                            <span className="text-gray-400">{a.from_model_id}</span>
                            <span className="mx-1 text-cyan-400">→</span>
                            <span className="text-emerald-300">{a.to_model_id}</span>
                          </td>
                          <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                            ${a.monthly_savings_usd}/mo
                          </td>
                          <td className="py-3 px-4 text-gray-400">{a.requested_by}</td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => decide(a.id!, 'approved')}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700/60 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors mr-2"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => decide(a.id!, 'rejected')}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-800/60 hover:bg-rose-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                            >
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent alerts */}
            <div>
              <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-wider mb-3">
                Recent Budget Alerts
              </h2>
              {(status.recent_alerts || []).length === 0 ? (
                <div className="text-xs text-gray-600">No alerts emitted in the last 24h.</div>
              ) : (
                <div className="space-y-2">
                  {status.recent_alerts.map((a: BudgetAlertRecord) => (
                    <div key={a.id} className="flex items-start gap-2 rounded-xl border border-gray-800 bg-[#111827]/70 px-4 py-3 text-xs">
                      <AlertTriangle className={`w-4 h-4 mt-0.5 ${a.alert_type === 'over_budget' ? 'text-rose-400' : 'text-amber-400'}`} />
                      <div className="font-mono text-gray-300">
                        <span className="text-gray-500">
                          [{a.alert_type}] rule #{a.rule_id}{a.model_family ? ` · ${a.model_family}` : ''} —
                        </span>{' '}
                        {a.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {!status && !error && (
          <div className="py-8 text-center text-gray-500 text-sm">
            No governance data available — sign in to create budget rules.
          </div>
        )}
      </div>
    </FeatureGate>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
        <span>{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function RuleCard({ evaluation }: { evaluation: BudgetRuleEvaluation }) {
  const { rule } = evaluation;
  const pct = Math.min(100, Math.round((evaluation.pct_used || 0) * 100));
  const statusColor =
    evaluation.status === 'over' ? 'bg-rose-500' : evaluation.status === 'approaching' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            {rule.name}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                evaluation.status === 'over'
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : evaluation.status === 'approaching'
                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              }`}
            >
              {evaluation.status}
            </span>
          </h3>
          <p className="text-xs font-mono text-gray-500 mt-0.5">
            #{rule.id} · {rule.scope}
            {rule.scope === 'team' ? ` · team ${rule.team_id}` : ` · ${rule.owner_email}`}
            {rule.approval_required ? ' · approvals required' : ''}
          </p>
        </div>
        <div className="text-right text-xs font-mono">
          <div className="text-gray-400">
            ${evaluation.projected_monthly_usd.toLocaleString()} /{' '}
            <span className="text-gray-200">${rule.monthly_budget_usd.toLocaleString()}</span> /mo
          </div>
          <div className="text-[10px] text-gray-500">threshold {Math.round(rule.alert_threshold_pct * 100)}%</div>
        </div>
      </div>

      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full ${statusColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>

      {evaluation.family_breakdown.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {evaluation.family_breakdown.map((f) => (
            <div key={f.family} className="flex items-center justify-between rounded-lg border border-gray-800/70 bg-gray-950/50 px-3 py-2 text-xs font-mono">
              <span className="text-gray-300">
                <Users className="w-3 h-3 inline mr-1 text-violet-400" />
                {f.family}
              </span>
              <span className="text-gray-400">${f.monthly_usd.toLocaleString()}/mo</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}