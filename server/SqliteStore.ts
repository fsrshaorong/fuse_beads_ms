import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { RoomState, SharedWork } from '../src/Core/Multiplayer/RoomState';
import type { CollectedArtwork, CommandReceipt, SessionInfo } from '../shared/MultiplayerProtocol';
import { PROTOCOL_VERSION } from '../shared/MultiplayerProtocol';

export interface StoredOperation
{
    fingerprint: string;
    receipt: CommandReceipt | { roomId: string };
}

export interface WorkshopStore
{
    authenticate(token?: string, nickname?: string): SessionInfo | null;
    room(id: string): RoomState | null;
    roomCount(playerId: string): number;
    saveRoom(room: RoomState): void;
    drafts(roomId: string): SharedWork[];
    draft(roomId: string, workId: string): SharedWork | null;
    operation(playerId: string, opId: string): StoredOperation | null;
    commit(room: RoomState, playerId: string, opId: string, operation: StoredOperation, artwork?: CollectedArtwork): void;
    collection(playerId: string): CollectedArtwork[];
    nickname(playerId: string): string;
    close(): void;
}

/** All durable effects of a command share one transaction, including its deduplication receipt. */
export class SqliteWorkshopStore implements WorkshopStore
{
    private readonly db: DatabaseSync;

    public constructor(path: string)
    {
        if (path !== ':memory:')
        {
            mkdirSync(dirname(path), { recursive: true });
        }
        this.db = new DatabaseSync(path);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT OR IGNORE INTO metadata VALUES ('schemaVersion', '1');
            CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES players(id), state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operations (
                player_id TEXT NOT NULL REFERENCES players(id), op_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY (player_id, op_id)
            );
            CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS artworks (id TEXT PRIMARY KEY, work_id TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS collections (
                player_id TEXT NOT NULL REFERENCES players(id), artwork_id TEXT NOT NULL REFERENCES artworks(id),
                PRIMARY KEY (player_id, artwork_id)
            );
        `);
        if (this.db.prepare("SELECT value FROM metadata WHERE key = 'schemaVersion'").get()?.value !== '1')
        {
            this.db.close();
            throw new Error('Unsupported multiplayer database schema');
        }
    }

    public authenticate(token?: string, nickname = '手作朋友'): SessionInfo | null
    {
        if (token !== undefined)
        {
            const row = this.db.prepare('SELECT id, nickname FROM players WHERE token_hash = ?').get(hash(token));
            return row === undefined ? null : {
                playerId: String(row.id), nickname: String(row.nickname), token, protocolVersion: PROTOCOL_VERSION
            };
        }
        const createdToken = randomBytes(32).toString('base64url');
        const playerId = randomUUID();
        this.db.prepare('INSERT INTO players VALUES (?, ?, ?)').run(playerId, hash(createdToken), nickname);
        return { playerId, nickname, token: createdToken, protocolVersion: PROTOCOL_VERSION };
    }

    public nickname(playerId: string): string
    {
        return String(this.db.prepare('SELECT nickname FROM players WHERE id = ?').get(playerId)?.nickname ?? '手作朋友');
    }

    public room(id: string): RoomState | null
    {
        const row = this.db.prepare('SELECT state FROM rooms WHERE id = ?').get(id);
        return row === undefined ? null : JSON.parse(String(row.state)) as RoomState;
    }

    public roomCount(playerId: string): number
    {
        return Number(this.db.prepare('SELECT COUNT(*) AS count FROM rooms WHERE creator_id = ?').get(playerId)?.count ?? 0);
    }

    public saveRoom(room: RoomState): void
    {
        this.db.prepare(`INSERT INTO rooms VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET state = excluded.state`).run(room.id, room.hostId, JSON.stringify(room));
    }

    public operation(playerId: string, opId: string): StoredOperation | null
    {
        const row = this.db.prepare('SELECT fingerprint, receipt FROM operations WHERE player_id = ? AND op_id = ?')
            .get(playerId, opId);
        return row === undefined ? null : {
            fingerprint: String(row.fingerprint), receipt: JSON.parse(String(row.receipt)) as StoredOperation['receipt']
        };
    }

    public drafts(roomId: string): SharedWork[]
    {
        return this.db.prepare('SELECT state FROM works WHERE room_id = ? ORDER BY rowid DESC LIMIT 100')
            .all(roomId).map((row) => JSON.parse(String(row.state)) as SharedWork);
    }

    public draft(roomId: string, workId: string): SharedWork | null
    {
        const row = this.db.prepare('SELECT state FROM works WHERE room_id = ? AND id = ?').get(roomId, workId);
        return row === undefined ? null : JSON.parse(String(row.state)) as SharedWork;
    }

    public commit(room: RoomState, playerId: string, opId: string, operation: StoredOperation, artwork?: CollectedArtwork): void
    {
        this.db.exec('BEGIN IMMEDIATE');
        try
        {
            this.saveRoom(room);
            this.db.prepare(`INSERT INTO works VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state`)
                .run(room.work.id, room.id, JSON.stringify(room.work));
            this.db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?)')
                .run(playerId, opId, operation.fingerprint, JSON.stringify(operation.receipt));
            if (artwork !== undefined)
            {
                this.db.prepare('INSERT INTO artworks VALUES (?, ?, ?)').run(artwork.id, artwork.workId, JSON.stringify(artwork));
                const addCollection = this.db.prepare('INSERT INTO collections VALUES (?, ?)');
                for (const contributor of artwork.contributors)
                {
                    addCollection.run(contributor.playerId, artwork.id);
                }
            }
            this.db.exec('COMMIT');
        }
        catch (error)
        {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    public collection(playerId: string): CollectedArtwork[]
    {
        return this.db.prepare(`SELECT artworks.state FROM artworks JOIN collections
            ON artworks.id = collections.artwork_id WHERE collections.player_id = ? ORDER BY artworks.rowid DESC LIMIT 256`)
            .all(playerId).map((row) => JSON.parse(String(row.state)) as CollectedArtwork);
    }

    public close(): void
    {
        this.db.close();
    }
}

export function hash(value: string): string
{
    return createHash('sha256').update(value).digest('hex');
}
