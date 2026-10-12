export type RunResult = { status: number; stdout: string; stderr: string };
export type Run = (args: string[]) => Promise<RunResult>;

export interface PullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headRefName: string;
  headRefOid?: string;
  mergeable?: string;
  statusCheckRollup?: unknown[];
}

export interface BranchWithAhead {
  name: string;
  ahead: number | null;
}

export interface OrphanedBranch {
  name: string;
  ahead: number;
  where: string;
}

export interface Worktree {
  path: string;
  branch: string | null;
}

export interface UntrackedWorktree {
  name: string;
  entryCount: number;
  hasChanges: boolean;
}

export interface MergedWorktree {
  path: string;
  branch: string;
  pr: number;
}

export interface StalePullRequest {
  number: number;
  title: string;
  reasons: string[];
}

export interface Findings {
  orphanedBranches: OrphanedBranch[];
  untrackedWorktrees: UntrackedWorktree[];
  mergedWorktrees: MergedWorktree[];
  staleOrConflicting: StalePullRequest[];
  noChecksRegistered: PullRequest[];
}

export declare const MAX_MERGES_BEHIND: number;
export declare const WORKTREES_DIR: string;
export declare function gh(args: string[]): Promise<RunResult>;
export declare function git(args: string[]): Promise<RunResult>;
export declare function localBranches(run: Run): Promise<string[]>;
export declare function remoteBranches(run: Run): Promise<string[]>;
export declare function aheadCount(run: Run, develop: string, ref: string): Promise<number | null>;
export declare function behindMergeCount(run: Run, develop: string, ref: string): Promise<number | null>;
export declare function parseWorktreeList(porcelain: string): Worktree[];
export declare function worktreeList(run: Run): Promise<Worktree[]>;
export declare function allPullRequests(run: Run, limit?: number): Promise<PullRequest[]>;
export declare function orphanedBranches(
  branches: { local?: BranchWithAhead[]; remote?: BranchWithAhead[] },
  prs: PullRequest[],
): OrphanedBranch[];
export declare function untrackedWorktreeFolders(diskNames: string[], registeredPaths: string[]): string[];
export declare function mergedWorktrees(worktrees: Worktree[], prs: PullRequest[]): MergedWorktree[];
export declare function staleOrConflicting(prs: PullRequest[], behind?: Map<number, number | null>): StalePullRequest[];
export declare function noChecksRegistered(prs: PullRequest[]): PullRequest[];
export declare function isEmpty(findings: Findings): boolean;
export declare function find(options?: {
  gh?: Run;
  git?: Run;
  develop?: string;
  worktreesDir?: string;
  readDir?: (dir: string) => string[];
  gitStatus?: (dir: string) => Promise<boolean | null>;
}): Promise<Findings>;
export declare function renderFindings(findings: Findings): string[];
export declare function render(findings: Findings): string;
