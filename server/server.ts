import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import {
    authSchema, commandSchema, createRoomSchema, joinRoomSchema, presenceSchema, seatSchema
} from '../shared/MultiplayerProtocol';
import type { Acknowledge, ClientEvents, ServerEvents, SessionInfo } from '../shared/MultiplayerProtocol';
import { RoomRuleError } from '../src/Core/Multiplayer/RoomState';
import { RoomService } from './RoomService';
import { SqliteWorkshopStore } from './SqliteStore';
import type { WorkshopStore } from './SqliteStore';

export interface ServerOptions
{
    databasePath?: string;
    store?: WorkshopStore;
    host?: string;
    port?: number;
    allowedOrigins?: string[];
    now?: () => number;
    automaticTick?: boolean;
    onError?: (error: unknown) => void;
}

/** A real HTTP/WebSocket listener. Tests use port 0 and a private temporary database. */
export async function startWorkshopServer(options: ServerOptions = {})
{
    const store = options.store ?? new SqliteWorkshopStore(options.databasePath ?? 'data/multiplayer.sqlite');
    const service = new RoomService(store, options.now);
    const origins = new Set(options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'atelier://game']);
    const reportError = options.onError ?? ((error: unknown) => console.error('Multiplayer server error:', error));
    const http = createServer((request, response) =>
    {
        if (request.method === 'GET' && request.url === '/health')
        {
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ status: 'ok', protocolVersion: 1 }));
            return;
        }
        response.writeHead(404);
        response.end();
    });
    const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { session: SessionInfo }>(http, {
        transports: ['websocket'], maxHttpBufferSize: 65536,
        cors: { origin: [...origins] },
        allowRequest: (request, callback) => callback(null, request.headers.origin === undefined || origins.has(request.headers.origin))
    });
    const activeSockets = new Map<string, string>();
    service.onSnapshot = (snapshot) => io.to(snapshot.roomId).emit('room:snapshot', snapshot);
    service.onPatch = (patch) => io.to(patch.roomId).emit('room:patch', patch);
    service.onPresence = (roomId, players, serverTime) => io.to(roomId).volatile.emit('room:presence', { roomId, players, serverTime });
    io.use((socket, next) =>
    {
        const parsed = authSchema.safeParse(socket.handshake.auth);
        if (!parsed.success)
        {
            next(new Error('invalid-auth-or-protocol'));
            return;
        }
        try
        {
            const session = store.authenticate(parsed.data.token, parsed.data.nickname);
            if (session === null)
            {
                next(new Error('invalid-session'));
                return;
            }
            socket.data.session = session;
            next();
        }
        catch (error)
        {
            reportError(error);
            next(new Error('storage-unavailable'));
        }
    });
    io.on('connection', (socket) =>
    {
        const session = socket.data.session;
        const oldSocketId = activeSockets.get(session.playerId);
        if (oldSocketId !== undefined)
        {
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            oldSocket?.emit('session:replaced');
            oldSocket?.disconnect(true);
        }
        activeSockets.set(session.playerId, socket.id);
        let rateWindow = Date.now();
        let messages = 0;
        function respond<T>(ack: Acknowledge<T>, action: () => T): void
        {
            // No mutation if the caller supplied no acknowledgement function.
            if (typeof ack !== 'function')
            {
                return;
            }
            if (Date.now() - rateWindow >= 1000)
            {
                rateWindow = Date.now();
                messages = 0;
            }
            messages += 1;
            if (messages > 100)
            {
                ack({ ok: false, code: 'rate-limited' });
                return;
            }
            try
            {
                ack({ ok: true, value: action() });
            }
            catch (error)
            {
                if (error instanceof RoomRuleError)
                {
                    ack({ ok: false, code: error.code });
                }
                else if (error instanceof Error && error.name === 'ZodError')
                {
                    ack({ ok: false, code: 'invalid-request' });
                }
                else
                {
                    reportError(error);
                    ack({ ok: false, code: 'storage-unavailable' });
                }
            }
        }
        function joinTransport(roomId: string): void
        {
            for (const joined of socket.rooms)
            {
                if (joined !== socket.id)
                {
                    void socket.leave(joined);
                }
            }
            void socket.join(roomId);
        }
        socket.on('session:get', (ack) => respond(ack, () => session));
        socket.on('room:create', (request, ack) => respond(ack, () =>
        {
            const snapshot = service.create(session, socket.id, createRoomSchema.parse(request));
            joinTransport(snapshot.roomId);
            return snapshot;
        }));
        socket.on('room:join', (request, ack) => respond(ack, () =>
        {
            const snapshot = service.join(session, socket.id, joinRoomSchema.parse(request).roomId);
            joinTransport(snapshot.roomId);
            return snapshot;
        }));
        socket.on('room:leave', (ack) => respond(ack, () =>
        {
            service.leave(session.playerId, socket.id, false);
            for (const roomId of socket.rooms)
            {
                if (roomId !== socket.id)
                {
                    void socket.leave(roomId);
                }
            }
            return null;
        }));
        socket.on('room:snapshot', (ack) => respond(ack, () => service.read(session.playerId, socket.id)));
        socket.on('room:drafts', (ack) => respond(ack, () => service.drafts(session.playerId, socket.id)));
        socket.on('room:command', (request, ack) => respond(ack,
            () => service.command(session.playerId, socket.id, commandSchema.parse(request))));
        socket.on('player:input', (request, ack) => respond(ack, () =>
        {
            service.input(session.playerId, socket.id, presenceSchema.parse(request));
            return null;
        }));
        socket.on('player:seat', (request, ack) => respond(ack, () =>
        {
            service.seat(session.playerId, socket.id, seatSchema.parse(request).seat);
            return null;
        }));
        socket.on('collection:list', (ack) => respond(ack, () => store.collection(session.playerId)));
        socket.on('disconnect', () =>
        {
            if (activeSockets.get(session.playerId) === socket.id)
            {
                activeSockets.delete(session.playerId);
            }
            try
            {
                service.leave(session.playerId, socket.id, true);
            }
            catch (error)
            {
                reportError(error);
            }
        });
    });
    try
    {
        await new Promise<void>((resolve, reject) =>
        {
            http.once('error', reject);
            http.listen(options.port ?? 2567, options.host ?? '127.0.0.1', () =>
            {
                http.off('error', reject);
                resolve();
            });
        });
    }
    catch (error)
    {
        io.close();
        store.close();
        throw error;
    }
    const timer = options.automaticTick === false ? null : setInterval(() =>
    {
        try
        {
            service.tick();
        }
        catch (error)
        {
            reportError(error);
        }
    }, 50);
    let closed = false;
    return {
        url: `http://${options.host ?? '127.0.0.1'}:${(http.address() as AddressInfo).port}`,
        service,
        async close(): Promise<void>
        {
            if (closed)
            {
                return;
            }
            closed = true;
            if (timer !== null)
            {
                clearInterval(timer);
            }
            await new Promise<void>((resolve) => io.close(() => resolve()));
            store.close();
        }
    };
}
