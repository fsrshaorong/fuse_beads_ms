import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { startWorkshopServer } from '../server/server';
import { SqliteWorkshopStore } from '../server/SqliteStore';
import type { StoredOperation } from '../server/SqliteStore';
import type { RoomState } from '../src/Core/Multiplayer/RoomState';
import type { CollectedArtwork, RoomCommand } from '../shared/MultiplayerProtocol';
import { MultiplayerClient } from '../src/Networking/MultiplayerClient';

type Action = RoomCommand extends infer Command ? Command extends RoomCommand
    ? Omit<Command, 'opId' | 'roomId' | 'workId'> : never : never;

async function fixture(t: TestContext, count = 2)
{
    const directory = await mkdtemp(join(tmpdir(), 'beads-multiplayer-'));
    const path = join(directory, 'test.sqlite');
    let now = Date.now();
    const errors: unknown[] = [];
    let server = await startWorkshopServer({ databasePath: path, port: 0, now: () => now,
        automaticTick: false, onError: (error) => errors.push(error) });
    const clients: MultiplayerClient[] = [];
    t.after(async () =>
    {
        clients.forEach((client) => client.close());
        await server.close();
        // This path is created by mkdtemp inside the OS temp directory, never a user workspace.
        await rm(directory, { recursive: true, force: true });
        assert.deepEqual(errors, [], 'no unhandled server errors');
    });
    async function connect(token?: string): Promise<MultiplayerClient>
    {
        const client = new MultiplayerClient(server.url, token === undefined ? { nickname: `玩家${clients.length + 1}` } : { token });
        clients.push(client);
        await client.connect();
        return client;
    }
    for (let index = 0; index < count; index += 1)
    {
        await connect();
    }
    const room = await clients[0].create({ opId: randomUUID(), name: '四人手作测试' });
    for (const client of clients.slice(1, 4))
    {
        await client.join(room.roomId);
    }
    function advance(milliseconds: number): void
    {
        now += milliseconds;
        server.service.tick();
    }
    async function walk(client: MultiplayerClient, x: number, z: number, steps: number): Promise<void>
    {
        for (let step = 0; step < steps; step += 1)
        {
            await client.input({ sequence: sequence++, directionX: x, directionZ: z, selectedColor: 1, cursor: null });
            advance(100);
        }
        await client.input({ sequence: sequence++, directionX: 0, directionZ: 0, selectedColor: 1, cursor: null });
        await client.refresh();
    }
    async function sit(client: MultiplayerClient, seat: number): Promise<void>
    {
        if (seat === 1)
        {
            await walk(client, 1, 0, 10);
            await walk(client, 0, -1, 12);
        }
        else if (seat === 3)
        {
            await walk(client, -1, 0, 10);
            await walk(client, 0, -1, 12);
        }
        else if (seat === 2)
        {
            await walk(client, 1, 0, 10);
            await walk(client, 0, -1, 22);
            await walk(client, -1, 0, 10);
        }
        await client.seat(seat);
    }
    return { clients, room, path, connect, walk, sit, advance, server: () => server,
        restart: async () =>
        {
            clients.forEach((client) => client.close());
            await server.close();
            server = await startWorkshopServer({ databasePath: path, port: 0, now: () => now,
                automaticTick: false, onError: (error) => errors.push(error) });
        }
    };
}

let sequence = 0;
function request(client: MultiplayerClient, action: Action): RoomCommand
{
    return { ...action, opId: randomUUID(), roomId: client.snapshot!.roomId, workId: client.snapshot!.work.id } as RoomCommand;
}
async function act(client: MultiplayerClient, action: Action)
{
    return client.command(request(client, action));
}
async function paint(client: MultiplayerClient, index: number, color: number, strokeId = randomUUID())
{
    return act(client, { type: 'paint', strokeId, edits: [{ index, color, expectedVersion: client.snapshot!.work.cellVersions[index] }] });
}
function occupied(client: MultiplayerClient): number[]
{
    return client.snapshot!.pattern.targetNumbers.flatMap((color, index) => color > 0 ? [index] : []);
}
async function until(condition: () => boolean): Promise<void>
{
    const deadline = Date.now() + 3000;
    while (!condition())
    {
        assert.ok(Date.now() < deadline, 'condition completed before timeout');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

test('four real WebSocket clients share a room, enforce capacity, identity, seats and room isolation', async (t) =>
{
    const f = await fixture(t, 5);
    const [a, b, c, d, outsider] = f.clients;
    assert.equal((await a.refresh()).players.length, 4);
    await assert.rejects(outsider.join(f.room.roomId), /room-full/);
    await assert.rejects(paint(a, occupied(a)[0], 1), /seat-required/);
    await f.sit(a, 0);
    await assert.rejects(b.seat(0), /seat-occupied/);
    await assert.rejects(c.seat(2), /seat-out-of-range/);
    await f.sit(b, 1);
    await f.sit(c, 3);
    await f.sit(d, 2);
    const indices = occupied(a).slice(0, 4);
    await Promise.all([a, b, c, d].map((client, index) => paint(client, indices[index], 1)));
    const snapshots = await Promise.all([a, b, c, d].map((client) => client.refresh()));
    snapshots.forEach((snapshot) => assert.deepEqual(snapshot.work.cells, snapshots[0].work.cells));
    assert.equal(snapshots[0].work.contributors.length, 4);
    await outsider.create({ opId: randomUUID(), name: '隔离房间' });
    await assert.rejects(outsider.command(request(a, { type: 'undo' })), /wrong-room/);
    assert.ok(outsider.snapshot!.work.cells.every((color) => color === 0));
    const token = a.session!.token;
    const replacement = await f.connect(token);
    await until(() => !a.ready);
    assert.equal(replacement.session!.playerId, a.session!.playerId);
    await replacement.join(f.room.roomId);
    assert.equal(replacement.snapshot!.players.length, 4);
    await d.leave();
    await outsider.join(f.room.roomId);
    assert.equal(outsider.snapshot!.players.length, 4);
});

test('concurrent cell edits converge, lost acknowledgements deduplicate, and changed payloads cannot reuse an operation ID', async (t) =>
{
    const f = await fixture(t);
    const [a, b] = f.clients;
    await f.sit(a, 0);
    await f.sit(b, 1);
    const index = occupied(a)[0];
    const ca = request(a, { type: 'paint', strokeId: randomUUID(), edits: [{ index, color: 1, expectedVersion: 0 }] });
    const cb = request(b, { type: 'paint', strokeId: randomUUID(), edits: [{ index, color: 2, expectedVersion: 0 }] });
    const receipts = await Promise.all([a.command(ca), b.command(cb)]);
    assert.equal(receipts.filter((receipt) => receipt.skippedIndices.length === 0).length, 1);
    assert.equal(receipts.filter((receipt) => receipt.skippedIndices.includes(index)).length, 1);
    assert.deepEqual((await a.refresh()).work, (await b.refresh()).work);
    const second = occupied(a)[1];
    const lostAck = request(a, { type: 'paint', strokeId: randomUUID(), edits: [{ index: second, color: 2, expectedVersion: 0 }] });
    a.socket.emit('room:command', lostAck, () => {});
    await until(() => a.snapshot!.work.cells[second] === 2);
    const version = a.snapshot!.version;
    assert.equal((await a.command(lostAck)).duplicate, true);
    assert.equal((await a.refresh()).version, version);
    await assert.rejects(a.command({ ...lostAck, type: 'undo' } as RoomCommand), /invalid-request|op-id-reused/);
    await assert.rejects(a.command({ ...lostAck, edits: [{ index: second, color: 3, expectedVersion: 0 }] } as RoomCommand), /op-id-reused/);
});

test('personal stroke undo and redo skip collaborator edits and preserve independent colors', async (t) =>
{
    const f = await fixture(t);
    const [a, b] = f.clients;
    await f.sit(a, 0);
    await f.sit(b, 1);
    const [one, two] = occupied(a);
    const stroke = randomUUID();
    await paint(a, one, 1, stroke);
    await paint(a, two, 1, stroke);
    await act(a, { type: 'endStroke' });
    await b.refresh();
    await paint(b, two, 2);
    const undo = await act(a, { type: 'undo' });
    assert.deepEqual(undo.skippedIndices, [two]);
    assert.equal(a.snapshot!.work.cells[one], 0);
    assert.equal(a.snapshot!.work.cells[two], 2);
    await act(a, { type: 'redo' });
    assert.equal(a.snapshot!.work.cells[one], 1);
    assert.equal(a.snapshot!.work.cells[two], 2);
    assert.deepEqual((await a.refresh()).work.cells, (await b.refresh()).work.cells);
});

test('server time controls movement, stale input stops, and disconnect reservations expire', async (t) =>
{
    const f = await fixture(t);
    const [a, b] = f.clients;
    const before = (await a.refresh()).players.find((player) => player.playerId === a.session!.playerId)!;
    await a.input({ sequence: 10, directionX: 1, directionZ: 1, selectedColor: 1, cursor: null });
    f.advance(100);
    const after = (await a.refresh()).players.find((player) => player.playerId === a.session!.playerId)!;
    assert.ok(Math.abs(Math.hypot(after.x - before.x, after.z - before.z) - 0.2) < 0.00001);
    await a.input({ sequence: 9, directionX: -1, directionZ: 0, selectedColor: 1, cursor: null });
    f.advance(1000);
    const stopped = (await a.refresh()).players.find((player) => player.playerId === a.session!.playerId)!;
    assert.equal(stopped.x, after.x);
    assert.equal(stopped.z, after.z);
    await assert.rejects(a.input({ sequence: 11, directionX: 1, directionZ: 0, selectedColor: 1, cursor: null,
        deltaSeconds: 10000 } as never), /invalid-request/);
    b.close();
    await until(() => a.snapshot!.players.some((player) => player.playerId === b.session!.playerId && !player.connected));
    f.advance(61000);
    assert.equal((await a.refresh()).players.length, 1);
});

test('clients recover from a dropped patch and transport interruption using a fresh authoritative snapshot', async (t) =>
{
    const f = await fixture(t);
    const [a, b] = f.clients;
    await f.sit(a, 0);
    await f.sit(b, 1);
    const [one, two, three] = occupied(a);
    const listener = b.socket.listeners('room:patch')[0];
    b.socket.off('room:patch', listener);
    await paint(a, one, 1);
    b.socket.on('room:patch', listener);
    await paint(a, two, 2);
    await until(() => b.snapshot!.work.cells[one] === 1 && b.snapshot!.work.cells[two] === 2);
    b.socket.io.engine.close();
    await until(() => !b.ready);
    await assert.rejects(async () => paint(b, three, 3), /not-connected/);
    await paint(a, three, 3);
    await until(() => b.ready && b.snapshot!.work.cells[three] === 3);
    assert.deepEqual((await a.refresh()).work.cells, (await b.refresh()).work.cells);
});

test('pattern switching needs unanimous consent and old work IDs cannot modify the new draft', async (t) =>
{
    const f = await fixture(t);
    const [a, b] = f.clients;
    await f.sit(a, 0);
    const old = request(a, { type: 'paint', strokeId: randomUUID(), edits: [{ index: occupied(a)[0], color: 1, expectedVersion: 0 }] });
    await assert.rejects(act(b, { type: 'proposePattern', patternId: a.snapshot!.pattern.patternId }), /host-only/);
    await assert.rejects(act(a, { type: 'proposePattern', patternId: 'starter-heart' }), /pattern-retired/);
    await act(a, { type: 'proposePattern', patternId: a.snapshot!.pattern.patternId });
    await assert.rejects(a.command(old), /proposal-pending/);
    await b.refresh();
    await act(b, { type: 'votePattern', proposalId: b.snapshot!.proposal!.id, approve: false });
    assert.equal((await a.refresh()).proposal, null);
    await a.command(old);
    const delayed = { ...old, opId: randomUUID() };
    await act(a, { type: 'proposePattern', patternId: a.snapshot!.pattern.patternId });
    await b.refresh();
    await act(b, { type: 'votePattern', proposalId: b.snapshot!.proposal!.id, approve: true });
    await a.refresh();
    assert.notEqual(a.snapshot!.work.id, old.workId);
    await assert.rejects(a.command(delayed), /stale-work/);
    assert.ok(a.snapshot!.work.cells.every((color) => color === 0));
    const drafts = await a.drafts();
    assert.ok(drafts.some((draft) => draft.id === old.workId && draft.placedCells === 1));
    await act(a, { type: 'proposeDraft', draftId: old.workId });
    await b.refresh();
    await act(b, { type: 'votePattern', proposalId: b.snapshot!.proposal!.id, approve: true });
    await a.refresh();
    assert.equal(a.snapshot!.work.cells.filter(Boolean).length, 1);
    assert.notEqual(a.snapshot!.work.id, old.workId);
    await assert.rejects(a.command(delayed), /stale-work/);
});

test('two clients complete all 1159 Mini beads, transfer the iron, persist coverage and collect exactly one shared artwork across restart', async (t) =>
{
    const f = await fixture(t);
    let [a, b] = f.clients;
    await f.sit(a, 0);
    await f.sit(b, 1);
    const indices = occupied(a);
    assert.equal(indices.length, 1159);
    await assert.rejects(act(a, { type: 'acquireIron' }), /work-not-ready/);
    for (let offset = 0; offset < indices.length; offset += 128)
    {
        const client = offset % 256 === 0 ? a : b;
        await client.refresh();
        await act(client, { type: 'paint', strokeId: randomUUID(), edits: indices.slice(offset, offset + 128).map((index) => ({
            index, color: client.snapshot!.pattern.targetNumbers[index], expectedVersion: 0
        })) });
    }
    assert.equal((await a.refresh()).work.stage, 'ready');
    await act(a, { type: 'acquireIron' });
    const firstToken = a.snapshot!.ironLease!.token;
    await assert.rejects(act(b, { type: 'acquireIron' }), /iron-busy/);
    await act(a, { type: 'iron', leaseToken: firstToken, indices: indices.slice(0, 128) });
    await assert.rejects(act(a, { type: 'undo' }), /work-read-only/);
    f.advance(5001);
    await act(b, { type: 'acquireIron' });
    await assert.rejects(act(a, { type: 'iron', leaseToken: firstToken, indices: [indices[128]] }), /iron-lease-expired/);
    await act(b, { type: 'iron', leaseToken: b.snapshot!.ironLease!.token, indices: indices.slice(128, 256) });
    const tokenA = a.session!.token, tokenB = b.session!.token;
    await f.restart();
    a = await f.connect(tokenA);
    b = await f.connect(tokenB);
    await a.join(f.room.roomId);
    await b.join(f.room.roomId);
    assert.equal(a.snapshot!.work.coverage.filter(Boolean).length, 256);
    assert.equal(a.snapshot!.ironLease, null);
    await f.sit(a, 0);
    await f.sit(b, 1);
    await act(b, { type: 'acquireIron' });
    let finalCommand: RoomCommand | null = null;
    for (let offset = 256; offset < indices.length; offset += 128)
    {
        finalCommand = request(b, { type: 'iron', leaseToken: b.snapshot!.ironLease!.token, indices: indices.slice(offset, offset + 128) });
        await b.command(finalCommand);
    }
    assert.equal((await a.refresh()).work.stage, 'finished');
    assert.equal((await b.command(finalCommand!)).duplicate, true);
    const collectionA = await a.collection(), collectionB = await b.collection();
    assert.equal(collectionA.length, 1);
    assert.deepEqual(collectionA, collectionB);
    assert.equal(collectionA[0].contributors.length, 2);
    assert.equal(collectionA[0].cells.filter(Boolean).length, 1159);
    await f.restart();
    b = await f.connect(tokenB);
    await b.join(f.room.roomId);
    assert.equal((await b.command(finalCommand!)).duplicate, true);
    assert.deepEqual(await b.collection(), collectionA);
});

test('storage failures never publish or acknowledge an uncommitted edit', async (t) =>
{
    class FailingStore extends SqliteWorkshopStore
    {
        public fail = false;
        public override commit(room: RoomState, actor: string, opId: string, operation: StoredOperation, artwork?: CollectedArtwork): void
        {
            if (this.fail)
            {
                throw new Error('simulated-disk-failure');
            }
            super.commit(room, actor, opId, operation, artwork);
        }
    }
    const store = new FailingStore(':memory:');
    const errors: unknown[] = [];
    const server = await startWorkshopServer({ store, port: 0, onError: (error) => errors.push(error) });
    const a = new MultiplayerClient(server.url);
    t.after(async () => { a.close(); await server.close(); });
    await a.connect();
    await a.create({ opId: randomUUID(), name: '事务失败测试' });
    await a.seat(0);
    const before = structuredClone(a.snapshot!);
    const command = request(a, { type: 'paint', strokeId: randomUUID(), edits: [{ index: occupied(a)[0], color: 1, expectedVersion: 0 }] });
    store.fail = true;
    await assert.rejects(a.command(command), /storage-unavailable/);
    const after = await a.refresh();
    assert.equal(after.version, before.version);
    assert.deepEqual(after.work, before.work);
    store.fail = false;
    assert.equal((await a.command(command)).duplicate, false);
    assert.equal(errors.length, 1);
});

test('protocol rejects malformed payloads, invalid credentials and foreign browser origins', async (t) =>
{
    const f = await fixture(t, 1);
    const a = f.clients[0];
    await f.sit(a, 0);
    const index = occupied(a)[0];
    await assert.rejects(a.command(request(a, { type: 'paint', strokeId: randomUUID(), edits: [{ index, color: 99, expectedVersion: 0 }] })), /invalid-request/);
    const empty = a.snapshot!.pattern.targetNumbers.findIndex((color) => color === 0);
    await assert.rejects(paint(a, empty, 1), /invalid-cell/);
    await assert.rejects(a.command(request(a, { type: 'paint', strokeId: randomUUID(), edits: [
        { index, color: 1, expectedVersion: 0 }, { index, color: 2, expectedVersion: 0 }
    ] })), /duplicate-cell/);
    const invalid = new MultiplayerClient(f.server().url, { token: 'x'.repeat(43) });
    t.after(() => invalid.close());
    await assert.rejects(invalid.connect(), /invalid-session/);
    const origin = new MultiplayerClient(f.server().url);
    origin.socket.io.opts.extraHeaders = { Origin: 'https://untrusted.example' };
    origin.socket.io.reconnection(false);
    t.after(() => origin.close());
    await assert.rejects(origin.connect(), /websocket error/);
});
