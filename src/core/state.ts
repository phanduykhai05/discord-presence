/**
 * Bridge state: the contract between hooks and the daemon.
 *
 * Each hook writes ONLY its own per-session marker file (sessions/<id>.json),
 * so concurrent hook processes never race on a shared file. The daemon is the
 * single reader/aggregator. Writes are synchronous (hooks must be fast) and
 * atomic (temp-then-rename) so a reader never sees a half-written file.
 *
 * Markers with a stale heartbeat are treated as dead sessions — this is how we
 * survive a Claude Code crash where SessionEnd never fired.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from './paths';
import type { AggregatedState, SessionMarker } from '../types';

/** A session is considered dead (excluded from the presence) past this. */
export const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * Past this, a marker is definitively abandoned (no SessionEnd ever fired) and is
 * deleted from disk so orphans don't accumulate. Well beyond STALE_AFTER_MS so a
 * briefly-idle-but-live session is never pruned out from under itself.
 */
export const PRUNE_AFTER_MS = 60 * 60 * 1000;

function markerPath(id: string): string {
  return join(sessionsDir(), `${id}.json`);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Atomic synchronous write of one marker. */
export function writeSessionMarker(marker: SessionMarker): void {
  const dir = sessionsDir();
  mkdirSync(dir, { recursive: true });
  const dest = markerPath(marker.id);
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(marker));
  renameSync(tmp, dest);
}

/** Read one marker, or null if missing/corrupt. */
export function readSessionMarker(id: string): SessionMarker | null {
  try {
    const raw = stripBom(readFileSync(markerPath(id), 'utf8'));
    return JSON.parse(raw) as SessionMarker;
  } catch {
    return null;
  }
}

/**
 * Merge a partial update into a session's marker, always refreshing the
 * heartbeat. Creates the marker if it doesn't exist yet.
 */
export function updateSessionMarker(id: string, patch: Partial<SessionMarker>, now: number): void {
  const existing = readSessionMarker(id);
  const merged: SessionMarker = {
    id,
    startedAt: existing?.startedAt ?? now,
    ...existing,
    ...patch,
    heartbeat: now,
  };
  writeSessionMarker(merged);
}

export function removeSessionMarker(id: string): void {
  try {
    rmSync(markerPath(id));
  } catch {
    // already gone — fine
  }
}

/** Read every marker on disk (corrupt ones skipped). */
export function readMarkers(): SessionMarker[] {
  let files: string[];
  try {
    files = readdirSync(sessionsDir());
  } catch {
    return [];
  }
  const out: SessionMarker[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const m = readSessionMarker(f.slice(0, -5));
    if (m) out.push(m);
  }
  return out;
}

/**
 * Merge the live markers (fresh heartbeat) into a single view for the daemon.
 * The "current" session is the one with the most recent heartbeat — its
 * activity drives the presence. Returns null when no session is live.
 */
export function aggregate(
  markers: SessionMarker[],
  now: number,
  staleAfterMs = STALE_AFTER_MS,
): AggregatedState | null {
  const live = markers.filter((m) => now - m.heartbeat <= staleAfterMs);
  if (live.length === 0) return null;

  const current = live.reduce((a, b) => (b.heartbeat > a.heartbeat ? b : a));
  const startedAt = live.reduce((min, m) => Math.min(min, m.startedAt), Infinity);

  return {
    sessionCount: live.length,
    startedAt,
    transcriptPath: current.transcriptPath,
    project: current.project,
    branch: current.branch,
    model: current.model,
    state: current.state,
    activity: current.activity,
    file: current.file,
    tokens: current.tokens,
    cost: current.cost,
  };
}
