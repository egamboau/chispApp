import type { ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

export async function waitForServer(child: ChildProcess, url: string): Promise<void> {
  let logs = '', spawnError: Error | undefined;
  const append = (chunk: Buffer) => { logs += chunk; };
  const onError = (error: Error) => { spawnError = error; };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('error', onError);
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server exited before becoming ready (${spawnError?.message ?? child.signalCode ?? child.exitCode}): ${logs}`);
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {}
      await setTimeout(100);
    }
    throw new Error(`Server did not become ready within 30 seconds: ${logs}`);
  } finally {
    child.stdout?.off('data', append);
    child.stderr?.off('data', append);
    child.off('error', onError);
  }
}
