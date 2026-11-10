export declare const REVIEW_JOBS: string[];
export declare const MAX_RUNS: number;
export interface Run { id?: number; status: string; head_sha: string }
export interface Job { name: string; conclusion: string | null }
export declare function lastReviewed(
  runs: Run[] | null | undefined,
  jobsFor: (run: Run) => Job[] | undefined,
): { state: 'reviewed' | 'pending' | 'none'; sha?: string };
