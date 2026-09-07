import type { WorkshopCommand, WorkshopCommandResult, WorkshopReadModel, FinishedWorkshopArtwork } from './WorkshopApplication';
import { NumberedBeadBoard } from '../Core/Gameplay/Board/NumberedBeadBoard';
import { PLAYABLE_PATTERN_CATALOG } from '../Core/Gameplay/Board/PlayablePatterns';
import { completeWorkshopTransition, createWorkshopInteractionState, tryBeginWorkshopTransition } from '../Core/Gameplay/Workshop/WorkshopInteractionFlow';
import type { WorkshopInteractionState, WorkshopTransitionKind } from '../Core/Gameplay/Workshop/WorkshopInteractionFlow';
import { WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS } from '../Core/Gameplay/Workshop/WorkshopCameraTransition';
import { advanceWorkshopPosition, WORKSHOP_LAYOUT } from '../Core/Multiplayer/WorkshopLayout';
import type { RoomCommand, RoomSnapshot, SavedDraftSummary } from '../../shared/MultiplayerProtocol';
import { commandSchema } from '../../shared/MultiplayerProtocol';
import { MultiplayerClient } from '../Networking/MultiplayerClient';

type Action = RoomCommand extends infer C ? C extends RoomCommand ? Omit<C, 'opId' | 'roomId' | 'workId'> : never : never;
interface BufferedCell { index: number; color: number; expectedVersion: number }

/** Adapts the shared board to the existing renderer; camera, tool and pending previews belong to this player. */
export class OnlineWorkshopApplication
{
    public onChange: () => void = () => {};
    public onNotice: (message: string) => void = () => {};
    public persist: (commands: readonly RoomCommand[]) => void = () => {};
    private interaction: WorkshopInteractionState = createWorkshopInteractionState();
    private transitionElapsed = 0;
    private selectedColor = 1;
    private tool: 'place' | 'erase' = 'place';
    private revision = 0;
    private previewRevision = 0;
    private cached: WorkshopReadModel | null = null;
    private snapshot: RoomSnapshot;
    private strokeId: string | null = null;
    private anchor: { x: number; y: number } | null = null;
    private visited = new Set<number>();
    private buffer = new Map<number, BufferedCell>();
    private ironBuffer = new Set<number>();
    private queue: RoomCommand[] = [];
    private readonly submittedIds = new Set<string>();
    private sending = false;
    private seatBusy = false;
    private retired = false;
    private clock = 0;
    private lastPresence = 0;
    private sequence = 0;
    private movement = { x: 0, z: 0 };
    private cursor: number | null = null;
    private predictedAvatar: { x: number; z: number; yaw: number };
    private artworks: FinishedWorkshopArtwork[] = [];
    private readonly networkTimer: ReturnType<typeof setInterval>;
    private lastArtwork: string | null = null;
    private collectionDirty = true;
    private collectionLoading = false;
    private nextCollectionAttempt = 0;

    public constructor(public readonly client: MultiplayerClient, pending: unknown[] = [])
    {
        if (client.snapshot === null || client.session === null)
        {
            throw new Error('Join a room before creating the online application');
        }
        this.snapshot = client.snapshot;
        const player = this.player;
        this.predictedAvatar = { x: player?.x ?? 0, z: player?.z ?? 2.4, yaw: player?.yaw ?? Math.PI };
        if (player?.seat !== null && player?.seat !== undefined)
        {
            this.interaction = { mode: 'tabletop', overlay: 'none' };
        }
        this.queue = pending.flatMap((value) =>
        {
            const parsed = commandSchema.safeParse(value);
            return parsed.success && parsed.data.roomId === this.snapshot.roomId ? [parsed.data] : [];
        });
        this.queue.forEach((command) => this.submittedIds.add(command.opId));
        client.onState = (snapshot) => this.receive(snapshot);
        client.socket.on('disconnect', () =>
        {
            this.movement = { x: 0, z: 0 };
            this.endStroke();
            this.changed();
        });
        this.networkTimer = setInterval(() =>
        {
            if (this.client.ready && !this.retired) { this.flush(); void this.pump(); }
        }, 50);
        void this.loadCollection();
    }

    public get room(): RoomSnapshot { return this.snapshot; }
    public get player() { return this.snapshot.players.find((entry) => entry.playerId === this.client.session?.playerId); }
    public get pendingCount(): number { return this.queue.length + Number(this.buffer.size > 0) + Number(this.ironBuffer.size > 0); }
    public get ownsIron(): boolean { return this.snapshot.ironLease?.playerId === this.client.session?.playerId; }
    public get nearestSeat(): number | null
    {
        const candidates = WORKSHOP_LAYOUT.seats.map((seat, index) => ({ index,
            distance: Math.hypot((this.player?.x ?? this.predictedAvatar.x) - seat.x,
                (this.player?.z ?? this.predictedAvatar.z) - seat.z) }))
            .filter((seat) => seat.distance <= 1.5 && !this.snapshot.players.some((player) => player.seat === seat.index))
            .sort((a, b) => a.distance - b.distance);
        return candidates[0]?.index ?? null;
    }

    public setCursor(cell: { x: number; y: number } | null): void
    {
        this.cursor = cell === null ? null : cell.y * this.snapshot.pattern.width + cell.x;
    }

    public dispatch(command: WorkshopCommand): WorkshopCommandResult
    {
        if (command.type === 'tick')
        {
            this.tick(command.deltaSeconds);
            return accept();
        }
        if (command.type === 'endStroke' || command.type === 'pauseStroke')
        {
            if (command.type === 'endStroke') { this.endStroke(); }
            else { this.anchor = null; }
            return accept();
        }
        if (!this.client.ready || this.retired)
        {
            return { accepted: false, changed: false, code: 'not-connected' };
        }
        switch (command.type)
        {
            case 'move':
                if (this.interaction.mode === 'workshop')
                {
                    this.movement = { x: command.x, z: command.z };
                }
                break;
            case 'selectColor':
                if (command.colorNumber >= 1 && command.colorNumber <= this.snapshot.pattern.palette.length)
                {
                    this.endStroke();
                    this.selectedColor = command.colorNumber;
                }
                break;
            case 'selectTool':
                this.endStroke();
                this.tool = command.tool;
                break;
            case 'sit':
                if (!this.seatBusy && this.interaction.mode === 'workshop' && this.nearestSeat !== null)
                {
                    this.seatBusy = true;
                    void this.client.seat(this.nearestSeat).then(() => this.beginTransition('sit'))
                        .catch((error: Error) => this.notice(error)).finally(() => { this.seatBusy = false; });
                }
                break;
            case 'stand':
                if (!this.seatBusy && this.interaction.mode === 'tabletop')
                {
                    this.seatBusy = true;
                    this.endStroke();
                    void this.drain().then(() => this.client.seat(null)).then(() => this.beginTransition('stand'))
                        .catch((error: Error) => this.notice(error)).finally(() => { this.seatBusy = false; });
                }
                break;
            case 'focus': this.beginTransition('focus-board'); break;
            case 'retreat': this.endStroke(); this.beginTransition('unfocus-board'); break;
            case 'beginStroke':
            case 'continueStroke':
                if (this.interaction.mode !== 'beadwork' || !['editing', 'ready'].includes(this.snapshot.work.stage)) { break; }
                if (command.type === 'beginStroke')
                {
                    this.endStroke();
                    this.strokeId = crypto.randomUUID();
                    this.visited.clear();
                }
                this.paint(command.x, command.y);
                break;
            case 'undo': case 'redo':
                this.endStroke();
                this.enqueue({ type: command.type });
                break;
            case 'reset':
            case 'selectPattern':
                this.endStroke();
                this.enqueue({ type: 'proposePattern', patternId: 'patternId' in command ? command.patternId : this.snapshot.pattern.patternId });
                break;
            case 'startIroning':
                this.endStroke();
                this.enqueue({ type: 'acquireIron' });
                break;
            case 'cancelIroning':
                this.flush();
                if (this.ownsIron) { this.enqueue({ type: 'releaseIron', leaseToken: this.snapshot.ironLease!.token }); }
                else { this.enqueue({ type: 'acquireIron' }); }
                break;
            case 'ironCell':
                if (this.interaction.mode === 'beadwork' && this.ownsIron)
                {
                    const index = command.y * this.snapshot.pattern.width + command.x;
                    if (this.snapshot.pattern.targetNumbers[index] > 0 && !this.snapshot.work.coverage[index])
                    {
                        this.ironBuffer.add(index);
                        this.cursor = index;
                    }
                }
                break;
            default: return { accepted: false, changed: false, code: 'online-command-not-available' };
        }
        this.changed();
        return accept();
    }

    public vote(approve: boolean): void
    {
        if (this.snapshot.proposal !== null)
        {
            this.enqueue({ type: 'votePattern', proposalId: this.snapshot.proposal.id, approve });
        }
    }

    public resumeDraft(draft: SavedDraftSummary): void { this.enqueue({ type: 'proposeDraft', draftId: draft.id }); }

    public getReadModel(): WorkshopReadModel
    {
        if (this.cached !== null) { return this.cached; }
        const snapshot = this.snapshot;
        const cells = [...snapshot.work.cells];
        for (const command of this.queue)
        {
            if (command.type === 'paint' && command.workId === snapshot.work.id)
            {
                for (const edit of command.edits) { cells[edit.index] = edit.color; }
            }
        }
        for (const edit of this.buffer.values()) { cells[edit.index] = edit.color; }
        const board = new NumberedBeadBoard(snapshot.pattern, cells).getReadModel();
        const transition = this.interaction.mode === 'transition' ? this.interaction.transition : null;
        const duration = transition === null ? 0 : WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS[transition.kind];
        const history = snapshot.history[this.client.session!.playerId];
        const editing = snapshot.work.stage === 'editing' || snapshot.work.stage === 'ready';
        this.cached = {
            revision: this.revision, avatar: { ...this.predictedAvatar }, mode: this.interaction.mode,
            transition: transition === null ? null : { ...transition, progress: this.transitionElapsed / duration, durationSeconds: duration },
            pattern: snapshot.pattern, patterns: PLAYABLE_PATTERN_CATALOG,
            board: { ...board, revision: snapshot.version + this.previewRevision }, selectedColor: this.selectedColor, tool: this.tool,
            strokeActive: this.strokeId !== null,
            canUndo: editing && (history?.canUndo === true || this.pendingCount > 0), canRedo: editing && history?.canRedo === true,
            stage: snapshot.work.stage, ironCoverage: snapshot.work.coverage,
            ironProgress: snapshot.work.coverage.filter(Boolean).length / Math.max(1, board.targetCellCount),
            finishedArtworks: this.artworks
        };
        return this.cached;
    }

    public async drain(): Promise<void>
    {
        this.flush();
        const deadline = Date.now() + 10000;
        while (this.queue.length > 0 || this.sending)
        {
            if (!this.client.ready || Date.now() > deadline) { throw new Error('pending-operations'); }
            await this.pump();
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }

    public dispose(): void
    {
        this.endStroke();
        this.persist(this.queue);
        this.retired = true;
        clearInterval(this.networkTimer);
        this.client.close();
    }

    private receive(snapshot: RoomSnapshot): void
    {
        if (this.retired) { return; }
        const changedWork = snapshot.work.id !== this.snapshot.work.id;
        this.snapshot = snapshot;
        if (changedWork)
        {
            this.buffer.clear(); this.ironBuffer.clear(); this.strokeId = null; this.anchor = null;
            this.selectedColor = 1;
        }
        const player = this.player;
        if (player !== undefined)
        {
            const gap = Math.hypot(player.x - this.predictedAvatar.x, player.z - this.predictedAvatar.z);
            const correction = gap > 0.8 || player.seat !== null ? 1 : 0.45;
            this.predictedAvatar.x += (player.x - this.predictedAvatar.x) * correction;
            this.predictedAvatar.z += (player.z - this.predictedAvatar.z) * correction;
            if (player.seat !== null) { this.predictedAvatar.yaw = player.yaw; }
            if (player.seat === null && this.interaction.mode !== 'workshop' && !this.seatBusy
                && !(this.interaction.mode === 'transition' && this.interaction.transition.kind === 'stand'))
            {
                this.interaction = createWorkshopInteractionState();
            }
        }
        if (snapshot.work.artworkId !== this.lastArtwork)
        {
            this.lastArtwork = snapshot.work.artworkId;
            this.collectionDirty = true;
            void this.loadCollection();
        }
        this.changed();
    }

    private tick(delta: number): void
    {
        this.clock += delta;
        if (this.interaction.mode === 'transition')
        {
            this.transitionElapsed += delta;
            if (this.transitionElapsed >= WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS[this.interaction.transition.kind])
            {
                this.interaction = completeWorkshopTransition(this.interaction).state;
            }
            this.changed();
        }
        if (this.client.ready)
        {
            if (this.collectionDirty && !this.collectionLoading && this.clock >= this.nextCollectionAttempt) { void this.loadCollection(); }
            if (this.interaction.mode === 'workshop' && (this.movement.x !== 0 || this.movement.z !== 0))
            {
                Object.assign(this.predictedAvatar, advanceWorkshopPosition(this.predictedAvatar.x, this.predictedAvatar.z,
                    this.movement.x, this.movement.z, delta));
                this.predictedAvatar.yaw = Math.atan2(this.movement.x, this.movement.z);
                this.changed();
            }
            if (this.clock - this.lastPresence >= 0.07)
            {
                this.lastPresence = this.clock;
                void this.client.input({ sequence: this.sequence++, directionX: this.movement.x, directionZ: this.movement.z,
                    selectedColor: this.selectedColor, cursor: this.cursor }).catch(() => {});
            }
        }
        this.movement = { x: 0, z: 0 };
    }

    private beginTransition(kind: WorkshopTransitionKind): void
    {
        const next = tryBeginWorkshopTransition(this.interaction, kind);
        if (next.accepted)
        {
            this.interaction = next.state;
            this.transitionElapsed = 0;
            this.movement = { x: 0, z: 0 };
            this.changed();
        }
    }

    private paint(x: number, y: number): void
    {
        if (this.strokeId === null) { return; }
        const from = this.anchor ?? { x, y };
        const length = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
        for (let step = 0; step <= length; step += 1)
        {
            const nx = Math.round(from.x + (x - from.x) * step / length), ny = Math.round(from.y + (y - from.y) * step / length);
            if (nx < 0 || ny < 0 || nx >= this.snapshot.pattern.width || ny >= this.snapshot.pattern.height) { continue; }
            const index = ny * this.snapshot.pattern.width + nx;
            if (this.visited.has(index) || this.snapshot.pattern.targetNumbers[index] === 0) { continue; }
            this.visited.add(index);
            this.buffer.set(index, { index, color: this.tool === 'erase' ? 0 : this.selectedColor,
                expectedVersion: this.snapshot.work.cellVersions[index] });
        }
        this.anchor = { x, y };
        this.cursor = y * this.snapshot.pattern.width + x;
        // Persist immediate preview intents before the next render / possible page lifecycle event.
        this.flushPaint();
    }

    private endStroke(): void
    {
        this.flush();
        if (this.strokeId !== null) { this.enqueue({ type: 'endStroke' }); }
        this.strokeId = null;
        this.anchor = null;
        this.visited.clear();
        this.changed();
    }

    private flushPaint(): void
    {
        const edits = [...this.buffer.values()];
        this.buffer.clear();
        if (this.strokeId !== null)
        {
            for (let offset = 0; offset < edits.length; offset += 128)
            {
                const tail = this.queue.at(-1);
                const part = edits.slice(offset, offset + 128);
                if (tail?.type === 'paint' && !this.submittedIds.has(tail.opId)
                    && tail.strokeId === this.strokeId && tail.edits.length + part.length <= 128)
                {
                    tail.edits.push(...part);
                    this.previewRevision += 1;
                    this.persist(this.queue);
                }
                else { this.enqueue({ type: 'paint', strokeId: this.strokeId, edits: part }); }
            }
        }
    }

    private flush(): void
    {
        this.flushPaint();
        const indices = [...this.ironBuffer];
        this.ironBuffer.clear();
        if (this.ownsIron)
        {
            for (let offset = 0; offset < indices.length; offset += 128)
            {
                this.enqueue({ type: 'iron', leaseToken: this.snapshot.ironLease!.token, indices: indices.slice(offset, offset + 128) });
            }
        }
    }

    private enqueue(action: Action): void
    {
        if (this.retired || this.queue.length >= 256) { this.onNotice('操作等待较多，请稍等同步。'); return; }
        this.queue.push({ ...action, opId: crypto.randomUUID(), roomId: this.snapshot.roomId, workId: this.snapshot.work.id } as RoomCommand);
        this.previewRevision += 1;
        this.persist(this.queue);
        this.changed();
    }

    private async pump(): Promise<void>
    {
        if (this.retired || this.sending || !this.client.ready || this.queue.length === 0) { return; }
        this.sending = true;
        const command = this.queue[0];
        this.submittedIds.add(command.opId);
        try
        {
            const receipt = await this.client.command(command);
            if (receipt.skippedIndices.length > 0) { this.onNotice(`${receipt.skippedIndices.length} 处已有伙伴的新修改，已保留对方结果。`); }
            if (command.type === 'paint' && command.workId === this.snapshot.work.id)
            {
                for (const edit of command.edits)
                {
                    // Only advance unsent intents along our own confirmed write, never over a newer partner edit.
                    if (receipt.skippedIndices.includes(edit.index)
                        || this.snapshot.work.cellVersions[edit.index] !== receipt.version) { continue; }
                    for (const pending of this.queue.slice(1))
                    {
                        if (pending.type !== 'paint' || pending.workId !== command.workId
                            || this.submittedIds.has(pending.opId)) { continue; }
                        const dependent = pending.edits.find((entry) => entry.index === edit.index
                            && entry.expectedVersion === edit.expectedVersion);
                        if (dependent !== undefined) { dependent.expectedVersion = receipt.version; }
                    }
                }
            }
            this.queue.shift();
        }
        catch (error)
        {
            const message = error instanceof Error ? error.message : 'unknown-error';
            if (!['not-connected', 'ack-timeout', 'storage-unavailable', 'rate-limited'].includes(message))
            {
                this.queue.shift();
                this.notice(error);
            }
        }
        finally
        {
            this.sending = false;
            if (!this.queue.some((entry) => entry.opId === command.opId)) { this.submittedIds.delete(command.opId); }
            this.previewRevision += 1;
            this.persist(this.queue);
            this.changed();
        }
    }

    private async loadCollection(): Promise<void>
    {
        if (this.retired || !this.client.ready || this.collectionLoading) { return; }
        this.collectionLoading = true;
        this.nextCollectionAttempt = this.clock + 2;
        try
        {
            const artworks = await this.client.collection();
            this.collectionDirty = false;
            this.artworks = artworks.flatMap((artwork) =>
            {
                const pattern = PLAYABLE_PATTERN_CATALOG.find((entry) => entry.patternId === artwork.patternId);
                return pattern === undefined ? [] : [{ artworkId: artwork.id, patternId: artwork.patternId,
                    name: `${pattern.name} · ${artwork.contributors.map((entry) => entry.nickname).join('、')}`,
                    width: pattern.width, height: pattern.height, cells: artwork.cells }];
            });
            this.changed();
        }
        catch { this.collectionDirty = true; }
        finally { this.collectionLoading = false; }
    }

    private notice(error: unknown): void
    {
        const code = error instanceof Error ? error.message : String(error);
        const messages: Record<string, string> = {
            'host-only': '由房主发起换图，大家确认后一起开始。', 'proposal-pending': '正在等待伙伴确认换图。',
            'seat-occupied': '这个座位已经有人了，换个位置吧。', 'seat-out-of-range': '再走近一点空座位。',
            'work-read-only': '作品正在熨烫或已经完成。', 'iron-busy': '伙伴正在使用熨斗。',
            'iron-lease-expired': '熨斗已放下，请重新领取。', 'history-empty': '目前没有可撤销的操作。',
            'stale-work': '图案已更新，旧图的待确认操作已停止。', 'stroke-closed': '重连后上一次笔画已结束，请继续拼豆。',
            'work-not-ready': '先把图案颜色放对，再开始熨烫。'
        };
        this.onNotice(messages[code] ?? `操作未完成：${code}`);
    }

    private changed(): void { this.revision += 1; this.cached = null; this.onChange(); }
}

function accept(): WorkshopCommandResult { return { accepted: true, changed: true }; }
