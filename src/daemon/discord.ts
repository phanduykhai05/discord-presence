/**
 * Thin wrapper around @xhayper/discord-rpc.
 *
 * Connects to the local Discord client over IPC, pushes activity, and stays a
 * graceful no-op whenever Discord isn't running. The rest of the daemon just
 * calls setActivity/clearActivity on a fixed cadence and never has to know
 * whether Discord is up — this class swallows connection failures and quietly
 * reconnects on the next call once Discord is back.
 */
import { Client, type SetActivity } from '@xhayper/discord-rpc';
import type { PresencePayload } from '../types';

/**
 * How long to wait for a connection handshake before giving up. Crucial: if
 * Discord is reachable but never completes the handshake (e.g. a bad app id),
 * the library's connect() can hang indefinitely — and since that pending await
 * may be the only thing on the event loop, the daemon would otherwise drain and
 * exit. This bounded timer both fails fast and keeps the loop alive.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/** Reject if `p` doesn't settle within `ms`. The timer keeps the loop alive. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function toSetActivity(p: PresencePayload): SetActivity {
  return {
    details: p.details,
    state: p.state,
    largeImageKey: p.largeImageKey,
    largeImageText: p.largeImageText,
    smallImageKey: p.smallImageKey,
    smallImageText: p.smallImageText,
    startTimestamp: p.startTimestamp,
    buttons: p.buttons,
    statusDisplayType: p.statusDisplayType,
  };
}

export class DiscordPresence {
  private client?: Client;
  private connected = false;
  private connecting = false;

  constructor(private readonly clientId: string) {}

  get isConnected(): boolean {
    return this.connected;
  }

  /** Ensure we have a live connection. Returns false (no-op) if Discord is down. */
  private async ensureClient(): Promise<boolean> {
    if (this.connected && this.client) return true;
    if (this.connecting) return false;
    if (!this.clientId) return false; // no application id configured yet
    this.connecting = true;

    // Tear down any stale client before reconnecting.
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore
      }
      this.client = undefined;
    }

    try {
      const client = new Client({ clientId: this.clientId, transport: { type: 'ipc' } });
      client.on('disconnected', () => {
        this.connected = false;
      });
      try {
        await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'discord connect');
      } catch (err) {
        // Tear down the half-open client so its socket/timers don't linger.
        try {
          await client.destroy();
        } catch {
          // ignore
        }
        throw err;
      }
      // The IPC transport doesn't keep a persistent 'error' listener on its
      // socket, so a later socket error (e.g. ECONNRESET when Discord quits)
      // would crash the process. Attach one; the next tick reconnects.
      const transportSocket = (
        client.transport as unknown as {
          socket?: { on(event: 'error', cb: (err: unknown) => void): void };
        }
      ).socket;
      transportSocket?.on('error', () => {
        this.connected = false;
      });
      this.client = client;
      this.connected = true;
      return true;
    } catch {
      this.connected = false; // Discord down / unreachable — try again next tick
      return false;
    } finally {
      this.connecting = false;
    }
  }

  async setActivity(payload: PresencePayload): Promise<void> {
    if (Object.keys(payload).length === 0) {
      await this.clearActivity();
      return;
    }
    if (!(await this.ensureClient())) return;
    try {
      await this.client?.user?.setActivity(toSetActivity(payload));
    } catch {
      this.connected = false; // force a reconnect on the next tick
    }
  }

  async clearActivity(): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      await this.client.user?.clearActivity();
    } catch {
      this.connected = false;
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.client?.destroy();
    } catch {
      // ignore
    }
    this.client = undefined;
    this.connected = false;
  }
}
