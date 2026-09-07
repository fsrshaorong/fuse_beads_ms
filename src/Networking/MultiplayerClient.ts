import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { PROTOCOL_VERSION } from '../../shared/MultiplayerProtocol';
import type {
    Acknowledge, ClientEvents, CollectedArtwork, CommandReceipt, CreateRoomRequest,
    PresenceInput, RoomCommand, RoomPatch, RoomSnapshot, SavedDraftSummary, ServerEvents, SessionInfo
} from '../../shared/MultiplayerProtocol';

/** Browser/Node client adapter. Credentials and unconfirmed commands are owned by its host, never localStorage here. */
export class MultiplayerClient
{
    public readonly socket: Socket<ServerEvents, ClientEvents>;
    public session: SessionInfo | null = null;
    public snapshot: RoomSnapshot | null = null;
    public ready = false;
    public onState: (snapshot: RoomSnapshot) => void = () => {};
    public onSession: (session: SessionInfo) => void = () => {};
    public onError: (error: Error) => void = () => {};
    private roomId: string | null = null;
    private resyncing: Promise<RoomSnapshot> | null = null;
    private openPromise: Promise<SessionInfo> | null = null;

    public constructor(url: string, identity: { token?: string; nickname?: string } = {}, private readonly timeoutMs = 3000)
    {
        this.socket = io(url, {
            autoConnect: false, transports: ['websocket'], reconnection: true,
            auth: { protocolVersion: PROTOCOL_VERSION, ...identity }
        });
        this.socket.on('room:snapshot', (snapshot) => this.acceptSnapshot(snapshot));
        this.socket.on('room:patch', (patch) => this.acceptPatch(patch));
        this.socket.on('room:presence', ({ roomId, players }) =>
        {
            if (this.snapshot?.roomId === roomId)
            {
                this.snapshot = { ...this.snapshot, players };
                this.onState(this.snapshot);
            }
        });
        this.socket.on('disconnect', () => { this.ready = false; });
        this.socket.on('session:replaced', () =>
        {
            this.ready = false;
            this.onError(new Error('session-replaced'));
        });
        this.socket.on('server:error', ({ code }) => this.onError(new Error(code)));
    }

    public connect(): Promise<SessionInfo>
    {
        if (this.openPromise !== null)
        {
            return this.openPromise;
        }
        this.openPromise = new Promise<SessionInfo>((resolve, reject) =>
        {
            this.socket.on('connect_error', (error) =>
            {
                this.onError(error);
                reject(error);
            });
            this.socket.on('connect', () =>
            {
                void this.restore().then(resolve).catch((error: Error) =>
                {
                    this.onError(error);
                    reject(error);
                });
            });
            this.socket.connect();
        });
        return this.openPromise;
    }

    public async create(request: CreateRoomRequest): Promise<RoomSnapshot>
    {
        this.requireReady();
        const snapshot = await this.request<RoomSnapshot>((ack) => this.socket.emit('room:create', request, ack));
        this.roomId = snapshot.roomId;
        this.acceptSnapshot(snapshot);
        return snapshot;
    }

    public async join(roomId: string): Promise<RoomSnapshot>
    {
        this.requireReady();
        const snapshot = await this.request<RoomSnapshot>((ack) => this.socket.emit('room:join', { roomId }, ack));
        this.roomId = roomId;
        this.acceptSnapshot(snapshot);
        return snapshot;
    }

    public async leave(): Promise<void>
    {
        this.requireReady();
        await this.request<null>((ack) => this.socket.emit('room:leave', ack));
        this.roomId = null;
        this.snapshot = null;
    }

    public async command(command: RoomCommand): Promise<CommandReceipt>
    {
        this.requireReady();
        // A retry always keeps the exact operation ID and payload. Offline editing is deliberately rejected.
        try
        {
            return await this.request<CommandReceipt>((ack) => this.socket.emit('room:command', command, ack));
        }
        catch (error)
        {
            if (!(error instanceof Error) || error.message !== 'ack-timeout' || !this.ready)
            {
                throw error;
            }
            return this.request<CommandReceipt>((ack) => this.socket.emit('room:command', command, ack));
        }
    }

    public input(input: PresenceInput): Promise<null>
    {
        this.requireReady();
        return this.request((ack) => this.socket.emit('player:input', input, ack));
    }

    public seat(seat: number | null): Promise<null>
    {
        this.requireReady();
        return this.request((ack) => this.socket.emit('player:seat', { seat }, ack));
    }

    public collection(): Promise<CollectedArtwork[]>
    {
        this.requireReady();
        return this.request((ack) => this.socket.emit('collection:list', ack));
    }

    public drafts(): Promise<SavedDraftSummary[]>
    {
        this.requireReady();
        return this.request((ack) => this.socket.emit('room:drafts', ack));
    }

    public refresh(): Promise<RoomSnapshot>
    {
        if (this.resyncing === null)
        {
            this.resyncing = this.request<RoomSnapshot>((ack) => this.socket.emit('room:snapshot', ack))
                .then((snapshot) =>
                {
                    this.acceptSnapshot(snapshot);
                    return snapshot;
                }).finally(() => { this.resyncing = null; });
        }
        return this.resyncing;
    }

    public close(): void
    {
        this.ready = false;
        this.socket.disconnect();
        this.socket.removeAllListeners();
    }

    private async restore(): Promise<SessionInfo>
    {
        const session = await this.request<SessionInfo>((ack) => this.socket.emit('session:get', ack));
        this.session = session;
        this.socket.auth = { protocolVersion: PROTOCOL_VERSION, token: session.token };
        this.onSession(session);
        if (this.roomId !== null)
        {
            const snapshot = await this.request<RoomSnapshot>((ack) => this.socket.emit('room:join', { roomId: this.roomId! }, ack));
            this.acceptSnapshot(snapshot);
        }
        this.ready = true;
        return session;
    }

    private acceptSnapshot(snapshot: RoomSnapshot): void
    {
        if (this.snapshot?.roomId === snapshot.roomId && this.snapshot.version > snapshot.version)
        {
            return;
        }
        this.snapshot = snapshot;
        this.onState(snapshot);
    }

    private acceptPatch(patch: RoomPatch): void
    {
        const current = this.snapshot;
        if (current === null || current.roomId !== patch.roomId || patch.version <= current.version)
        {
            return;
        }
        if (patch.workId !== current.work.id || patch.version !== current.version + 1)
        {
            void this.refresh().catch((error: Error) => this.onError(error));
            return;
        }
        const work = structuredClone(current.work);
        for (const change of patch.cells)
        {
            work.cells[change.index] = change.color;
            work.cellVersions[change.index] = change.version;
        }
        for (const index of patch.coverage)
        {
            work.coverage[index] = true;
        }
        work.stage = patch.stage;
        work.artworkId = patch.artworkId;
        work.contributors = [...patch.contributors];
        this.snapshot = { ...current, version: patch.version, work, ironLease: patch.ironLease, proposal: patch.proposal };
        this.onState(this.snapshot);
    }

    private requireReady(): void
    {
        if (!this.ready || !this.socket.connected)
        {
            throw new Error('not-connected');
        }
    }

    private request<T>(send: (ack: Acknowledge<T>) => void): Promise<T>
    {
        if (!this.socket.connected)
        {
            return Promise.reject(new Error('not-connected'));
        }
        return new Promise<T>((resolve, reject) =>
        {
            const timer = setTimeout(() => reject(new Error('ack-timeout')), this.timeoutMs);
            send((reply) =>
            {
                clearTimeout(timer);
                if (reply.ok)
                {
                    resolve(reply.value);
                }
                else
                {
                    reject(new Error(reply.code));
                }
            });
        });
    }
}
