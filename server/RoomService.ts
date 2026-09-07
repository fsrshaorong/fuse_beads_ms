import { randomUUID } from 'node:crypto';
import { DEFAULT_PLAYABLE_PATTERN, PLAYABLE_PATTERN_CATALOG } from '../src/Core/Gameplay/Board/PlayablePatterns';
import type { NumberedBeadPattern } from '../src/Core/Gameplay/Board/NumberedBeadBoard';
import { applyCraftAction, closeStroke, createSharedWork, patternContent, RoomRuleError } from '../src/Core/Multiplayer/RoomState';
import type { RoomState } from '../src/Core/Multiplayer/RoomState';
import type {
    CommandReceipt, CreateRoomRequest, PlayerPresence, PresenceInput, RoomCommand, RoomPatch, RoomSnapshot, SavedDraftSummary, SessionInfo
} from '../shared/MultiplayerProtocol';
import { PROTOCOL_VERSION } from '../shared/MultiplayerProtocol';
import { hash } from './SqliteStore';
import { WORKSHOP_LAYOUT, advanceWorkshopPosition } from '../src/Core/Multiplayer/WorkshopLayout';
import type { WorkshopStore } from './SqliteStore';

interface LivePlayer extends PlayerPresence
{
    socketId: string | null;
    reservedUntil: number;
    directionX: number;
    directionZ: number;
    inputAt: number;
    sequence: number;
}

interface LiveRoom
{
    state: RoomState;
    players: Map<string, LivePlayer>;
}

const RETIRED_PATTERNS = new Set(['pixel-heart', 'starter-heart', 'starter-star', 'starter-mushroom', 'starter-smile']);
const SEATS = WORKSHOP_LAYOUT.seats;

/** One process owns all live rooms. Every mutation is synchronous through the durable commit boundary. */
export class RoomService
{
    private readonly rooms = new Map<string, LiveRoom>();
    private readonly bindings = new Map<string, string>();
    private lastTick: number;
    public onSnapshot: (snapshot: RoomSnapshot) => void = () => {};
    public onPatch: (patch: RoomPatch) => void = () => {};
    public onPresence: (roomId: string, players: PlayerPresence[], time: number) => void = () => {};

    public constructor(private readonly store: WorkshopStore, private readonly now = Date.now)
    {
        this.lastTick = now();
    }

    public create(session: SessionInfo, socketId: string, request: CreateRoomRequest): RoomSnapshot
    {
        const fingerprint = hash(JSON.stringify(['create', request]));
        const previous = this.store.operation(session.playerId, request.opId);
        if (previous !== null)
        {
            check(previous.fingerprint === fingerprint && 'roomId' in previous.receipt, 'op-id-reused');
            return this.join(session, socketId, (previous.receipt as { roomId: string }).roomId);
        }
        check(this.store.roomCount(session.playerId) < 20, 'room-limit');
        const pattern = selectablePattern(request.patternId ?? DEFAULT_PLAYABLE_PATTERN.patternId);
        const room: RoomState = {
            id: randomUUID(), name: request.name, hostId: session.playerId, version: 0,
            members: [session.playerId], work: createSharedWork(pattern, randomUUID(), hash(patternContent(pattern))),
            ironLease: null, proposal: null
        };
        this.store.commit(room, session.playerId, request.opId, { fingerprint, receipt: { roomId: room.id } });
        return this.join(session, socketId, room.id);
    }

    public join(session: SessionInfo, socketId: string, roomId: string): RoomSnapshot
    {
        const room = this.load(roomId);
        this.expirePlayers(room);
        const existing = room.players.get(session.playerId);
        check(existing !== undefined || room.players.size < 4, 'room-full');
        const oldRoom = this.bindings.get(socketId);
        if (oldRoom !== undefined && oldRoom !== roomId)
        {
            this.leave(session.playerId, socketId, false);
        }
        const candidate = structuredClone(room.state);
        candidate.proposal = null;
        if (!candidate.members.includes(session.playerId))
        {
            candidate.members.push(session.playerId);
        }
        if (!room.players.get(candidate.hostId)?.connected)
        {
            candidate.hostId = [...room.players.values()].find((player) => player.connected)?.playerId ?? session.playerId;
        }
        candidate.version += 1;
        this.store.saveRoom(candidate);
        room.state = candidate;
        const spawn = WORKSHOP_LAYOUT.spawns.find((point) => [...room.players.values()]
            .every((player) => Math.hypot(player.x - point.x, player.z - point.z) >= 0.65))
            ?? WORKSHOP_LAYOUT.spawns[room.players.size % WORKSHOP_LAYOUT.spawns.length];
        room.players.set(session.playerId, existing === undefined ? {
            playerId: session.playerId, nickname: session.nickname, connected: true, socketId,
            reservedUntil: Infinity, x: spawn.x, z: spawn.z, yaw: Math.PI, seat: null,
            selectedColor: 1, cursor: null, directionX: 0, directionZ: 0, inputAt: this.now(), sequence: -1
        } : { ...existing, socketId, connected: true, reservedUntil: Infinity,
            directionX: 0, directionZ: 0, inputAt: this.now(), sequence: -1 });
        this.bindings.set(socketId, roomId);
        const snapshot = this.snapshot(room);
        this.onSnapshot(snapshot);
        return snapshot;
    }

    public leave(playerId: string, socketId: string, reserve: boolean): void
    {
        const roomId = this.bindings.get(socketId);
        this.bindings.delete(socketId);
        if (roomId === undefined)
        {
            return;
        }
        const room = this.rooms.get(roomId)!;
        const player = room.players.get(playerId);
        if (player === undefined || player.socketId !== socketId)
        {
            return;
        }
        player.connected = false;
        player.socketId = null;
        player.directionX = 0;
        player.directionZ = 0;
        player.cursor = null;
        player.reservedUntil = reserve ? this.now() + 60000 : 0;
        if (!reserve)
        {
            room.players.delete(playerId);
        }
        const candidate = structuredClone(room.state);
        const history = candidate.work.histories[playerId];
        if (history !== undefined)
        {
            closeStroke(history);
        }
        if (candidate.ironLease?.playerId === playerId)
        {
            candidate.ironLease = null;
        }
        if (candidate.hostId === playerId)
        {
            candidate.hostId = [...room.players.values()].find((entry) => entry.connected)?.playerId ?? playerId;
        }
        // Membership changes invalidate destructive proposals rather than silently dropping voters.
        candidate.proposal = null;
        candidate.version += 1;
        this.store.saveRoom(candidate);
        room.state = candidate;
        this.onSnapshot(this.snapshot(room));
    }

    public read(playerId: string, socketId: string): RoomSnapshot
    {
        return this.snapshot(this.authorize(playerId, socketId));
    }

    public drafts(playerId: string, socketId: string): SavedDraftSummary[]
    {
        const room = this.authorize(playerId, socketId);
        return this.store.drafts(room.state.id).filter((work) => work.id !== room.state.work.id && work.stage !== 'finished')
            .map((work) => ({ id: work.id, patternId: work.patternId, name: getPattern(work.patternId).name,
                stage: work.stage, placedCells: work.cells.filter(Boolean).length }));
    }

    public command(playerId: string, socketId: string, command: RoomCommand): CommandReceipt
    {
        const room = this.authorize(playerId, socketId);
        check(command.roomId === room.state.id, 'wrong-room');
        const fingerprint = hash(JSON.stringify(command));
        const previous = this.store.operation(playerId, command.opId);
        if (previous !== null)
        {
            check(previous.fingerprint === fingerprint && 'version' in previous.receipt, 'op-id-reused');
            return { ...previous.receipt as CommandReceipt, duplicate: true };
        }
        check(command.workId === room.state.work.id, 'stale-work');
        const candidate = structuredClone(room.state);
        const pattern = getPattern(candidate.work.patternId);
        let skippedIndices: number[] = [];
        if (command.type === 'proposePattern' || command.type === 'proposeDraft')
        {
            check(candidate.hostId === playerId, 'host-only');
            check(candidate.work.stage !== 'ironing', 'ironing-in-progress');
            const draft = command.type === 'proposeDraft' ? this.store.draft(candidate.id, command.draftId) : null;
            check(command.type !== 'proposeDraft' || (draft !== null && draft.stage !== 'finished'), 'draft-not-found');
            const patternId = command.type === 'proposePattern' ? selectablePattern(command.patternId).patternId : draft!.patternId;
            const voters = [...room.players.values()].filter((player) => player.connected).map((player) => player.playerId);
            candidate.proposal = { id: randomUUID(), patternId, draftId: draft?.id ?? null,
                voters, approvals: [playerId], expiresAt: this.now() + 30000 };
            this.acceptProposal(candidate);
            candidate.version += 1;
        }
        else if (command.type === 'votePattern')
        {
            check(candidate.proposal?.id === command.proposalId && candidate.proposal.expiresAt > this.now(), 'proposal-expired');
            check(candidate.proposal!.voters.includes(playerId), 'not-a-voter');
            if (!command.approve)
            {
                candidate.proposal = null;
            }
            else
            {
                if (!candidate.proposal!.approvals.includes(playerId))
                {
                    candidate.proposal!.approvals.push(playerId);
                }
                this.acceptProposal(candidate);
            }
            candidate.version += 1;
        }
        else
        {
            check(room.players.get(playerId)?.seat !== null, 'seat-required');
            // Freeze edits during a proposal, so approvals refer to the displayed draft.
            check(candidate.proposal === null || candidate.proposal.expiresAt <= this.now(), 'proposal-pending');
            skippedIndices = applyCraftAction(candidate, pattern, playerId, command, this.now(), randomUUID(), randomUUID());
        }
        const receipt: CommandReceipt = { opId: command.opId, version: candidate.version, skippedIndices, duplicate: false };
        const newlyFinished = candidate.work.artworkId !== null && candidate.work.artworkId !== room.state.work.artworkId;
        this.store.commit(candidate, playerId, command.opId, { fingerprint, receipt }, newlyFinished ? {
            id: candidate.work.artworkId!, roomId: candidate.id, workId: candidate.work.id,
            patternId: candidate.work.patternId, patternSignature: candidate.work.patternSignature,
            cells: [...candidate.work.cells], finishedAt: this.now(),
            contributors: candidate.work.contributors.map((id) => ({ playerId: id, nickname: this.store.nickname(id) }))
        } : undefined);
        const old = room.state;
        room.state = candidate;
        if (old.work.id !== candidate.work.id)
        {
            for (const player of room.players.values())
            {
                player.cursor = null;
                player.selectedColor = 1;
            }
            this.onSnapshot(this.snapshot(room));
        }
        else
        {
            this.onPatch(makePatch(old, candidate));
        }
        return receipt;
    }

    public input(playerId: string, socketId: string, input: PresenceInput): void
    {
        const room = this.authorize(playerId, socketId);
        const player = room.players.get(playerId)!;
        check(input.selectedColor <= getPattern(room.state.work.patternId).palette.length, 'invalid-color');
        check(input.cursor === null || input.cursor < room.state.work.cells.length, 'invalid-cell');
        if (input.sequence <= player.sequence)
        {
            return;
        }
        player.sequence = input.sequence;
        player.directionX = input.directionX;
        player.directionZ = input.directionZ;
        player.selectedColor = input.selectedColor;
        player.cursor = player.seat === null ? null : input.cursor;
        player.inputAt = this.now();
    }

    public seat(playerId: string, socketId: string, seat: number | null): void
    {
        const room = this.authorize(playerId, socketId);
        const player = room.players.get(playerId)!;
        if (seat !== null)
        {
            check(![...room.players.values()].some((entry) => entry.playerId !== playerId && entry.seat === seat), 'seat-occupied');
            check(Math.hypot(player.x - SEATS[seat].x, player.z - SEATS[seat].z) <= 1.5, 'seat-out-of-range');
        }
        else if (player.seat !== null)
        {
            const candidate = structuredClone(room.state);
            if (candidate.ironLease?.playerId === playerId)
            {
                candidate.ironLease = null;
            }
            const history = candidate.work.histories[playerId];
            if (history !== undefined)
            {
                closeStroke(history);
            }
            candidate.version += 1;
            this.store.saveRoom(candidate);
            room.state = candidate;
            this.onSnapshot(this.snapshot(room));
            const position = SEATS[player.seat];
            player.x = position.x * 1.35;
            player.z = position.z * 1.35;
        }
        player.seat = seat;
        player.directionX = 0;
        player.directionZ = 0;
        player.cursor = null;
        if (seat !== null)
        {
            player.x = SEATS[seat].x;
            player.z = SEATS[seat].z;
            player.yaw = Math.atan2(-player.x, -player.z);
        }
        this.onPresence(room.state.id, this.presence(room), this.now());
    }

    public tick(): void
    {
        const now = this.now();
        const delta = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
        this.lastTick = now;
        for (const [id, room] of this.rooms)
        {
            this.expirePlayers(room);
            if (room.players.size === 0)
            {
                this.rooms.delete(id);
                continue;
            }
            if ((room.state.ironLease !== null && room.state.ironLease.expiresAt <= now)
                || (room.state.proposal !== null && room.state.proposal.expiresAt <= now))
            {
                const candidate = structuredClone(room.state);
                if (candidate.ironLease !== null && candidate.ironLease.expiresAt <= now)
                {
                    candidate.ironLease = null;
                }
                if (candidate.proposal !== null && candidate.proposal.expiresAt <= now)
                {
                    candidate.proposal = null;
                }
                candidate.version += 1;
                this.store.saveRoom(candidate);
                room.state = candidate;
                this.onSnapshot(this.snapshot(room));
            }
            for (const player of room.players.values())
            {
                if (!player.connected || player.seat !== null || now - player.inputAt > 250)
                {
                    continue;
                }
                const length = Math.hypot(player.directionX, player.directionZ);
                if (length === 0)
                {
                    continue;
                }
                const dx = player.directionX / Math.max(1, length), dz = player.directionZ / Math.max(1, length);
                Object.assign(player, advanceWorkshopPosition(player.x, player.z, dx, dz, delta));
                player.yaw = Math.atan2(dx, dz);
            }
            this.onPresence(id, this.presence(room), now);
        }
    }

    private authorize(playerId: string, socketId: string): LiveRoom
    {
        const roomId = this.bindings.get(socketId);
        check(roomId !== undefined, 'not-in-room');
        const room = this.rooms.get(roomId!)!;
        check(room.players.get(playerId)?.socketId === socketId, 'not-a-member');
        return room;
    }

    private load(id: string): LiveRoom
    {
        const live = this.rooms.get(id);
        if (live !== undefined)
        {
            return live;
        }
        const state = this.store.room(id);
        check(state !== null, 'room-not-found');
        check(state!.work.patternSignature === hash(patternContent(getPattern(state!.work.patternId))), 'pattern-version-mismatch');
        state!.ironLease = null;
        state!.proposal = null;
        for (const history of Object.values(state!.work.histories))
        {
            closeStroke(history);
        }
        const loaded: LiveRoom = { state: state!, players: new Map() };
        this.rooms.set(id, loaded);
        return loaded;
    }

    private acceptProposal(state: RoomState): void
    {
        const proposal = state.proposal!;
        if (proposal.voters.every((id) => proposal.approvals.includes(id)))
        {
            if (proposal.draftId === null)
            {
                const pattern = selectablePattern(proposal.patternId);
                state.work = createSharedWork(pattern, randomUUID(), hash(patternContent(pattern)));
            }
            else
            {
                const draft = this.store.draft(state.id, proposal.draftId);
                check(draft !== null && draft.stage !== 'finished', 'draft-not-found');
                check(draft!.patternSignature === hash(patternContent(getPattern(draft!.patternId))), 'pattern-version-mismatch');
                // Resume as a fresh generation so queued commands from the archived session cannot apply.
                state.work = { ...draft!, id: randomUUID(), cellVersions: draft!.cells.map(() => 0), histories: {} };
            }
            state.ironLease = null;
            state.proposal = null;
        }
    }

    private expirePlayers(room: LiveRoom): void
    {
        for (const [id, player] of room.players)
        {
            if (!player.connected && player.reservedUntil <= this.now())
            {
                room.players.delete(id);
            }
        }
    }

    private presence(room: LiveRoom): PlayerPresence[]
    {
        return [...room.players.values()].map(({ playerId, nickname, connected, x, z, yaw, seat, selectedColor, cursor }) =>
            ({ playerId, nickname, connected, x, z, yaw, seat, selectedColor, cursor }));
    }

    private snapshot(room: LiveRoom): RoomSnapshot
    {
        const state = room.state;
        const { histories: _histories, ...work } = state.work;
        return structuredClone({
            protocolVersion: PROTOCOL_VERSION, roomId: state.id, name: state.name, hostId: state.hostId,
            version: state.version, pattern: getPattern(work.patternId), work,
            history: publicHistory(state),
            ironLease: state.ironLease, proposal: state.proposal, players: this.presence(room)
        });
    }
}

function check(condition: boolean, code: string): void
{
    if (!condition)
    {
        throw new RoomRuleError(code);
    }
}

function getPattern(id: string): NumberedBeadPattern
{
    const pattern = PLAYABLE_PATTERN_CATALOG.find((entry) => entry.patternId === id);
    check(pattern !== undefined, 'unknown-pattern');
    return pattern!;
}

function selectablePattern(id: string): NumberedBeadPattern
{
    check(!RETIRED_PATTERNS.has(id), 'pattern-retired');
    return getPattern(id);
}

function makePatch(before: RoomState, after: RoomState): RoomPatch
{
    return {
        roomId: after.id, workId: after.work.id, version: after.version,
        cells: after.work.cells.flatMap((color, index) => before.work.cellVersions[index] !== after.work.cellVersions[index]
            ? [{ index, color, version: after.work.cellVersions[index] }] : []),
        coverage: after.work.coverage.flatMap((covered, index) => covered && !before.work.coverage[index] ? [index] : []),
        stage: after.work.stage, artworkId: after.work.artworkId, contributors: [...after.work.contributors],
        history: publicHistory(after),
        ironLease: after.ironLease, proposal: after.proposal
    };
}

function publicHistory(room: RoomState): Record<string, { canUndo: boolean; canRedo: boolean }>
{
    return Object.fromEntries(Object.entries(room.work.histories).map(([id, history]) => [id, {
        canUndo: history.undo.length > 0 || (history.active?.changes.length ?? 0) > 0,
        canRedo: history.redo.length > 0
    }]));
}
