/**
 * Daemon liveness primitives: the singleton lockfile and a small status file.
 *
 * Kept separate from the daemon itself (and free of the Discord dependency) so
 * `vdp status` can read daemon health without pulling in the RPC library.
 *
 * The lock holds the daemon's pid. Acquisition is atomic via exclusive create
 * (`wx`); if the existing lock points at a dead pid it's treated as stale and
 * taken over — this is how we recover after a crash where the lock outlived the
 * process.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { entryPath, lockPath, presenceDir, statePath } from './paths';

export interface LockInfo {
  pid: number;
  startedAt: number;
}

export interface DaemonStatus {
  pid: number;
  connected: boolean;
  sessionCount: number;
  activity?: string;
  updatedAt: number;
}

/** A daemon status older than this is treated as stale (daemon likely gone). */
export const DAEMON_STATUS_STALE_MS = 60 * 1000;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLock(): LockInfo | null {
  try {
    return JSON.parse(stripBom(readFileSync(lockPath(), 'utf8'))) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Try to become the one daemon. Returns true on success. Fails (returns false)
 * only when another live daemon already holds the lock.
 */
export function acquireLock(now: number): boolean {
  mkdirSync(presenceDir(), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, startedAt: now } satisfies LockInfo);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(), payload, { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
      const existing = readLock();
      if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
        return false; // another live daemon owns it
      }
      // Stale (or ours) — clear it and retry the exclusive create.
      try {
        rmSync(lockPath());
      } catch {
        // someone else may have just cleared it; the retry settles the race
      }
    }
  }
  return false;
}

/** Release the lock, but only if we still own it. */
export function releaseLock(): void {
  const existing = readLock();
  if (existing && existing.pid === process.pid) {
    try {
      rmSync(lockPath());
    } catch {
      // already gone — fine
    }
  }
}

export function writeDaemonStatus(status: DaemonStatus): void {
  try {
    mkdirSync(presenceDir(), { recursive: true });
    const dest = statePath();
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(status));
    renameSync(tmp, dest);
  } catch {
    // status file is best-effort telemetry; never fatal
  }
}

export function readDaemonStatus(): DaemonStatus | null {
  try {
    return JSON.parse(stripBom(readFileSync(statePath(), 'utf8'))) as DaemonStatus;
  } catch {
    return null;
  }
}

export function clearDaemonStatus(): void {
  try {
    rmSync(statePath());
  } catch {
    // already gone — fine
  }
}

/** Resolve after the pid is gone, or after `timeoutMs`. Returns true if it died. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const step = 100;
  for (let waited = 0; waited < timeoutMs; waited += step) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return !isProcessAlive(pid);
}

/**
 * Stop the running daemon, if any. Sends SIGTERM (graceful on POSIX — the daemon
 * clears its presence and releases its lock; on Windows this terminates it, and
 * Discord clears the presence when the socket closes). Waits for it to exit so a
 * follow-up spawn/delete can't race a still-living daemon. Returns the stopped
 * pid, or null if none was running.
 */
export async function stopDaemon(timeoutMs = 2000): Promise<number | null> {
  const lock = readLock();
  if (!lock || !isProcessAlive(lock.pid)) return null;
  try {
    process.kill(lock.pid, 'SIGTERM');
  } catch {
    return null; // already gone, or not ours to signal
  }
  await waitForExit(lock.pid, timeoutMs);
  return lock.pid;
}

/** Spawn a detached daemon from the built entry. Best-effort, never throws. */
export function spawnDaemon(): void {
  try {
    const child = spawn(process.execPath, [entryPath(), 'daemon'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true, // don't flash a console window on Windows
    });
    child.unref();
  } catch {
    // spawn is best-effort
  }
}
