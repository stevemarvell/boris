export declare function reviewVerdict(input?: {
  kind?: string;
  conclusion?: string;
  execution?: unknown[] | null;
}): { ok: boolean; headline: string; detail: string };
export declare function readExecution(path: string): unknown[] | null;
