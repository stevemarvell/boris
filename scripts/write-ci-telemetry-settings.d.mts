export declare const REPO_ROOT: string;
export declare function assertClean(value: string, context: string): void;
export declare function ciTelemetryEnv(env?: Record<string, string | undefined>): Record<string, string>;
export declare function writeCiTelemetrySettings(
  env?: Record<string, string | undefined>,
  root?: string,
): { path: string; enabled: boolean };
