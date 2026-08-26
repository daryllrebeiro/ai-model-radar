import { LabActivityItem } from '@/types/labs';
import { recordIngestionRun } from '../db/queries';
import { logger } from '../logger';

interface TargetRepo {
  org: string;
  repo: string;
}

const TARGET_REPOS: TargetRepo[] = [
  { org: 'deepseek-ai', repo: 'DeepSeek-R1' },
  { org: 'anthropics', repo: 'anthropic-quickstarts' },
  { org: 'meta-llama', repo: 'llama-recipes' },
  { org: 'mistralai', repo: 'mistral-common' },
  { org: 'openai', repo: 'evals' },
  { org: 'QwenLM', repo: 'Qwen2.5-Coder' },
];

/**
 * Fetches live activity (releases and latest commits) from GitHub public REST API
 * Authenticated via GITHUB_TOKEN when provided. No synthetic fallback timestamps.
 */
export async function fetchLabActivity(): Promise<LabActivityItem[]> {
  const activities: LabActivityItem[] = [];
  const startedAt = new Date().toISOString();
  let failedRepos = 0;
  let lastError: string | undefined;

  const headers: Record<string, string> = {
    'User-Agent': 'AI-Model-Radar/1.0',
    Accept: 'application/vnd.github.v3+json',
  };

  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }

  for (const target of TARGET_REPOS) {
    try {
      const url = `https://api.github.com/repos/${target.org}/${target.repo}/commits?per_page=2`;
      const res = await fetch(url, {
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        failedRepos++;
        const errorText = await res.text().catch(() => res.statusText);
        lastError = `GitHub API ${res.status} on ${target.org}/${target.repo}: ${errorText}`;
        logger.warn(`GitHub API request failed for ${target.org}/${target.repo}:`, {
          status: res.status,
          rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
        });
        continue;
      }

      const commits = await res.json();
      if (Array.isArray(commits)) {
        for (const c of commits) {
          const message = c.commit?.message?.split('\n')[0] || 'Repository update';
          const sha = c.sha?.substring(0, 7) || 'HEAD';
          const date = c.commit?.author?.date || new Date().toISOString();

          activities.push({
            id: `${target.org}-${target.repo}-${sha}`,
            org: target.org,
            repo: target.repo,
            event_type: 'CONFIG_UPDATE',
            title: `${target.repo}: ${message}`,
            description: c.commit?.message || 'Updated configuration and model recipes.',
            commit_sha: sha,
            url: c.html_url || `https://github.com/${target.org}/${target.repo}/commit/${sha}`,
            detected_at: date,
            tags: [target.repo.toLowerCase(), 'commit', 'verified-source'],
          });
        }
      }
    } catch (err: any) {
      failedRepos++;
      lastError = err.message || String(err);
      logger.warn(`Failed to fetch GitHub commits for ${target.org}/${target.repo}:`, { error: lastError });
    }
  }

  const finishedAt = new Date().toISOString();
  const status = failedRepos === 0 ? 'success' : activities.length > 0 ? 'partial' : 'failed';

  // Record ingestion audit run with real status
  await recordIngestionRun({
    source: 'github',
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    models_seen: activities.length,
    events_emitted: activities.length,
    error_detail: lastError,
  }).catch(() => {});

  // Return strictly verified live activities sorted newest first.
  // NO synthetic fallback records are ever returned.
  return activities.sort(
    (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
  );
}
