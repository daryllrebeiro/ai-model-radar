export type BudgetRuleScope = 'personal' | 'team';

export interface BudgetRule {
  id?: number;
  name: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  monthly_budget_usd: number;
  alert_threshold_pct: number; // 0..1 — alert / count as "approaching" at this fraction
  approval_required: boolean;
  notify_email?: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type BudgetRuleStatus = 'ok' | 'approaching' | 'over';

export interface UsageByModel {
  model_id: string;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
}

export interface FamilySpend {
  family: string;
  monthly_usd: number;
  models: string[];
}

export interface BudgetAlertRecord {
  id?: number;
  rule_id?: number;
  model_family?: string | null;
  projected_monthly_usd: number;
  budget_usd: number;
  pct_used: number;
  alert_type: 'threshold' | 'over_budget' | 'shadow_ai';
  message: string;
  acknowledged?: boolean;
  created_at?: string;
}

export interface BudgetRuleEvaluation {
  rule: BudgetRule;
  projected_monthly_usd: number;
  pct_used: number;
  status: BudgetRuleStatus;
  family_breakdown: FamilySpend[];
  new_alert: BudgetAlertRecord | null;
}

export interface ShadowAiFinding {
  model_id: string;
  estimated_monthly_usd: number;
  reason: string;
}

export interface MigrationApproval {
  id?: number;
  team_id?: number | null;
  rule_id?: number | null;
  from_model_id: string;
  to_model_id: string;
  monthly_savings_usd: number;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  reviewed_by?: string | null;
  decision_at?: string | null;
  created_at?: string;
}

export interface GovernanceStatusReport {
  generated_at: string;
  total_budget_usd: number;
  projected_monthly_usd: number;
  rules: BudgetRuleEvaluation[];
  shadow_ai: ShadowAiFinding[];
  pending_approvals: MigrationApproval[];
  recent_alerts: BudgetAlertRecord[];
}

export interface BudgetRuleInput {
  name?: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  monthly_budget_usd: number;
  alert_threshold_pct?: number;
  approval_required?: boolean;
  notify_email?: string | null;
}