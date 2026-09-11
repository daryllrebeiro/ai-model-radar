/**
 * P2 table-manifest codegen (first step): the SINGLE source of truth for
 * every data table. Previously six touch points per table (schema.sql,
 * migrations/, LocalDbState ×3, backup list, restore order, serials,
 * EXPECTED_TABLES) — now backup/restore/migrate import this manifest and
 * tests/table-manifest.test.ts fails on any drift between them.
 *
 * Order: FK parents before children (restore replays top-down).
 * `local`: LocalDbState key (differs for snapshots/events only).
 * `serial`: SERIAL/BIGSERIAL PK whose sequence restore must advance.
 * NOTE: processed_stripe_event_ids has a TEXT PK — not serial, by design.
 */
export interface TableDef {
  pg: string;
  local: string;
  serial: boolean;
}

export const TABLE_MANIFEST: TableDef[] = [
  { pg: 'users', local: 'users', serial: true },
  { pg: 'teams', local: 'teams', serial: true },
  { pg: 'user_watchlists', local: 'user_watchlists', serial: true },
  { pg: 'usage_profiles', local: 'usage_profiles', serial: true },
  { pg: 'team_members', local: 'team_members', serial: true },
  { pg: 'team_watchlists', local: 'team_watchlists', serial: true },
  { pg: 'budget_rules', local: 'budget_rules', serial: true },
  { pg: 'budget_alerts', local: 'budget_alerts', serial: true },
  { pg: 'shadow_ai_findings', local: 'shadow_ai_findings', serial: true },
  { pg: 'migration_approvals', local: 'migration_approvals', serial: true },
  { pg: 'approval_votes', local: 'approval_votes', serial: true },
  { pg: 'webhook_dlq', local: 'webhook_dlq', serial: true },
  { pg: 'model_eol', local: 'model_eol', serial: true },
  { pg: 'eval_runs', local: 'eval_runs', serial: true },
  { pg: 'usage_imports', local: 'usage_imports', serial: true },
  { pg: 'compound_rules', local: 'compound_rules', serial: true },
  { pg: 'case_studies', local: 'case_studies', serial: true },
  { pg: 'export_connectors', local: 'export_connectors', serial: true },
  { pg: 'routing_attempts', local: 'routing_attempts', serial: true },
  { pg: 'routing_pilot_optins', local: 'routing_pilot_optins', serial: true },
  // FK-independent tables (order irrelevant, kept stable for diffability)
  { pg: 'model_snapshots', local: 'snapshots', serial: true },
  { pg: 'model_events', local: 'events', serial: true },
  { pg: 'ingestion_runs', local: 'ingestion_runs', serial: true },
  { pg: 'api_keys', local: 'api_keys', serial: true },
  { pg: 'digest_deliveries', local: 'digest_deliveries', serial: true },
  { pg: 'alert_rules', local: 'alert_rules', serial: true },
  { pg: 'endpoint_telemetry', local: 'endpoint_telemetry', serial: true },
  { pg: 'processed_stripe_event_ids', local: 'processed_stripe_event_ids', serial: false },
  { pg: 'fk_orphans', local: 'fk_orphans', serial: true },
];

/** Canonical restore/backup order: FK parents before children. */
export const RESTORE_ORDER: string[] = TABLE_MANIFEST.map((t) => t.pg);

/** Tables whose SERIAL/BIGSERIAL sequences restore must advance. */
export const SERIAL_TABLES: Set<string> = new Set(
  TABLE_MANIFEST.filter((t) => t.serial).map((t) => t.pg)
);

/** Every LocalDbState key the file backend must hydrate. */
export function localStateKeys(): string[] {
  return TABLE_MANIFEST.map((t) => t.local);
}
