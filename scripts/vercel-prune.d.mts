export interface Deployment {
  uid?: string;
  id?: string;
  target?: string | null;
  meta?: { githubCommitRef?: string };
}
export type Rule = { branch: string; live?: undefined } | { live: Set<string>; branch?: undefined };
export type FetchJson = (url: string) => Promise<{ deployments: Deployment[]; pagination?: { next?: number | null } }>;

export declare const TEAM: string;
export declare const PROJECTS: string[];
export declare const PRODUCTION_BRANCH: string;
export declare const MAX_PAGES: number;
export declare function isPreview(deployment: Deployment): boolean;
export declare function select(deployments: Deployment[], rule: Rule): Deployment[];
export declare function listDeployments(fetchJson: FetchJson, project: string, branch?: string): Promise<Deployment[]>;
export declare function main(argv: string[], env: Record<string, string | undefined>): Promise<void>;
export declare function prune(options: {
  fetchJson: FetchJson;
  remove: (id: string) => Promise<unknown>;
  rule: Rule;
  dryRun?: boolean;
  log?: (line: string) => void;
  projects?: string[];
}): Promise<{ project: string; id: string; branch: string }[]>;
