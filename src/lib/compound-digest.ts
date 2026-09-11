/**
 * P2 route thinning: the R6 digest hook extracted from the cron route.
 * Pure evaluation + escaped rendering; the route keeps orchestration.
 * Hook failures are returned (not just warn-logged) so the digest JSON
 * exposes `compoundHookError` — a silently dead hook must not look like
 * "no matches".
 */
import { ModelEvent } from '@/types/events';
import { ModelSnapshot } from '@/types/models';
import {
  evaluateCompoundRules,
  type CompoundRuleInput,
} from './compound-rules';
import { escapeHtml } from './sanitize';
import { logger } from './logger';

export interface CompoundDigestMatch {
  model_id: string;
  event_type: string;
  detected_at: string;
  reasons: string[];
}

export interface CompoundDigestSection {
  ruleId: number | string;
  ruleName: string;
  matches: CompoundDigestMatch[];
}

export interface CompoundRuleRow {
  id: number;
  name: string;
  logic: 'and' | 'or';
  conditions: CompoundRuleInput['conditions'];
  owner_email: string;
}

const MATCHES_PER_RULE = 5;

export async function evaluateCompoundForDigest(opts: {
  events: ModelEvent[];
  snapshots: Map<string, ModelSnapshot>;
  batchEmails: string[];
  listRules: (emails: string[]) => Promise<CompoundRuleRow[]>;
}): Promise<{ byOwner: Map<string, CompoundDigestSection[]>; hookError: boolean }> {
  const byOwner = new Map<string, CompoundDigestSection[]>();
  try {
    const rules = await opts.listRules(opts.batchEmails);
    if (rules.length === 0) return { byOwner, hookError: false };
    const evaluated = evaluateCompoundRules(
      opts.events,
      rules.map((r) => ({ id: r.id, name: r.name, logic: r.logic, conditions: r.conditions })),
      opts.snapshots
    );
    const metaById = new Map(rules.map((r) => [r.id, { name: r.name, email: r.owner_email }]));
    for (const ev of evaluated) {
      const meta = metaById.get(Number(ev.ruleId));
      if (!meta) continue;
      const key = meta.email.toLowerCase();
      const list = byOwner.get(key) || [];
      list.push({
        ruleId: ev.ruleId,
        ruleName: ev.ruleName,
        matches: ev.matches.slice(0, MATCHES_PER_RULE).map((m) => ({
          model_id: m.event.model_id,
          event_type: m.event.event_type,
          detected_at: m.event.detected_at,
          reasons: m.reasons,
        })),
      });
      byOwner.set(key, list);
    }
    return { byOwner, hookError: false };
  } catch (hookErr) {
    // Compound matching must never fail the digest itself.
    logger.warn('Compound-rule digest hook failed:', { error: String(hookErr) });
    return { byOwner, hookError: true };
  }
}

/** Escaped HTML for one recipient's sections (all interpolation escaped). */
export function renderCompoundSections(sections: CompoundDigestSection[]): string {
  return sections
    .map(
      (s) => `
      <div class="section">
        <div class="section-title">Compound rule: ${escapeHtml(s.ruleName)}</div>
        ${s.matches.map((m) => `<div class="event-card"><div class="model-name">${escapeHtml(m.model_id)}</div><div style="font-size:12px;color:#93C5FD;">${escapeHtml(m.event_type)} — ${escapeHtml(m.reasons.join('; '))}</div></div>`).join('')}
      </div>`
    )
    .join('');
}

/** Appends sections before </body>; returns rendered html + match count. */
export function appendCompoundSections(
  html: string,
  sections: CompoundDigestSection[]
): { html: string; delivered: number } {
  if (sections.length === 0) return { html, delivered: 0 };
  return {
    html: html.replace('</body>', `${renderCompoundSections(sections)}</body>`),
    delivered: sections.reduce((n, s) => n + s.matches.length, 0),
  };
}
