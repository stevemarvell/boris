export type Git = (args: string[]) => { status: number; stdout: string };
export declare const PATHSPECS: Record<'api' | 'web', string[]>;
export declare function forkPoint(git: Git): string | null;
export declare function decide(
  project: string,
  env: Record<string, string | undefined>,
  git: Git,
): { build: boolean; reason: string };
