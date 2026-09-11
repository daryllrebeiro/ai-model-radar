import {
  createOrGetUser,
  createTeam,
  createBudgetRule,
  insertSnapshots,
  insertEvents,
} from '../src/lib/db/queries';

/** Unique, collision-proof test email: Date.now() + random (safe under parallel workers). */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.dev`;
}

/**
 * P1-2 — per-file model-id namespace. Suites that share the mutable local
 * JSON backend MUST scope ids through ns() so ingestion tests in one file
 * can never pollute reader tests in another (the price-history
 * MODEL_REMOVED flake). Usage: `const MODEL_ID = ns('price-history')('model')`.
 */
export function ns(file: string): (id: string) => string {
  const run = Date.now().toString(36);
  return (id: string) => `test/${file}/${run}/${id}`;
}

/**
 * P1-2 — clears snapshot/event state in the LOCAL backend only. Postgres
 * mode is untouched (shared tables there are test-transactional where used;
 * never bulk-delete a shared database from a helper). Call in beforeEach
 * for suites asserting positional event/snapshot identity.
 */
export async function resetLocalBackend(): Promise<void> {
  const { isPostgres, getLocalState, saveLocalState } = await import('../src/lib/db/client');
  if (isPostgres()) return;
  const state = getLocalState();
  state.snapshots = [];
  state.events = [];
  saveLocalState(state);
}

/** Seeds user → team → personal + team budget rules; returns all handles. Pass an explicit email for deterministic cross-run seeding (e.g. parity tests). */
export async function seedTeamWithGovernance(prefix = 'hx', email?: string) {
  email = email || uniqueEmail(`${prefix}.owner`);
  const user = await createOrGetUser({ email });
  const team = await createTeam(`${prefix} team ${Date.now()}`, email);
  const personal = await createBudgetRule({
    name: `${prefix} personal`,
    scope: 'personal',
    owner_email: email,
    monthly_budget_usd: 500,
  });
  const teamRule = await createBudgetRule({
    name: `${prefix} team rule`,
    scope: 'team',
    team_id: (team as any).id,
    owner_email: email,
    monthly_budget_usd: 800,
  });
  return { email, user, team, personal, teamRule };
}

/** Seeds one snapshot + one event under a unique model prefix. */
export async function seedCatalog(prefix: string, detectedAt?: string) {
  const at = detectedAt || new Date().toISOString();
  await insertSnapshots([
    {
      model_id: `${prefix}/m0`,
      provider: 'HxCo',
      name: `${prefix} Model`,
      price_prompt: 0.000002,
      price_completion: 0.000008,
      context_length: 64000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: at,
    },
  ] as any);
  await insertEvents([
    {
      model_id: `${prefix}/m0`,
      event_type: 'PRICE_CHANGE',
      old_value: { price_prompt: 0.000004 },
      new_value: { price_prompt: 0.000002 },
      pct_change: -50,
      source: 'hx-seed',
      detected_at: at,
    },
  ] as any);
}
