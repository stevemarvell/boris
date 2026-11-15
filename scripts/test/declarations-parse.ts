// Name-only parsers for a script's runtime exports and its hand-written
// `.d.mts` declarations (#335). Source is parsed, never imported: several
// scripts run code or read project.json at import time.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '$1');
}

/** Names inside `export { a, b as c }`; a `type` entry is not a runtime name. */
function braceNames(list: string): string[] {
  const names: string[] = [];
  for (const raw of list.split(',')) {
    const entry = raw.trim();
    if (!entry || /^type\s/.test(entry)) continue;
    const parts = entry.split(/\s+as\s+/);
    names.push((parts[1] ?? parts[0] ?? '').trim());
  }
  return names;
}

function collect(src: string, declRe: RegExp): string[] {
  const text = stripComments(src);
  const names = new Set<string>();
  for (const m of text.matchAll(declRe)) if (m[1]) names.add(m[1]);
  for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const n of braceNames(m[1] ?? '')) names.add(n);
  }
  if (/^\s*export\s+default\b/m.test(text)) names.add('default');
  return [...names].sort();
}

/** Runtime export names of a `.mjs` source. */
export function runtimeExports(src: string): string[] {
  return collect(
    src,
    /^\s*export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s*([A-Za-z_$][\w$]*)/gm,
  );
}

/** Value export names a `.d.mts` declares; types and interfaces are skipped. */
export function declaredExports(src: string): string[] {
  return collect(
    src,
    /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s*([A-Za-z_$][\w$]*)/gm,
  );
}
