import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { startWorkshopServer } from '../server/server';
import { MultiplayerClient } from '../src/Networking/MultiplayerClient';
import { OnlineWorkshopApplication } from '../src/App/OnlineWorkshopApplication';
import type { RoomCommand } from '../shared/MultiplayerProtocol';

async function waitFor(predicate: () => boolean): Promise<void>
{
    const deadline = Date.now() + 5000;
    while (!predicate())
    {
        assert.ok(Date.now() < deadline, 'online state settled');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function setup(t: TestContext)
{
    const server = await startWorkshopServer({ port: 0, databasePath: ':memory:' });
    const client = new MultiplayerClient(server.url);
    await client.connect();
    await client.create({ opId: randomUUID(), name: '应用接入测试' });
    const app = new OnlineWorkshopApplication(client);
    t.after(async () => { app.dispose(); await server.close(); });
    app.dispatch({ type: 'sit' });
    await waitFor(() => app.getReadModel().mode === 'transition');
    app.dispatch({ type: 'tick', deltaSeconds: 2 });
    assert.equal(app.getReadModel().mode, 'tabletop');
    app.dispatch({ type: 'focus' });
    app.dispatch({ type: 'tick', deltaSeconds: 2 });
    const pattern = app.getReadModel().pattern;
    const first = pattern.targetNumbers.findIndex((target, index) => target !== 0 && index % pattern.width < pattern.width - 6
        && pattern.targetNumbers.slice(index, index + 6).every(Boolean));
    assert.ok(first >= 0);
    return { app, client, first, pattern, server };
}

test('online app previews an interpolated stroke immediately, persists it, then confirms and undoes the whole stroke', async (t) =>
{
    const { app, client, first, pattern } = await setup(t);
    let persisted: readonly RoomCommand[] = [];
    app.persist = (queue) => { persisted = structuredClone(queue); };
    const x = first % pattern.width, y = Math.floor(first / pattern.width);
    app.dispatch({ type: 'beginStroke', x, y });
    app.dispatch({ type: 'continueStroke', x: x + 5, y });
    assert.equal(app.getReadModel().board.cells.filter(Boolean).length, 6);
    assert.equal(client.snapshot!.work.cells.filter(Boolean).length, 0, 'preview is separate from authoritative state');
    assert.ok(persisted.some((command) => command.type === 'paint' && command.edits.length === 6));
    app.dispatch({ type: 'endStroke' });
    await app.drain();
    assert.equal(client.snapshot!.work.cells.filter(Boolean).length, 6);
    app.dispatch({ type: 'undo' });
    await app.drain();
    assert.equal(app.getReadModel().board.cells.filter(Boolean).length, 0);
    app.dispatch({ type: 'redo' });
    await app.drain();
    assert.equal(app.getReadModel().board.cells.filter(Boolean).length, 6);
    assert.deepEqual(persisted, []);
});

test('a submitted command payload stays immutable after acknowledgement timeout while a stroke continues', async (t) =>
{
    const { app, client, first, pattern } = await setup(t);
    const original = client.command.bind(client);
    let attempts = 0;
    client.command = async () => { attempts += 1; throw new Error('ack-timeout'); };
    let persisted: readonly RoomCommand[] = [];
    app.persist = (queue) => { persisted = structuredClone(queue); };
    const x = first % pattern.width, y = Math.floor(first / pattern.width);
    app.dispatch({ type: 'beginStroke', x, y });
    await waitFor(() => attempts > 0);
    const firstRequest = structuredClone(persisted[0]);
    app.dispatch({ type: 'continueStroke', x: x + 1, y });
    assert.deepEqual(persisted[0], firstRequest, 'retries never mutate the original operation content');
    assert.equal(persisted.length, 2);
    client.command = original;
    app.dispatch({ type: 'endStroke' });
    await app.drain();
    assert.equal(client.snapshot!.work.cells.filter(Boolean).length, 2);
});

test('server presence during standing does not terminate the local camera transition early', async (t) =>
{
    const { app, client } = await setup(t);
    app.dispatch({ type: 'retreat' });
    app.dispatch({ type: 'tick', deltaSeconds: 2 });
    app.dispatch({ type: 'stand' });
    await waitFor(() => app.getReadModel().transition?.kind === 'stand');
    await client.refresh();
    assert.equal(app.getReadModel().transition?.kind, 'stand');
    app.dispatch({ type: 'tick', deltaSeconds: 0.1 });
    assert.equal(app.getReadModel().mode, 'transition');
    app.dispatch({ type: 'tick', deltaSeconds: 2 });
    assert.equal(app.getReadModel().mode, 'workshop');
});

test('rapid successive strokes on one cell follow confirmed own writes without losing the latest color', async (t) =>
{
    const { app, client, first, pattern } = await setup(t);
    const x = first % pattern.width, y = Math.floor(first / pattern.width);
    for (const colorNumber of [1, 2, 3])
    {
        app.dispatch({ type: 'selectColor', colorNumber });
        app.dispatch({ type: 'beginStroke', x, y });
        app.dispatch({ type: 'endStroke' });
    }
    assert.equal(app.getReadModel().board.cells[first], 3);
    await app.drain();
    assert.equal(client.snapshot!.work.cells[first], 3);
    app.dispatch({ type: 'undo' });
    await app.drain();
    assert.equal(client.snapshot!.work.cells[first], 2);
});

test('queued own recoloring never advances over a newer collaborator write', async (t) =>
{
    const { app, client, first, pattern, server } = await setup(t);
    const peer = new MultiplayerClient(server.url, { nickname: '伙伴' });
    t.after(() => peer.close());
    await peer.connect();
    await peer.join(client.snapshot!.roomId);
    const deadline = Date.now() + 5000;
    let sequence = 0;
    while (true)
    {
        const player = peer.snapshot!.players.find((entry) => entry.playerId === peer.session!.playerId)!;
        if (Math.hypot(player.x - 2.35, player.z) < 1.4) { break; }
        assert.ok(Date.now() < deadline, 'partner reaches the side seat');
        await peer.input({ sequence: sequence++, directionX: player.x < 2.4 ? 1 : 0,
            directionZ: player.x < 2.4 ? 0 : -1, selectedColor: 4, cursor: null });
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await peer.seat(1);
    const original = client.command.bind(client);
    let intervened = false;
    client.command = async (command) =>
    {
        const receipt = await original(command);
        if (command.type === 'paint' && !intervened)
        {
            intervened = true;
            const snapshot = await peer.refresh();
            await peer.command({ type: 'paint', roomId: snapshot.roomId, workId: snapshot.work.id,
                opId: randomUUID(), strokeId: randomUUID(),
                edits: [{ index: first, color: 4, expectedVersion: snapshot.work.cellVersions[first] }] });
            await client.refresh();
        }
        return receipt;
    };
    const notices: string[] = [];
    app.onNotice = (message) => notices.push(message);
    for (const colorNumber of [1, 2])
    {
        app.dispatch({ type: 'selectColor', colorNumber });
        app.dispatch({ type: 'beginStroke', x: first % pattern.width, y: Math.floor(first / pattern.width) });
        app.dispatch({ type: 'endStroke' });
    }
    await app.drain();
    assert.equal(app.getReadModel().board.cells[first], 4);
    assert.ok(notices.some((message) => message.includes('保留对方结果')));
});
