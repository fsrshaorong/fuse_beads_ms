import { startWorkshopServer } from '../server/server';

// Dedicated child for the abrupt-exit test; it never opens or controls a browser.
const server = await startWorkshopServer({ port: 0, databasePath: process.env.MULTIPLAYER_DB });
console.log(`BACKEND_URL=${server.url}`);
