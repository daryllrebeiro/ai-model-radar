import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scanFilesForModels, isOrgAllowlisted } from '@/lib/org-scan';
import { ORG_SCAN_SCOPES, ORG_SCAN_DATA_POLICY } from '@/types/org-scan';
import { checkSessionRateLimit, assertPayloadSize, logAuthDenied } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/auth';

/**
 * S2 — Org scan ingest (report-only). Session-authenticated; every run is
 * audit-logged (org, repos, trigger user). Accepts file texts supplied by the
 * GitHub App worker — this route never fetches GitHub itself, stores only
 * match locations + matched lines, creates no PRs, modifies no code.
 */
export const dynamic = 'force-dynamic';

const fileSchema = z.object({
  repo: z.string().min(1).max(200),
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
});

const bodySchema = z.object({
  org: z.string().min(1).max(200),
  files: z.array(fileSchema).max(500),
  known_models: z.array(z.string().min(1).max(200)).max(1000),
});

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) {
    logAuthDenied('org-scan', request, 'no-session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await checkSessionRateLimit(session.user.id, 'org-scan', { limit: 10 });
  if (limited) return limited;
  // Audit H2: 500 files × 200KB could be ~100MB parsed synchronously.
  // Reject oversized bodies BEFORE parsing; the App worker must chunk scans.
  const tooLarge = assertPayloadSize(request, 4 * 1024 * 1024);
  if (tooLarge) return tooLarge;
  let json: unknown;  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request', message: 'Invalid JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad Request', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 }
    );
  }
  // P3 pilot gate: when ORG_SCAN_PILOT_ALLOWLIST is set (post-review pilot),
  // only named orgs may scan. Unset = review-gate open state (no pilot yet —
  // scans still require a session; this gate scopes, never authenticates).
  if (!isOrgAllowlisted(parsed.data.org)) {
    logAuthDenied('org-scan', request, 'org-not-allowlisted');
    return NextResponse.json({ error: 'Forbidden', message: 'Organization is not in the org-scan pilot.' }, { status: 403 });
  }
  const matches = scanFilesForModels(parsed.data.files, parsed.data.known_models);
  const audit = {
    org: parsed.data.org,
    repos_scanned: [...new Set(parsed.data.files.map((f) => f.repo))],
    triggered_by: session.user.email,
    scanned_at: new Date().toISOString(),
    app_scopes: [...ORG_SCAN_SCOPES],
  };
  // Audit log: which repos, when, by whom — no file contents logged.
  const { logger } = await import('@/lib/logger');
  logger.info('org-scan.completed', {
    org: audit.org,
    repos: audit.repos_scanned.length,
    matches: matches.length,
    triggered_by: session.user.id,
  });
  const res = NextResponse.json({
    version: 'v1',
    report_only: true,
    data_policy: ORG_SCAN_DATA_POLICY,
    delete_path: 'DELETE /api/v1/org-scan (org-scoped result purge)',
    uninstall: 'GitHub App uninstall revokes contents:read; verify token invalidation post-uninstall.',
    audit,
    matches,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * P1-3 — org-scoped result purge. The server persists no scan results
 * (report-only by design), so purge is an audited acknowledgment: it logs
 * the deletion request (org, actor, timestamp) and confirms nothing is
 * retained server-side. Clients delete their local copies; uninstall
 * revokes the App's access (see docs/ORG_SCAN_REVIEW.md).
 */
export async function DELETE(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) {
    logAuthDenied('org-scan-purge', request, 'no-session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await checkSessionRateLimit(session.user.id, 'org-scan-purge', { limit: 10 });
  if (limited) return limited;
  let org = '';
  try {
    const json = await request.json();
    if (json && typeof (json as any).org === 'string') org = (json as any).org.slice(0, 200);
  } catch {
    // Empty body purges the caller's org scope implicitly — still audited.
  }
  const { logger } = await import('@/lib/logger');
  logger.info('org-scan.purged', { org: org || '(unspecified)', triggered_by: session.user.id });
  const res = NextResponse.json({
    version: 'v1',
    purged: true,
    org: org || null,
    retained_server_side: 'nothing — scan results are never persisted (report-only). Delete your local copies; uninstall the GitHub App to revoke contents:read.',
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
