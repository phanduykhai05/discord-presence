/**
 * `vdp stop`
 *
 * Stops the running daemon (clears the Discord card). Leaves hooks, config, and
 * data intact. Note: while you keep using Claude Code, the next hook event will
 * lazily respawn the daemon — to keep presence off for good, run `vdp uninstall`.
 */
import { stopDaemon } from '../core/daemon-state';
import { ui } from '../ui';

export async function stop(_args: string[] = []): Promise<void> {
  const pid = await stopDaemon();
  if (pid) {
    console.log(`${ui.check} ${ui.bold('daemon stopped')} ${ui.dim(`(pid ${pid})`)}`);
  } else {
    console.log(ui.dim('daemon not running'));
  }
}
