import { logger } from '../logger';

export interface EscalationAlert {
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3';
  source: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

/**
 * Dispatches an on-call paging escalation alert to configured Slack/Discord/PagerDuty webhooks
 */
export async function triggerEscalationAlert(alert: EscalationAlert): Promise<{ success: boolean; dispatched: boolean }> {
  const webhookUrl = process.env.PAGING_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;

  logger.error(`[ESCALATION ${alert.severity}] [${alert.source}] ${alert.message}`, {
    service: 'ai-model-radar',
    ...alert.details,
  });

  if (!webhookUrl) {
    // In dev/test, log cleanly without throwing
    return { success: true, dispatched: false };
  }

  try {
    const payload = {
      text: `🚨 *[${alert.severity}] AI Model Radar Production Alert*\n*Source:* ${alert.source}\n*Message:* ${alert.message}\n*Timestamp:* ${alert.timestamp}`,
      attachments: alert.details
        ? [
            {
              color: alert.severity === 'SEV-1' ? '#EF4444' : '#F59E0B',
              fields: Object.entries(alert.details).map(([k, v]) => ({
                title: k,
                value: typeof v === 'object' ? JSON.stringify(v) : String(v),
                short: true,
              })),
            },
          ]
        : undefined,
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return { success: res.ok, dispatched: true };
  } catch (err: any) {
    logger.error(`Failed to dispatch escalation webhook: ${err.message}`);
    return { success: false, dispatched: false };
  }
}
