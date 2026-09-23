export declare const REPO_ROOT: string;
export declare const DOCS_DIR: string;
export declare const MARKDOWN_PAGES: { slug: string; source: string; blurb: string }[];
export declare function apiBaseUrl(
  env?: Record<string, string | undefined>,
  root?: string,
): string;
export declare function page(options: {
  title: string;
  body: string;
  crumbs?: boolean;
}): string;
export declare function indexPage(
  apiUrl: string,
  rendered?: { slug: string; title: string; blurb: string }[],
): string;
export declare function buildDocs(options?: {
  root?: string;
  out?: string;
  env?: Record<string, string | undefined>;
}): { out: string; apiUrl: string; written: string[] };
