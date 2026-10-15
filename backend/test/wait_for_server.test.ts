import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { waitForServer } from './wait_for_server';

test('readiness tolerates startup beyond the old four-second limit', async () => {
  const started = Date.now();
  const server = http.createServer((_req, res) => {
    res.writeHead(Date.now() - started >= 4200 ? 200 : 503).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const closed = once(child, 'close');
  try {
    await waitForServer(child, `http://127.0.0.1:${address.port}`);
    assert.ok(Date.now() - started >= 4200);
  } finally {
    child.kill();
    await closed;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('readiness reports an early server exit and its stderr', async () => {
  const child = spawn(process.execPath, ['-e', 'console.error("startup failed"); process.exit(1)']);
  const closed = once(child, 'close');
  try {
    await assert.rejects(waitForServer(child, 'http://127.0.0.1:0'), /Server exited.*1.*startup failed/s);
  } finally {
    child.kill();
    await closed;
  }
});
