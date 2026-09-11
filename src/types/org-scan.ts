/**
 * S2 — Org-wide model-usage audit (report-only) types.
 * Minimal scope: contents read-only. Report stores match locations + the
 * single matched line only — never surrounding source beyond that line, never
 * full file contents. No PR creation, no code modification.
 */

export interface OrgFileRef {
  repo: string;
  path: string;
  line: number;
  matched_line: string;
}

export interface OrgMatch extends OrgFileRef {
  matched_model: string;
  deprecation_status: 'active' | 'announced' | 'removed' | 'unknown';
  risk_note: string | null;
}

export interface OrgScanAudit {
  org: string;
  repos_scanned: string[];
  triggered_by: string;
  scanned_at: string;
  app_scopes: string[];
}

export const ORG_SCAN_SCOPES = ['contents:read'] as const;

export const ORG_SCAN_DATA_POLICY =
  'Scans read file contents via contents:read only. Stored: repo, path, line number, matched model id, and the single matched line. Full file contents are never retained. Results deletable at any time; uninstall revokes access.';
