import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startWorkshopServer } from '../server/server';
import { MultiplayerClient } from '../src/Networking/MultiplayerClient';

const roomCount = Number(process.env.MULTIPLAYER_LOAD_ROOMS ?? 25);
if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 50)
{
    throw new Error('MULTIPLAYER_LOAD_ROOMS must be 1..50');
}
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'beads-load-'));
const clients: MultiplayerClient[] = [];
const rooms: MultiplayerClient[][] = [];
const errors: unknown[] = [];
const server = await startWorkshopServer({ port: 0, databasePath: join(temporaryDirectory, 'load.sqlite'),
    onError: (error) => errors.push(error) });
const started = performance.now();
const latencies: number[] = [];
const rounds = 20;
try
{
    for (let index = 0; index < roomCount; index += 1)
    {
        const group: MultiplayerClient[] = [];
        for (let player = 0; player < 4; player += 1)
        {
            const client = new MultiplayerClient(server.url, { nickname: `R${index + 1}P${player + 1}` }, 10000);
            client.onError = (error) => errors.push(error);
            clients.push(client);
            group.push(client);
            await client.connect();
        }
        const snapshot = await group[0].create({ opId: randomUUID(), name: `并发房间 ${index + 1}` });
        await Promise.all(group.slice(1).map((client) => client.join(snapshot.roomId)));
        await group[0].seat(0);
        rooms.push(group);
    }
    const setupMs = performance.now() - started;
    const loadStart = performance.now();
    for (let round = 0; round < rounds; round += 1)
    {
        await Promise.all(rooms.map(async ([client]) =>
        {
            const snapshot = client.snapshot!;
            const index = snapshot.pattern.targetNumbers.flatMap((color, cell) => color > 0 ? [cell] : [])[round];
            const start = performance.now();
            await client.command({ type: 'paint', opId: randomUUID(), roomId: snapshot.roomId,
                workId: snapshot.work.id, strokeId: randomUUID(), edits: [{ index,
                    color: snapshot.pattern.targetNumbers[index], expectedVersion: 0 }] });
            latencies.push(performance.now() - start);
        }));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const loadMs = performance.now() - loadStart;
    for (const group of rooms)
    {
        // A barrier request ensures preceding WebSocket broadcasts have arrived; it does not replace replica state.
        await Promise.all(group.map((client) => client.collection()));
        for (const client of group)
        {
            assert.equal(client.snapshot!.work.cells.filter(Boolean).length, rounds);
            assert.deepEqual(client.snapshot!.work.cells, group[0].snapshot!.work.cells);
            assert.equal(client.snapshot!.version, group[0].snapshot!.version);
        }
    }
    assert.deepEqual(errors, []);
    latencies.sort((a, b) => a - b);
    const report = {
        passed: true, timestamp: new Date().toISOString(), transport: 'real loopback WebSocket',
        persistence: 'temporary SQLite file, WAL + synchronous FULL',
        rooms: roomCount, connectedClients: clients.length, concurrentWriters: roomCount,
        subscribers: roomCount * 3, committedCommands: latencies.length, replicasChecked: clients.length,
        rounds, setupMs: Math.round(setupMs), loadMs: Math.round(loadMs),
        ackP50Ms: Number(latencies[Math.floor(latencies.length * 0.5)].toFixed(2)),
        ackP95Ms: Number(latencies[Math.floor(latencies.length * 0.95)].toFixed(2)),
        ackMaxMs: Number(latencies.at(-1)!.toFixed(2)),
        scope: 'Backend transport/persistence/fanout smoke load; no browser rendering, WAN latency or production capacity claim.'
    };
    const outputDirectory = resolve('artifacts/multiplayer');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, 'load-report.json'), JSON.stringify(report, null, 4) + '\n');
    console.log(JSON.stringify(report, null, 4));
}
finally
{
    clients.forEach((client) => client.close());
    await server.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
}
