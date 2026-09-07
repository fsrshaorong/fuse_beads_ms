import { z } from 'zod';
import type { IronLease, PatternProposal, SharedWork } from '../src/Core/Multiplayer/RoomState';
import type { NumberedBeadPattern } from '../src/Core/Gameplay/Board/NumberedBeadBoard';

export const PROTOCOL_VERSION = 1;
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const base = { opId: id, roomId: id, workId: id };
export const commandSchema = z.discriminatedUnion('type', [
    z.strictObject({ ...base, type: z.literal('paint'), strokeId: id, edits: z.array(z.strictObject({
        index: z.number().int().min(0).max(2703), color: z.number().int().min(0).max(9),
        expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
    })).min(1).max(128) }),
    z.strictObject({ ...base, type: z.enum(['endStroke', 'undo', 'redo', 'acquireIron']) }),
    z.strictObject({ ...base, type: z.literal('iron'), leaseToken: id,
        indices: z.array(z.number().int().min(0).max(2703)).min(1).max(128) }),
    z.strictObject({ ...base, type: z.literal('releaseIron'), leaseToken: id }),
    z.strictObject({ ...base, type: z.literal('proposePattern'), patternId: id }),
    z.strictObject({ ...base, type: z.literal('proposeDraft'), draftId: id }),
    z.strictObject({ ...base, type: z.literal('votePattern'), proposalId: id, approve: z.boolean() })
]);
export type RoomCommand = z.infer<typeof commandSchema>;
export const authSchema = z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/).optional(),
    nickname: z.string().trim().min(1).max(24).optional()
});
export const createRoomSchema = z.strictObject({
    opId: id, name: z.string().trim().min(1).max(40), patternId: id.optional()
});
export type CreateRoomRequest = z.infer<typeof createRoomSchema>;
export const joinRoomSchema = z.strictObject({ roomId: id });
export const presenceSchema = z.strictObject({
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    directionX: z.number().finite().min(-1).max(1),
    directionZ: z.number().finite().min(-1).max(1),
    selectedColor: z.number().int().min(1).max(9),
    cursor: z.number().int().min(0).max(2703).nullable()
});
export type PresenceInput = z.infer<typeof presenceSchema>;
export const seatSchema = z.strictObject({ seat: z.number().int().min(0).max(3).nullable() });
export type Reply<T> = { ok: true; value: T } | { ok: false; code: string };
export type Acknowledge<T> = (reply: Reply<T>) => void;

export interface SessionInfo
{
    playerId: string;
    nickname: string;
    token: string;
    protocolVersion: number;
}

export interface PlayerPresence
{
    playerId: string;
    nickname: string;
    connected: boolean;
    x: number;
    z: number;
    yaw: number;
    seat: number | null;
    selectedColor: number;
    cursor: number | null;
}

export type PublicWork = Pick<SharedWork, 'id' | 'patternId' | 'patternSignature' | 'cells' | 'cellVersions'
    | 'stage' | 'coverage' | 'contributors' | 'artworkId'>;
export interface RoomSnapshot
{
    history: Record<string, { canUndo: boolean; canRedo: boolean }>;
    protocolVersion: number;
    roomId: string;
    name: string;
    hostId: string;
    version: number;
    pattern: NumberedBeadPattern;
    work: PublicWork;
    ironLease: IronLease | null;
    proposal: PatternProposal | null;
    players: PlayerPresence[];
}

export interface RoomPatch
{
    history: Record<string, { canUndo: boolean; canRedo: boolean }>;
    roomId: string;
    workId: string;
    version: number;
    cells: { index: number; color: number; version: number }[];
    coverage: number[];
    stage: SharedWork['stage'];
    artworkId: string | null;
    contributors: string[];
    ironLease: IronLease | null;
    proposal: PatternProposal | null;
}

export interface CommandReceipt
{
    opId: string;
    version: number;
    skippedIndices: number[];
    duplicate: boolean;
}

export interface CollectedArtwork
{
    id: string;
    roomId: string;
    workId: string;
    patternId: string;
    patternSignature: string;
    cells: number[];
    contributors: { playerId: string; nickname: string }[];
    finishedAt: number;
}

export interface SavedDraftSummary
{
    id: string;
    patternId: string;
    name: string;
    stage: SharedWork['stage'];
    placedCells: number;
}

export interface ClientEvents
{
    'session:get': (ack: Acknowledge<SessionInfo>) => void;
    'room:create': (request: CreateRoomRequest, ack: Acknowledge<RoomSnapshot>) => void;
    'room:join': (request: { roomId: string }, ack: Acknowledge<RoomSnapshot>) => void;
    'room:leave': (ack: Acknowledge<null>) => void;
    'room:snapshot': (ack: Acknowledge<RoomSnapshot>) => void;
    'room:drafts': (ack: Acknowledge<SavedDraftSummary[]>) => void;
    'room:command': (request: RoomCommand, ack: Acknowledge<CommandReceipt>) => void;
    'player:input': (request: PresenceInput, ack: Acknowledge<null>) => void;
    'player:seat': (request: { seat: number | null }, ack: Acknowledge<null>) => void;
    'collection:list': (ack: Acknowledge<CollectedArtwork[]>) => void;
}

export interface ServerEvents
{
    'room:snapshot': (snapshot: RoomSnapshot) => void;
    'room:patch': (patch: RoomPatch) => void;
    'room:presence': (state: { roomId: string; players: PlayerPresence[]; serverTime: number }) => void;
    'session:replaced': () => void;
    'server:error': (error: { code: string }) => void;
}
