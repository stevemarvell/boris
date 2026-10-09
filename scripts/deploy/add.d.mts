export interface DeployValues {
  team: string;
  project: string;
  url: string;
  commitEndpoint: string;
}
export interface AddDeployOptions {
  provider: string;
  app: string;
  team?: string;
  project?: string;
  url?: string;
  commitEndpoint?: string;
  root?: string;
  manifestPath?: string;
}

export declare function parseArgs(argv: string[]): { provider: string; app: string } & Partial<DeployValues>;
export declare function withPlaceholders(options: Partial<DeployValues>): DeployValues;
export declare function renderTemplate(text: string, values: Record<string, string>): string;
export declare function ownerSteps(options: { app: string; team: string; project: string }): string[];
export declare function addDeploy(options: AddDeployOptions): { manifest: unknown; values: DeployValues };
