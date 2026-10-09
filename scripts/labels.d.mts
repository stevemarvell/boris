export interface Label {
  name: string;
  color: string;
  description: string;
}
export type LabelAction = Label & { action: 'create' | 'update' };
export type Run = (args: string[]) => Promise<{ status: number; stdout: string }>;

export declare const MANIFEST: string;
export declare function validate(manifest: unknown): Label[];
export declare function loadManifest(path?: string): Label[];
export declare function plan(manifest: Label[], existing: Label[]): LabelAction[];
export declare function gh(args: string[]): Promise<{ status: number; stdout: string }>;
export declare function listLabels(run: Run, repo?: string): Promise<Label[]>;
export declare function apply(options: {
  run?: Run;
  manifest: Label[];
  repo?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<LabelAction[]>;
export declare function main(argv: string[]): Promise<void>;
