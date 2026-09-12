export declare const WEB_DIR: string;
export declare function writeApiUrl(
  env?: Record<string, string | undefined>,
  webDir?: string,
): { action: 'explicit' | 'mapped' | 'fallback'; url?: string };
