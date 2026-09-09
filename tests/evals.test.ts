import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { validateEvalScores, validateEvalRun, buildLeaderboard } from '@/lib/evals';
import {
  createOrGetUser,
  createApiKey,
  createTeam,
} from '@/lib/db/queries';
import { generateApiKey } from '@/lib/api-keys';
import { POST as submitRoute } from '@/app/api/v1/evals/runs/route';
import { GET as leaderboardRoute } from '@/app/api/v1/evals/leaderboard/route';

describe('validateEvalScores', () => {
  it('accepts well-formed scores and rejects junk', () => {
    expect(validateEvalScores({ sql_gen: 82.5, groundedness: 90 }).ok).toBe(true);
    expect(validateEvalScores({}).ok).toBe(false);
    expect(validateEvalScores([]).ok).toBe(false);
    expect(validateEvalScores({ 'Bad Name!': 50 }).ok).toBe(false);
    expect(validateEvalScores({ ok_metric: 101 }).ok).toBe(false);
    expect(validateEvalScores({ ok_metric: NaN }).ok).toBe(false);
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 21; i += 1) tooMany[`m${i}`] = 50;
    expect(validateEvalScores(tooMany).ok).toBe(false);
  });
});

describe('validateEvalRun', () => {
  it('requires suite/model and clamps samples', () => {
    const good = validateEvalRun({ suite: 'sql-gen', model_id: 'acme/a', scores: { acc: 80 } });
    expect(good.ok).toBe(true);
    expect(validateEvalRun({ suite: '', model_id: 'a', scores: { acc: 80 } }).ok).toBe(false);
    expect(validateEvalRun({ suite: 's', model_id: 'a', scores: { acc: 80 }, samples: 0 }).ok).toBe(false);
  });
});

describe('buildLeaderboard', () => {
  const runs = [
    { model_id: 'acme/a', scores: { acc: 80, lat: 60 }, samples: 10 },
    { model_id: 'acme/a', scores: { acc: 90, lat: 70 }, samples: 10 },
    { model_id: 'acme/b', scores: { acc: 95, lat: 95 }, samples: 5 },
  ];

  it('averages per metric and ranks by unweighted composite', () => {
    const board = buildLeaderboard(runs);
    expect(board[0].model_id).toBe('acme/b');
    const a = board.find((e) => e.model_id === 'acme/a')!;
    expect(a.runs).toBe(2);
    expect(a.total_samples).toBe(20);
    expect(a.mean_scores).toEqual({ acc: 85, lat: 65 });
    expect(a.composite).toBe(75);
  });

  it('applies metric weights when given', () => {
    const board = buildLeaderboard(runs, { acc: 3, lat: 1 });
    // a: (85*3 + 65*1)/4 = 80; b: (95*3 + 95*1)/4 = 95
    expect(board[0].model_id).toBe('acme/b');
    expect(board[0].composite).toBe(95);
    const weighted = buildLeaderboard(runs, { lat: 1 });
    // a: 65; b: 95
    expect(weighted.find((e) => e.model_id === 'acme/a')!.composite).toBe(65);
  });

  it('returns null composite when no weight matches', () => {
    const board = buildLeaderboard(runs, { nope: 2 });
    expect(board.every((e) => e.composite === null)).toBe(true);
  });
});

describe('eval routes', () => {
  async function keyFor(email: string): Promise<string> {
    await createOrGetUser({ email });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('submits runs, validates, gates teams, and aggregates', async () => {
    const stamp = Date.now();
    const owner = `evals.owner.${stamp}@test.dev`;
    const outsider = `evals.out.${stamp}@test.dev`;
    const ownerKey = await keyFor(owner);
    const outsiderKey = await keyFor(outsider);
    const team = await createTeam(`evals team ${stamp}`, owner);
    const teamId = Number((team as any).id);
    const suite = `sql-gen-${stamp}`;

    const submit = (key: string, body: unknown) =>
      submitRoute(
        new NextRequest('http://localhost/api/v1/evals/runs', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );

    const badScores = await submit(ownerKey, { suite, model_id: 'acme/a', scores: { acc: 150 } });
    expect(badScores.status).toBe(400);

    const foreignTeam = await submit(outsiderKey, {
      suite, model_id: 'acme/a', scores: { acc: 80 }, scope: 'team', team_id: teamId,
    });
    expect(foreignTeam.status).toBe(403);

    const personal = await submit(ownerKey, {
      suite, model_id: 'acme/a', scores: { acc: 80, lat: 60 }, samples: 10,
    });
    expect(personal.status).toBe(201);

    const teamRun = await submit(ownerKey, {
      suite, model_id: 'acme/b', scores: { acc: 95, lat: 95 }, scope: 'team', team_id: teamId,
    });
    expect(teamRun.status).toBe(201);

    const boardRes = await leaderboardRoute(
      new NextRequest(`http://localhost/api/v1/evals/leaderboard?suite=${suite}`, {
        headers: { Authorization: `Bearer ${ownerKey}` },
      })
    );
    expect(boardRes.status).toBe(200);
    const board = await boardRes.json();
    expect(board.runs).toBe(2);
    expect(board.leaderboard[0].model_id).toBe('acme/b');

    const teamBoard = await leaderboardRoute(
      new NextRequest(
        `http://localhost/api/v1/evals/leaderboard?suite=${suite}&team_id=${teamId}`,
        { headers: { Authorization: `Bearer ${ownerKey}` } }
      )
    );
    const teamBody = await teamBoard.json();
    expect(teamBody.runs).toBe(1);
    expect(teamBody.leaderboard[0].model_id).toBe('acme/b');

    const denied = await leaderboardRoute(
      new NextRequest(
        `http://localhost/api/v1/evals/leaderboard?suite=${suite}&team_id=${teamId}`,
        { headers: { Authorization: `Bearer ${outsiderKey}` } }
      )
    );
    expect(denied.status).toBe(404);

    const missingSuite = await leaderboardRoute(
      new NextRequest('http://localhost/api/v1/evals/leaderboard', {
        headers: { Authorization: `Bearer ${ownerKey}` },
      })
    );
    expect(missingSuite.status).toBe(400);
  });
});
