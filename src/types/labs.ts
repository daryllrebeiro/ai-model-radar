export interface LabActivityItem {
  id: string;
  org: string;
  repo: string;
  event_type: 'NEW_REPO' | 'RELEASE_TAG' | 'CONFIG_UPDATE' | 'TOKENIZER_CHANGE';
  title: string;
  description: string;
  commit_sha?: string;
  url: string;
  detected_at: string;
  tags?: string[];
}
