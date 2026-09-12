export declare const WEB_DIR: string;
export declare function prApiUrl(pullRequest: string | number, template?: string): string;
export declare function writeApiUrl(
  env?: Record<string, string | undefined>,
  webDir?: string,
): { action: 'explicit' | 'pr' | 'mapped' | 'fallback'; url?: string };
