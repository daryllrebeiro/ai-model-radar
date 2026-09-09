import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { tallyVotes, validateQuorum } from '@/lib/quorum';
import {
  createOrGetUser,
  createApiKey,
  createTeam,
  addTeamMember,
  createBudgetRule,
  createMigrationApproval,
  castApprovalVote,
  getApprovalVotes,
} from '@/lib/db/queries';
import { generateApiKey } from '@/lib/api-keys';
import { POST as openApprovalRoute } from '@/app/api/v1/governance/approvals/route';
import { POST as decideApprovalRoute } from '@/app/api/v1/governance/approvals/[id]/route';

describe('tallyVotes', () => {
  it('stays pending below quorum on either side', () => {
    expect(tallyVotes(['approved'], 2)).toBe('pending');
    expect(tallyVotes(['approved', 'rejected'], 2)).toBe('pending');
    expect(tallyVotes([], 1)).toBe('pending');
  });

  it('approves at M approvals, rejects at M rejections', () => {
    expect(tallyVotes(['approved'], 1)).toBe('approved');
    expect(tallyVotes(['rejected', 'approved', 'approved'], 2)).toBe('approved');
    expect(tallyVotes(['rejected'], 1)).toBe('rejected');
    expect(tallyVotes(['approved', 'rejected', 'rejected'], 2)).toBe('rejected');
  });

  it('approvals win ties when both sides reach quorum simultaneously', () => {
    expect(tallyVotes(['approved', 'rejected'], 1)).toBe('approved');
  });
});

describe('validateQuorum', () => {
  it('accepts integers 1..10 only', () => {
    expect(validateQuorum(1)).toBe(true);
    expect(validateQuorum(10)).toBe(true);
    expect(validateQuorum(0)).toBe(false);
    expect(validateQuorum(11)).toBe(false);
    expect(validateQuorum(1.5)).toBe(false);
    expect(validateQuorum('2')).toBe(false);
    expect(validateQuorum(NaN)).toBe(false);
  });
});

async function keyFor(email: string): Promise<string> {
  await createOrGetUser({ email });
  const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
  await createApiKey(keyRecord);
  return plaintextKey;
}

describe('castApprovalVote', () => {
  it('records ballots until quorum decides, then closes', async () => {
    const stamp = Date.now();
    const owner = `quorum.owner.${stamp}@test.dev`;
    await createOrGetUser({ email: owner });
    const team = await createTeam(`quorum team ${stamp}`, owner);
    const rule = await createBudgetRule({
      name: 'quorum cap',
      scope: 'team',
      team_id: (team as any).id,
      owner_email: owner,
      monthly_budget_usd: 500,
    });
    const approval = await createMigrationApproval({
      team_id: (team as any).id,
      rule_id: rule.id,
      from_model_id: 'acme/old',
      to_model_id: 'acme/new',
      monthly_savings_usd: 50,
      requested_by: owner,
      quorum_required: 2,
    });
    expect(approval.quorum_required).toBe(2);

    const voterA = `quorum.a.${stamp}@test.dev`;
    const voterB = `quorum.b.${stamp}@test.dev`;
    await createOrGetUser({ email: voterA });
    await createOrGetUser({ email: voterB });

    const first = await castApprovalVote(Number(approval.id), voterA, 'approved');
    expect(first.outcome).toBe('recorded');
    expect(first.approval?.status).toBe('pending');

    const dup = await castApprovalVote(Number(approval.id), voterA, 'approved');
    expect(dup.outcome).toBe('duplicate');

    const second = await castApprovalVote(Number(approval.id), voterB, 'approved');
    expect(second.outcome).toBe('decided-approved');
    expect(second.approval?.status).toBe('approved');
    expect(second.approval?.reviewed_by).toBe(voterB.toLowerCase());

    const late = await castApprovalVote(Number(approval.id), `quorum.c.${stamp}@test.dev`, 'approved');
    expect(late.outcome).toBe('closed');

    const votes = await getApprovalVotes(Number(approval.id));
    expect(votes).toHaveLength(2);
  });

  it('rejects at M rejections and reports unknown ids', async () => {
    const stamp = Date.now();
    const owner = `quorum.rej.${stamp}@test.dev`;
    await createOrGetUser({ email: owner });
    const approval = await createMigrationApproval({
      from_model_id: 'acme/old',
      to_model_id: 'acme/new',
      monthly_savings_usd: 5,
      requested_by: owner,
      quorum_required: 2,
    });
    const r1 = await castApprovalVote(Number(approval.id), `quorum.r1.${stamp}@test.dev`, 'rejected');
    expect(r1.outcome).toBe('recorded');
    const r2 = await castApprovalVote(Number(approval.id), `quorum.r2.${stamp}@test.dev`, 'rejected');
    expect(r2.outcome).toBe('decided-rejected');
    expect(r2.approval?.status).toBe('rejected');

    const missing = await castApprovalVote(999999999, owner, 'approved');
    expect(missing.outcome).toBe('not-found');
  });
});

describe('quorum approval routes', () => {
  it('opens a quorum-2 request, blocks self-votes, and decides on the second ballot', async () => {
    const stamp = Date.now();
    const owner = `quorum.rt.owner.${stamp}@test.dev`;
    const adminB = `quorum.rt.b.${stamp}@test.dev`;
    const adminC = `quorum.rt.c.${stamp}@test.dev`;
    const ownerKey = await keyFor(owner);
    const bKey = await keyFor(adminB);
    const cKey = await keyFor(adminC);
    const team = await createTeam(`quorum rt team ${stamp}`, owner);
    await addTeamMember(Number((team as any).id), adminB, 'admin');
    await addTeamMember(Number((team as any).id), adminC, 'admin');

    // Owner creates a team rule directly (rules POST covered elsewhere).
    const rule = await createBudgetRule({
      name: 'quorum rt cap',
      scope: 'team',
      team_id: Number((team as any).id),
      owner_email: owner,
      monthly_budget_usd: 900,
    });

    const opened = await openApprovalRoute(
      new NextRequest('http://localhost/api/v1/governance/approvals', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_id: rule.id,
          from_model_id: 'acme/old',
          to_model_id: 'acme/new',
          monthly_savings_usd: 30,
          quorum_required: 2,
        }),
      })
    );
    expect(opened.status).toBe(201);
    const approval = (await opened.json()).approval;
    expect(approval.quorum_required).toBe(2);

    const decide = (key: string, id: number, decision: string) =>
      decideApprovalRoute(
        new NextRequest(`http://localhost/api/v1/governance/approvals/${id}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        }),
        { params: { id: String(id) } }
      );

    // Requester cannot vote on their own request.
    const selfVote = await decide(ownerKey, approval.id, 'approved');
    expect(selfVote.status).toBe(403);

    const voteB = await decide(bKey, approval.id, 'approved');
    expect(voteB.status).toBe(200);
    expect((await voteB.json()).approval.status).toBe('pending');

    const dupB = await decide(bKey, approval.id, 'approved');
    expect(dupB.status).toBe(409);

    const voteC = await decide(cKey, approval.id, 'approved');
    expect(voteC.status).toBe(200);
    const finalBody = await voteC.json();
    expect(finalBody.approval.status).toBe('approved');
    expect(finalBody.votes).toHaveLength(2);
  });

  it('rejects quorum_required outside 1..10', async () => {
    const stamp = Date.now();
    const owner = `quorum.rt.bad.${stamp}@test.dev`;
    const ownerKey = await keyFor(owner);
    const team = await createTeam(`quorum bad team ${stamp}`, owner);
    const rule = await createBudgetRule({
      name: 'quorum bad cap',
      scope: 'team',
      team_id: Number((team as any).id),
      owner_email: owner,
      monthly_budget_usd: 100,
    });
    const res = await openApprovalRoute(
      new NextRequest('http://localhost/api/v1/governance/approvals', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_id: rule.id,
          from_model_id: 'a',
          to_model_id: 'b',
          quorum_required: 99,
        }),
      })
    );
    expect(res.status).toBe(400);
  });
});
