export type TeamRole = 'admin' | 'member';

export interface Team {
  id: number;
  name: string;
  slug: string;
  owner_email: string;
  owner_user_id?: number | null;
  created_at: string;
}

export interface TeamMember {
  id: number;
  team_id: number;
  member_email: string;
  role: TeamRole;
  created_at: string;
}

export interface TeamDetail extends Team {
  members: TeamMember[];
  sharedWatchlist: string[];
}