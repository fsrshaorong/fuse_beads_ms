import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { SqliteWorkshopStore } from '../server/SqliteStore';
import { startWorkshopServer } from '../server/server';
import { MultiplayerClient } from '../src/Networking/MultiplayerClient';
import type { RoomCommand } from '../shared/MultiplayerProtocol';

test('a transaction failing after the room update rolls back the room, receipt and artwork together', async () =>
{
    const store = new SqliteWorkshopStore(':memory:');
    const server = await startWorkshopServer({ store, port: 0 });
    const client = new MultiplayerClient(server.url);
    try
    {
        await client.connect();
        const opId = randomUUID();
        const snapshot = await client.create({ opId, name: '原来的房间' });
        const before = store.room(snapshot.roomId)!;
        const modified = structuredClone(before);
        modified.name = '不可提交的改动';
        modified.work.cells[0] = 1;
        modified.version += 100;
        // The duplicate primary key fails after saveRoom and the work upsert have run inside BEGIN.
        assert.throws(() => store.commit(modified, client.session!.playerId, opId, {
            fingerprint: 'collision', receipt: { roomId: modified.id }
        }), /UNIQUE/);
        assert.deepEqual(store.room(snapshot.roomId), before);
        assert.notEqual(store.operation(client.session!.playerId, opId)!.fingerprint, 'collision');
        assert.deepEqual(store.collection(client.session!.playerId), []);
    }
    finally
    {
        client.close();
        await server.close();
    }
});

test('an acknowledged edit survives abrupt backend process termination and remains idempotent', async (t) =>
{
    const directory = await mkdtemp(join(tmpdir(), 'beads-crash-'));
    const databasePath = join(directory, 'crash.sqlite');
    const harness = resolve('scripts/multiplayer-crash-worker.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', harness], {
        windowsHide: true, env: { ...process.env, MULTIPLAYER_DB: databasePath }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let diagnostic = '';
    child.stderr.on('data', (data: Buffer) => { diagnostic += data.toString(); });
    const exited = once(child, 'exit');
    const url = await new Promise<string>((resolveUrl, reject) =>
    {
        const timer = setTimeout(() => reject(new Error(`backend startup timed out: ${diagnostic}`)), 10000);
        let output = '';
        child.stdout.on('data', (data: Buffer) =>
        {
            output += data.toString();
            const match = output.match(/BACKEND_URL=(http:\/\/127\.0\.0\.1:\d+)/);
            if (match !== null)
            {
                clearTimeout(timer);
                resolveUrl(match[1]);
            }
        });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(new Error(`backend exited: ${diagnostic}`)); });
    });
    const client = new MultiplayerClient(url);
    let restarted: Awaited<ReturnType<typeof startWorkshopServer>> | null = null;
    let restored: MultiplayerClient | null = null;
    t.after(async () =>
    {
        client.close();
        restored?.close();
        if (child.exitCode === null && child.signalCode === null)
        {
            child.kill('SIGKILL');
        }
        await exited;
        await restarted?.close();
        await rm(directory, { recursive: true, force: true });
    });
    await client.connect();
    const snapshot = await client.create({ opId: randomUUID(), name: '进程退出恢复测试' });
    await client.seat(0);
    const index = snapshot.pattern.targetNumbers.findIndex(Boolean);
    const command: RoomCommand = { type: 'paint', opId: randomUUID(), roomId: snapshot.roomId,
        workId: snapshot.work.id, strokeId: randomUUID(), edits: [{ index, color: 2, expectedVersion: 0 }] };
    await client.command(command);
    const token = client.session!.token;
    // Kill only the child created above, without allowing disconnect hooks or graceful shutdown to save.
    child.kill('SIGKILL');
    await exited;
    client.close();
    restarted = await startWorkshopServer({ databasePath, port: 0 });
    restored = new MultiplayerClient(restarted.url, { token });
    await restored.connect();
    const recovered = await restored.join(snapshot.roomId);
    assert.equal(recovered.work.cells[index], 2);
    assert.equal(recovered.work.id, snapshot.work.id);
    assert.equal((await restored.command(command)).duplicate, true);
});
