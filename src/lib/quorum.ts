/**
 * Quorum engine (pure): M-of-N tally for migration-switch approvals.
 *
 * A request leaves 'pending' when EITHER side reaches quorum:
 *  - approvals >= quorum  -> 'approved'
 *  - rejections >= quorum -> 'rejected'
 * Abstentions never block: with quorum=2 and votes [approve, abstain...],
 * one more approve decides. quorum=1 is the legacy single-decider path.
 */

import type { ApprovalVoteDecision } from '@/types/governance';

export const MIN_QUORUM = 1;
export const MAX_QUORUM = 10;

export function validateQuorum(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= MIN_QUORUM &&
    n <= MAX_QUORUM
  );
}

export type QuorumOutcome = 'pending' | 'approved' | 'rejected';

export function tallyVotes(
  decisions: ApprovalVoteDecision[],
  quorum: number
): QuorumOutcome {
  const q = validateQuorum(quorum) ? quorum : 1;
  let approvals = 0;
  let rejections = 0;
  for (const d of decisions) {
    if (d === 'approved') approvals += 1;
    else if (d === 'rejected') rejections += 1;
  }
  if (approvals >= q) return 'approved';
  if (rejections >= q) return 'rejected';
  return 'pending';
}
