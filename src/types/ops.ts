export interface CommunityRecord {
  id: number;
  x_community_url: string; // UNIQUE
  token_full_name?: string;
  ticker?: string;
  axiom_row_url?: string;
  avatar_url?: string;
  avatar_local_path?: string;
  community_banner_path?: string;
  community_name?: string;
  first_seen_at: string; // ISO datetime
  posted_personal_at?: string; // ISO datetime
  joined_at?: string; // ISO datetime
  posted_community_at?: string; // ISO datetime
  notes?: string;
}

export type RunAction =
  | 'crawl_discover_trending_30m'
  | 'post_personal_tweet'
  | 'join_community'
  | 'post_community'
  | 'rate_limit_skip'
  | 'filter_skip';

export interface RunRecord {
  ts: string; // ISO datetime
  action: RunAction;
  target_url?: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  screenshot_path?: string;
  tweet_id?: string;
  details?: Record<string, unknown>;
}


