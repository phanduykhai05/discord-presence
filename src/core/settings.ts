/**
 * Read/merge/write ~/.claude/settings.json. Centralized so install and
 * uninstall agree on the marker convention and the merge shape.
 *
 * Our hook entries are tagged by the command containing the built entry file
 * name (`vdp.js`), so we can find and remove exactly our own entries without
 * touching anyone else's hooks.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { claudeDir, settingsPath } from './paths';

/** Substring that identifies one of our hook commands. */
export const HOOK_MARKER = 'vdp.js';

export interface HookCommand {
  type?: string;
  command?: string;
}

export interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

export interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

/** Claude Code event name -> the arg we pass to `vdp hook <arg>`. */
export const HOOK_EVENTS: ReadonlyArray<{ name: string; arg: string }> = [
  { name: 'SessionStart', arg: 'session-start' },
  { name: 'UserPromptSubmit', arg: 'user-prompt-submit' },
  { name: 'PreToolUse', arg: 'pre-tool-use' },
  { name: 'Notification', arg: 'notification' },
  { name: 'Stop', arg: 'stop' },
  { name: 'SessionEnd', arg: 'session-end' },
];

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = stripBom(await readFile(settingsPath(), 'utf8'));
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Settings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  const dest = settingsPath();
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(tmp, dest);
}

/** Back up non-empty settings before we touch them. Returns the backup path. */
export async function backupSettings(settings: Settings): Promise<string | null> {
  if (Object.keys(settings).length === 0) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${settingsPath()}.${ts}.bak`;
  await mkdir(claudeDir(), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

export function isOurEntry(entry: HookEntry): boolean {
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER));
}

export function buildEntry(entryPath: string, arg: string): HookEntry {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${entryPath}" hook ${arg}` }],
  };
}

/** Remove any prior entries of ours, then add fresh ones. Idempotent. */
export function mergeHooks(settings: Settings, entryPath: string): Settings {
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    const existing = (hooks[event.name] ?? []).filter((e) => !isOurEntry(e));
    existing.push(buildEntry(entryPath, event.arg));
    hooks[event.name] = existing;
  }
  return { ...settings, hooks };
}

/** Strip only our entries, leaving every other hook untouched. */
export function stripOurHooks(settings: Settings): { cleaned: Settings; removed: number } {
  const inHooks = settings.hooks;
  if (inHooks === undefined) return { cleaned: settings, removed: 0 };

  let removed = 0;
  const outHooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(inHooks)) {
    const kept = entries.filter((e) => {
      if (isOurEntry(e)) {
        removed++;
        return false;
      }
      return true;
    });
    if (kept.length > 0) outHooks[event] = kept;
  }

  const cleaned: Settings = { ...settings };
  if (Object.keys(outHooks).length > 0) cleaned.hooks = outHooks;
  else delete cleaned.hooks;

  return { cleaned, removed };
}
