import type { Project } from './project.d.mts';

export type RunResult = { status: number; stdout: string; stderr: string };
export type Run = (cmd: string, args: string[]) => Promise<RunResult>;

export interface CreateArgs {
  name: string;
  owner: string;
  dir: string;
  public: boolean;
}
export interface CheckArgs {
  skipVerify: boolean;
  dryRun: boolean;
  repo?: string;
}
export interface PreflightResult {
  name: string;
  ok: boolean;
  detail: string;
}
export interface CheckLine {
  mark: string;
  text: string;
}
export interface CheckResult {
  lines: string[];
  exitCode: number;
}
export interface OwnerIssue {
  title: string;
  rank: 'critical' | 'high' | 'medium';
  body: string;
}

export declare const STORY_TEMPLATE_PATH: string;
export declare const BASE_REMOTE: string;
export declare const PREFLIGHT_NODE_MAJOR: number;
export declare const TELEMETRY_FILES: string[];
export declare const MARK: { done: string; fixed: string; owner: string };
export declare const OWNER_ISSUES: OwnerIssue[];
export declare const TEMPLATE_ISSUE_TITLE: string;

export declare function exec(cmd: string, args: string[]): Promise<RunResult>;

export declare function parseCreateArgs(argv: string[]): CreateArgs;
export declare function parseCheckArgs(argv: string[]): CheckArgs;

export declare function preflight(options?: { run?: Run; nodeVersion?: string }): Promise<PreflightResult[]>;
export declare function missingPreflight(results: PreflightResult[]): PreflightResult[];

export declare function renameJsonName(path: string, oldName: string, newName: string): boolean;
export declare function renamePyproject(path: string, oldName: string, newName: string): boolean;
export declare function renameTelemetry(root: string, oldName: string, newName: string): string[];
export declare function placeholderClaudeMd(text: string, options: { owner: string; name: string }): string;
export declare function rewriteIdentityTestForClone(
  source: string,
  options: { oldName: string; newName: string; owner: string },
): string;
export declare function renameIdentity(options: {
  root: string;
  oldName: string;
  newName: string;
  owner: string;
  project: Project;
}): string[];

export declare function renderCheck(results: CheckLine[]): CheckResult;
export declare function branchProtectionDecision(options: { isPrivate: boolean }): CheckLine;
export declare function missingOwnerIssues(existingTitles: string[]): OwnerIssue[];
export declare function needsTemplateIssue(openIssues: { labels?: string[] }[]): boolean;

export declare function runCheck(options?: {
  repo?: string;
  dryRun?: boolean;
  skipVerify?: boolean;
  run?: Run;
  fetchUrl?: typeof fetch;
  runVerify?: () => number;
  runIdentityTest?: () => { ok: boolean; output: string };
}): Promise<CheckResult>;

export declare function ensureEmptyTarget(options: { run: Run; target: string }): Promise<{ exists: boolean }>;
export declare function create(options: CreateArgs, deps?: { run?: Run }): Promise<CheckResult>;
export declare function main(argv: string[]): Promise<number>;
