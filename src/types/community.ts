export interface HuggingFaceModel {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  pipeline_tag?: string;
  tags?: string[];
  trendingScore?: number;
  created_at?: string;
  lastModified?: string;
  isPrivate?: boolean;
}

export type CommunityEventType =
  | 'TRENDING_RELEASE'
  | 'DOWNLOAD_SPIKE'
  | 'NEW_REPO';

export interface CommunityEvent {
  id?: number;
  model_id: string;
  author: string;
  name: string;
  event_type: CommunityEventType;
  downloads: number;
  likes: number;
  pipeline_tag: string;
  trending_score: number;
  detected_at: string;
  url: string;
}
