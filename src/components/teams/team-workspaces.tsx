'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, UserPlus, FolderGit2, Loader2 } from 'lucide-react';
import { FeatureGate } from '@/components/FeatureGate';
import { AccessTier } from '@/lib/feature-flags';
import { TeamDetail } from '@/types/teams';

interface TeamWorkspacesProps {
  featureTier: AccessTier;
}

export function TeamWorkspaces({ featureTier }: TeamWorkspacesProps) {
  const [teams, setTeams] = useState<TeamDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [memberEmails, setMemberEmails] = useState<Record<number, string>>({});
  const [watchModelIds, setWatchModelIds] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const loadTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/teams');
      if (!res.ok) throw new Error('Failed to load teams');
      const data = await res.json();
      const detailed = await Promise.all(
        data.teams.map((t: { id: number }) =>
          fetch(`/api/teams/${t.id}`).then((r) => r.json()).then((d) => d.team as TeamDetail)
        )
      );
      setTeams(detailed);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const createTeam = async () => {
    if (!newTeamName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (!res.ok) return;
      setNewTeamName('');
      await loadTeams();
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (teamId: number) => {
    const email = memberEmails[teamId]?.trim();
    if (!email || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setMemberEmails((prev) => ({ ...prev, [teamId]: '' }));
      await loadTeams();
    } finally {
      setBusy(false);
    }
  };

  const addToSharedWatchlist = async (teamId: number) => {
    const modelId = watchModelIds[teamId]?.trim();
    if (!modelId || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/teams/${teamId}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      setWatchModelIds((prev) => ({ ...prev, [teamId]: '' }));
      await loadTeams();
    } finally {
      setBusy(false);
    }
  };

  const removeFromSharedWatchlist = async (teamId: number, modelId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/teams/${teamId}/watchlist?modelId=${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      });
      await loadTeams();
    } finally {
      setBusy(false);
    }
  };

  const deleteTeam = async (teamId: number) => {
    if (busy || !confirm('Delete this team workspace? Members and shared watchlists will be removed.')) return;
    setBusy(true);
    try {
      await fetch(`/api/teams/${teamId}`, { method: 'DELETE' });
      await loadTeams();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading team workspaces…
      </div>
    );
  }

  if (error) {
    return <div className="text-rose-400 text-sm py-8">Failed to load team workspaces: {error}</div>;
  }

  return (
    <FeatureGate feature="TEAM_MANAGEMENT" userTier={featureTier}>
      <div className="space-y-6">
        {/* Create team */}
        <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 p-5 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-cyan-400" /> Create a Team Workspace
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Shared watchlists and members across your whole org.
            </p>
          </div>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTeam()}
            placeholder="e.g. Platform Engineering"
            className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
          />
          <button
            onClick={createTeam}
            disabled={busy || !newTeamName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Team
          </button>
        </div>

        {/* Team list */}
        {teams.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-gray-400 text-sm">
            No team workspaces yet. Create one above to start sharing model watchlists.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {teams.map((team) => (
              <div key={team.id} className="rounded-2xl border border-gray-800 bg-[#111827]/80 p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-cyan-400" /> {team.name}
                    </h3>
                    <p className="text-xs font-mono text-gray-500 mt-0.5">
                      #{team.id} · owned by {team.owner_email}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteTeam(team.id)}
                    className="text-gray-500 hover:text-rose-400 transition-colors"
                    title="Delete workspace"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Members */}
                <div>
                  <div className="text-xs font-mono text-gray-400 uppercase tracking-wider mb-2">
                    Members ({team.members.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {team.members.map((m) => (
                      <span
                        key={m.member_email}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-950 text-xs font-mono text-gray-300"
                      >
                        {m.member_email}
                        <span
                          className={`text-[9px] uppercase font-bold px-1 rounded ${
                            m.role === 'admin' ? 'bg-cyan-950 text-cyan-400' : 'bg-gray-800 text-gray-400'
                          }`}
                        >
                          {m.role}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      value={memberEmails[team.id] || ''}
                      onChange={(e) => setMemberEmails((prev) => ({ ...prev, [team.id]: e.target.value }))}
                      placeholder="invite@company.com"
                      className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
                    />
                    <button
                      onClick={() => addMember(team.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm disabled:opacity-50 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>

                {/* Shared watchlist */}
                <div>
                  <div className="text-xs font-mono text-gray-400 uppercase tracking-wider mb-2">
                    Shared Watchlist ({team.sharedWatchlist.length})
                  </div>
                  {team.sharedWatchlist.length === 0 ? (
                    <p className="text-xs text-gray-500">No shared models yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {team.sharedWatchlist.map((modelId) => (
                        <span
                          key={modelId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cyan-800/40 bg-cyan-950/40 text-xs font-mono text-cyan-300"
                        >
                          {modelId}
                          <button
                            onClick={() => removeFromSharedWatchlist(team.id, modelId)}
                            className="text-cyan-500 hover:text-white transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <input
                      value={watchModelIds[team.id] || ''}
                      onChange={(e) => setWatchModelIds((prev) => ({ ...prev, [team.id]: e.target.value }))}
                      placeholder="openai/gpt-4o"
                      className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
                    />
                    <button
                      onClick={() => addToSharedWatchlist(team.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Track
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </FeatureGate>
  );
}