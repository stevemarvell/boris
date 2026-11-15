export declare const FAST_FAILURE_MS: number;
export interface CheckRun {
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}
export declare function ciDidNotRun(checkRuns: CheckRun[] | null | undefined): boolean;
