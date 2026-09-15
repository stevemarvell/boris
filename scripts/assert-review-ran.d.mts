export declare const UNREADABLE: unique symbol;
export declare function reviewVerdict(input?: {
  kind?: string;
  conclusion?: string;
  execution?: unknown[] | null | typeof UNREADABLE;
}): { ok: boolean; headline: string; detail: string };
export declare function readExecution(path: string): unknown[] | null | typeof UNREADABLE;
