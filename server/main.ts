import { resolve } from 'node:path';
import { startWorkshopServer } from './server';

if (Number(process.versions.node.split('.')[0]) < 24)
{
    throw new Error('The local multiplayer backend requires Node.js 24 or later (built-in SQLite).');
}
const port = Number(process.env.MULTIPLAYER_PORT ?? 2567);
if (!Number.isInteger(port) || port < 1 || port > 65535)
{
    throw new Error('MULTIPLAYER_PORT must be an integer from 1 to 65535');
}
const server = await startWorkshopServer({
    port,
    host: process.env.MULTIPLAYER_HOST ?? '127.0.0.1',
    databasePath: resolve(process.env.MULTIPLAYER_DB ?? 'data/multiplayer.sqlite'),
    allowedOrigins: process.env.MULTIPLAYER_ORIGINS?.split(',').map((origin) => origin.trim())
});
console.log(`Local multiplayer backend: ${server.url}`);
console.log('Protocol 1 | 4 players per room | SQLite persistence | WebSocket transport');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
{
    process.once(signal, () =>
    {
        void server.close().then(() => process.exit(0));
    });
}
