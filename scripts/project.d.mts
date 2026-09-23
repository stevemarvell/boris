export interface App {
  path: string;
  toolchain: 'python' | 'node';
  reads: string[];
  ignores?: string[];
  vercelProject?: string;
  url?: string;
  commitEndpoint?: string;
}
export interface Project {
  name: string;
  vercel: { team: string };
  apps: Record<string, App>;
}
export declare const ROOT: string;
export declare const MANIFEST: string;
export declare const HARNESS_CODE: string[];
export declare function validate(project: unknown): Project;
export declare function loadProject(path?: string): Project;
export declare function apps(project: Project, toolchain?: string): [string, App][];
export declare function deployed(project: Project): [string, App][];
export declare function appFor(project: Project, relativePath: string): [string, App] | null;
export declare function buildPathspecs(project: Project, name: string): string[] | null;
export declare function verifiedPaths(project: Project): string[];
export declare function cli(argv: string[], project?: Project): string[];
