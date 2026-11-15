// Copy a repository's committed telemetry settings into the *user* settings
// file, so a Claude Code cloud session with several repositories reports too.
//
// Such a session opens in the directory above the checkouts, so no repository's
// `.claude/settings.json` is loaded and nothing is sent. The user file
// (`~/.claude/settings.json`) is read wherever the session starts. The cloud
// environment's setup script runs this once, as root, after the repositories
// are cloned and before Claude starts (telemetry/README.md).
//
// Only `CLAUDE_CODE_ENABLE_TELEMETRY` and `OTEL_*` keys are copied, and never
// `*_HEADERS`: the committed settings hold the endpoint and protocol only, and
// the credential is the cloud environment's network secret. Every other key
// already in the user file is kept. The file is replaced by a rename, so a
// failure part-way leaves the old one; invalid JSON in either file stops the
// script before anything is written.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The keys that may travel: telemetry switches, never a header (a credential). */
export function isTelemetryKey(key) {
  if (/(^|_)HEADERS$/.test(key)) return false;
  return key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key.startsWith('OTEL_');
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readJsonObject(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`${what} ${path} is unreadable: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} ${path} is not valid JSON: ${error.message}`);
  }
  if (!isObject(value)) throw new Error(`${what} ${path} must be a JSON object`);
  return value;
}

/** The telemetry entries of a repository's committed settings. */
export function repoTelemetryEnv(repoDir) {
  const path = join(repoDir, '.claude', 'settings.json');
  const settings = readJsonObject(path, 'Repository settings');
  if (settings === undefined) throw new Error(`Repository settings ${path} not found`);
  if (!isObject(settings.env)) throw new Error(`Repository settings ${path} has no "env" object`);
  const picked = {};
  for (const [key, value] of Object.entries(settings.env)) {
    if (!isTelemetryKey(key)) continue;
    if (typeof value !== 'string') {
      throw new Error(`Repository settings ${path}: ${key} must be a string`);
    }
    picked[key] = value;
  }
  if (Object.keys(picked).length === 0) {
    throw new Error(`Repository settings ${path} has no telemetry keys in "env"`);
  }
  return picked;
}

export function defaultUserSettingsPath(env = process.env) {
  return join(env.HOME || homedir(), '.claude', 'settings.json');
}

export function writeUserTelemetrySettings(repoDir, userPath = defaultUserSettingsPath()) {
  const telemetry = repoTelemetryEnv(repoDir);
  const existing = readJsonObject(userPath, 'User settings') ?? {};
  if (existing.env !== undefined && !isObject(existing.env)) {
    throw new Error(`User settings ${userPath} has an "env" that is not an object`);
  }
  const merged = { ...existing, env: { ...(existing.env ?? {}), ...telemetry } };
  mkdirSync(dirname(userPath), { recursive: true });
  const temp = `${userPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`);
  renameSync(temp, userPath);
  return { path: userPath, keys: Object.keys(telemetry) };
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), user: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--repo' || flag === '--user-settings') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${flag} needs a value`);
      options[flag === '--repo' ? 'repo' : 'user'] = value;
      i += 1;
    } else {
      throw new Error(
        `Unknown argument ${flag}. Usage: user-telemetry-settings.mjs [--repo <dir>] [--user-settings <file>]`,
      );
    }
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { repo, user } = parseArgs(process.argv.slice(2));
    const { path, keys } = writeUserTelemetrySettings(resolve(repo), user ? resolve(user) : undefined);
    console.log(`Wrote ${keys.length} telemetry settings to ${path}.`);
  } catch (error) {
    console.error(`user-telemetry-settings: ${error.message}`);
    process.exit(1);
  }
}
