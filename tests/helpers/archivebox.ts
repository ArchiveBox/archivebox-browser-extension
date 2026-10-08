import { test as base, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';

export type ArchiveBoxApi = { server: string; key: string; keyFile: string; api: (route: string, init?: RequestInit) => Promise<any> };

export const test = base.extend<{}, { archivebox: ArchiveBoxApi }>({
  archivebox: [async ({}, use) => {
    const configured = process.env.ARCHIVEBOX_TEST_SERVER;
    const keyFile = process.env.ARCHIVEBOX_TEST_KEY_FILE;
    if (configured && !keyFile) throw new Error('ARCHIVEBOX_TEST_KEY_FILE is required with ARCHIVEBOX_TEST_SERVER');
    const root = await mkdtemp(path.join(tmpdir(), 'archivebox-api-test-'));
    const collection = path.join(root, 'collection');
    await mkdir(collection);
    const runtime = process.env.ARCHIVEBOX_TEST_PROJECT
      ? ['run', '--project', process.env.ARCHIVEBOX_TEST_PROJECT]
      : ['run', '--no-project', '--with', 'archivebox==0.9.74rc34'];
    const run = promisify(execFile);
    let child: ReturnType<typeof spawn> | undefined;
    const log = await open(path.join(root, 'server.log'), 'a');
    try {
      let server = configured || '';
      if (!server) {
        const socket = createServer();
        await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
        const address = socket.address();
        if (!address || typeof address === 'string') throw new Error('Missing API port');
        await new Promise<void>(resolve => socket.close(() => resolve()));
        server = `http://localhost:${address.port}`;
      }
      const env = { ...process.env, BASE_URL: server, SERVER_SECURITY_MODE: 'safe-onedomain-nojsreplay' };
      if (!configured) {
        await run('uv', [...runtime, 'archivebox', 'init', '--quick'], { cwd: collection, env, maxBuffer: 10_000_000 });
        await run('uv', [...runtime, 'archivebox', 'manage', 'shell', '-c',
          "from archivebox.api.models import APIToken; from pathlib import Path; Path('test-api-key').write_text(APIToken.objects.create().token)"], { cwd: collection, env });
        child = spawn('uv', [...runtime, 'archivebox', 'manage', 'runserver', `127.0.0.1:${new URL(server).port}`, '--noreload'],
          { cwd: collection, env, detached: process.platform !== 'win32', stdio: ['ignore', log.fd, log.fd] });
      }
      const key = (await readFile(keyFile || path.join(collection, 'test-api-key'), 'utf8')).trim();
      const api = async (route: string, init: RequestInit = {}) => {
        const response = await fetch(server + route, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
        if (!response.ok) throw new Error(`ArchiveBox ${route}: HTTP ${response.status}`);
        return response.json();
      };
      await expect.poll(async () => {
        if (child?.exitCode != null) throw new Error(await readFile(path.join(root, 'server.log'), 'utf8'));
        return fetch(server + '/api/v1/core/snapshots?limit=1', { headers: { Authorization: `Bearer ${key}` } }).then(r => r.status).catch(() => 0);
      }, { timeout: 30000 }).toBe(200);
      await use({ server, key, keyFile: keyFile || path.join(collection, 'test-api-key'), api });
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
        if (process.platform === 'win32') child.kill(); else process.kill(-child.pid!, 'SIGTERM');
        await exited;
      }
      await log.close();
      await rm(root, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 180000 }],
});
