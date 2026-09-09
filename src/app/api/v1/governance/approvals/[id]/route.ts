import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getBudgetRulesForUser,
  getMigrationApprovals,
  decideMigrationApproval,
  castApprovalVote,
  getApprovalVotes,
  getTeamRole,
} from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/governance/approvals/[id] — approve or reject a migration-switch
 * approval request. Team rules require a team admin; personal rules require the owner.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const idRaw = Array.isArray(params.id) ? params.id[0] : params.id;
    const approvalId = Number(idRaw);
    if (!Number.isInteger(approvalId) || approvalId <= 0) {
      return NextResponse.json({ error: 'Invalid approval id' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
    }

    const rules = await getBudgetRulesForUser(session.user.email);
    const approvals = await getMigrationApprovals({ limit: 200 });
    const approval = approvals.find((a) => a.id === approvalId);
    // Uniform 404 + IDENTICAL body for missing, out-of-window, or
    // another-tenant approvals — even differing messages are an existence
    // oracle, so all three cases share one message.
    if (!approval || approval.rule_id === null || approval.rule_id === undefined) {
      return NextResponse.json({ error: 'Approval not found or not accessible' }, { status: 404 });
    }

    const rule = rules.find((r) => r.id === Number(approval.rule_id));
    if (!rule) {
      return NextResponse.json({ error: 'Approval not found or not accessible' }, { status: 404 });
    }

    const requesterRole = rule.team_id !== null && rule.team_id !== undefined
      ? await getTeamRole(rule.team_id, session.user.email)
      : null;

    const isOwner = rule.owner_email.toLowerCase() === session.user.email.toLowerCase();
    const isTeamAdmin = rule.team_id !== null && requesterRole === 'admin';

    if (!isOwner && !isTeamAdmin) {
      return NextResponse.json(
        { error: 'Only the rule owner or a team admin can decide approvals' },
        { status: 403 }
      );
    }

    // Quorum path: multi-approver requests collect one ballot per voter.
    // The requester cannot vote on their own request (separation of duties).
    if (Number(approval.quorum_required ?? 1) > 1) {
      if (approval.requested_by.toLowerCase() === session.user.email.toLowerCase()) {
        return NextResponse.json(
          { error: 'The requester cannot vote on their own approval request' },
          { status: 403 }
        );
      }
      const { outcome, vote, approval: current } = await castApprovalVote(
        approvalId,
        session.user.email,
        decision
      );
      if (outcome === 'duplicate') {
        return NextResponse.json(
          { error: 'You have already voted on this approval request', approvalId },
          { status: 409 }
        );
      }
      if (outcome === 'closed' || outcome === 'not-found' || !current) {
        return NextResponse.json(
          { error: 'Approval already decided', approvalId },
          { status: 409 }
        );
      }
      const votes = await getApprovalVotes(approvalId);
      return NextResponse.json({
        approval: current,
        vote,
        votes,
        quorum_required: current.quorum_required,
      });
    }

    const updated = await decideMigrationApproval(approvalId, decision, session.user.email);
    if (!updated) {
      // Lost a concurrent decision race, or the row left pending state
      // between read and write: report conflict, not success.
      return NextResponse.json(
        { error: 'Approval already decided', approvalId },
        { status: 409 }
      );
    }
    return NextResponse.json({ approval: updated });
  } catch (err: any) {
    return handleApiError(err, 'governance/approvals/:id POST');
  }
}