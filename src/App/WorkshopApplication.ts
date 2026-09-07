import { NumberedBeadPaintingSession } from '../Core/Gameplay/Board/NumberedBeadPaintingSession';
import { advanceWorkshopPosition } from '../Core/Multiplayer/WorkshopLayout';
import type { NumberedBeadBoardReadModel, NumberedBeadPattern } from '../Core/Gameplay/Board/NumberedBeadBoard';
import { DEFAULT_PLAYABLE_PATTERN, PLAYABLE_PATTERN_CATALOG } from '../Core/Gameplay/Board/PlayablePatterns';
import { completeWorkshopTransition, createWorkshopInteractionState, tryBeginWorkshopTransition } from '../Core/Gameplay/Workshop/WorkshopInteractionFlow';
import type { WorkshopActivityMode, WorkshopInteractionState, WorkshopTransitionKind } from '../Core/Gameplay/Workshop/WorkshopInteractionFlow';
import { WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS } from '../Core/Gameplay/Workshop/WorkshopCameraTransition';

/** One serializable command shared by browser input and the scenario CLI. */
export type WorkshopCommand =
    | { readonly type: 'sit' | 'stand' | 'focus' | 'retreat' }
    | { readonly type: 'tick'; readonly deltaSeconds: number }
    | { readonly type: 'move'; readonly x: number; readonly z: number; readonly deltaSeconds: number }
    | { readonly type: 'selectColor'; readonly colorNumber: number }
    | { readonly type: 'selectTool'; readonly tool: 'place' | 'erase' }
    | { readonly type: 'beginStroke' | 'continueStroke'; readonly x: number; readonly y: number }
    | { readonly type: 'pauseStroke' | 'endStroke' | 'undo' | 'redo' | 'reset' }
    | { readonly type: 'selectPattern'; readonly patternId: string }
    | { readonly type: 'startIroning' | 'cancelIroning' }
    | { readonly type: 'ironCell'; readonly x: number; readonly y: number }
    | { readonly type: 'restore'; readonly serialized: string };

/** Commands report stable rejection codes without exposing engine or storage objects. */
export interface WorkshopCommandResult
{
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly code?: string;
}

/** A frozen finished piece kept independently from subsequent drafts. */
export interface FinishedWorkshopArtwork
{
    readonly artworkId: string;
    readonly patternId: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly cells: readonly number[];
}

/** Complete immutable state consumed by the Three scene, HTML panels and CLI. */
export interface WorkshopReadModel
{
    readonly revision: number;
    readonly avatar: { readonly x: number; readonly z: number; readonly yaw: number };
    readonly mode: WorkshopActivityMode | 'transition';
    readonly transition: {
        readonly kind: WorkshopTransitionKind;
        readonly from: WorkshopActivityMode;
        readonly to: WorkshopActivityMode;
        readonly progress: number;
        readonly durationSeconds: number;
    } | null;
    readonly pattern: NumberedBeadPattern;
    readonly patterns: readonly NumberedBeadPattern[];
    readonly board: NumberedBeadBoardReadModel;
    readonly selectedColor: number;
    readonly tool: 'place' | 'erase';
    readonly strokeActive: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly stage: 'editing' | 'ready' | 'ironing' | 'finished';
    readonly ironCoverage: readonly boolean[];
    readonly ironProgress: number;
    readonly finishedArtworks: readonly FinishedWorkshopArtwork[];
}

interface Draft
{
    readonly pattern: NumberedBeadPattern;
    session: NumberedBeadPaintingSession;
    stage: WorkshopReadModel['stage'];
    ironCoverage: boolean[];
    finishedArtworkId: string | null;
    undo: number[][];
    redo: number[][];
    revision: number;
}

/** Pure local workshop use case. Hosts own pointers, camera projection and persistence IO. */
export class WorkshopApplication
{
    private readonly drafts = new Map<string, Draft>();
    private activePatternId = DEFAULT_PLAYABLE_PATTERN.patternId;
    private interaction: WorkshopInteractionState = createWorkshopInteractionState();
    private transitionElapsed = 0;
    private tool: 'place' | 'erase' = 'place';
    private strokeBefore: number[] | null = null;
    private eraseAnchor: { x: number; y: number } | null = null;
    private revision = 0;
    private cachedReadModel: WorkshopReadModel | null = null;
    private readonly finishedArtworks: FinishedWorkshopArtwork[] = [];
    private nextArtworkSequence = 1;
    private avatar = { x: 0, z: 2.4, yaw: Math.PI };

    public constructor()
    {
        this.drafts.set(this.activePatternId, createDraft(DEFAULT_PLAYABLE_PATTERN));
    }

    /** Dispatches one value command; rejected commands leave the existing state intact. */
    public dispatch(command: WorkshopCommand): WorkshopCommandResult
    {
        const result = this.applyCommand(command);

        if (result.changed)
        {
            this.revision += 1;
            this.cachedReadModel = null;
        }

        return result;
    }

    /** Returns one cached immutable read model until an accepted command changes state. */
    public getReadModel(): WorkshopReadModel
    {
        if (this.cachedReadModel !== null)
        {
            return this.cachedReadModel;
        }

        const draft = this.getDraft();
        const board = draft.session.getReadModel();
        const transition = this.interaction.mode === 'transition'
            ? this.interaction.transition
            : null;
        const durationSeconds = transition === null
            ? 0
            : WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS[transition.kind];
        this.cachedReadModel = Object.freeze({
            revision: this.revision,
            avatar: Object.freeze({ ...this.avatar }),
            mode: this.interaction.mode,
            transition: transition === null ? null : Object.freeze({
                ...transition,
                progress: this.transitionElapsed / durationSeconds,
                durationSeconds
            }),
            pattern: draft.pattern,
            patterns: PLAYABLE_PATTERN_CATALOG,
            board: Object.freeze({ ...board, revision: draft.revision }),
            selectedColor: board.selectedColorNumber,
            tool: this.tool,
            strokeActive: this.strokeBefore !== null,
            canUndo: draft.undo.length > 0 && draft.stage !== 'ironing' && draft.stage !== 'finished',
            canRedo: draft.redo.length > 0 && draft.stage !== 'ironing' && draft.stage !== 'finished',
            stage: draft.stage,
            ironCoverage: Object.freeze([...draft.ironCoverage]),
            ironProgress: draft.ironCoverage.filter(Boolean).length / Math.max(1, board.targetCellCount),
            finishedArtworks: Object.freeze([...this.finishedArtworks])
        });

        return this.cachedReadModel;
    }

    /** Exports a versioned local save; storage failure handling belongs to the browser host. */
    public exportSave(): string
    {
        return JSON.stringify({
            schemaVersion: 1,
            activePatternId: this.activePatternId,
            tool: this.tool,
            nextArtworkSequence: this.nextArtworkSequence,
            drafts: [...this.drafts.values()].map((draft) => ({
                patternId: draft.pattern.patternId,
                contentSignature: patternSignature(draft.pattern),
                cells: draft.session.getReadModel().cells,
                selectedColor: draft.session.getReadModel().selectedColorNumber,
                stage: draft.stage,
                ironCoverage: draft.ironCoverage,
                finishedArtworkId: draft.finishedArtworkId
            })),
            finishedArtworks: this.finishedArtworks
        });
    }

    private applyCommand(command: WorkshopCommand): WorkshopCommandResult
    {
        switch (command.type)
        {
            case 'sit':
                return this.beginTransition('sit');
            case 'stand':
                return this.beginTransition('stand');
            case 'focus':
                return this.beginTransition('focus-board');
            case 'retreat':
                return this.beginTransition('unfocus-board');
            case 'tick':
                return this.tick(command.deltaSeconds);
            case 'move':
                return this.move(command.x, command.z, command.deltaSeconds);
            case 'beginStroke':
                return this.paint(command.x, command.y, true);
            case 'continueStroke':
                return this.paint(command.x, command.y, false);
            case 'pauseStroke':
                this.eraseAnchor = null;
                return accept(this.getDraft().session.pauseStroke());
            case 'endStroke':
                return accept(this.endStroke());
            case 'selectColor':
                return this.selectColor(command.colorNumber);
            case 'selectTool':
                return this.selectTool(command.tool);
            case 'undo':
                return this.applyHistory(false);
            case 'redo':
                return this.applyHistory(true);
            case 'selectPattern':
                return this.selectPattern(command.patternId);
            case 'reset':
                return this.reset();
            case 'restore':
                return this.restore(command.serialized);
            case 'startIroning':
                return this.startIroning();
            case 'cancelIroning':
                return this.cancelIroning();
            case 'ironCell':
                return this.ironCell(command.x, command.y);
            default:
                return reject('command-not-available');
        }
    }

    private beginTransition(kind: WorkshopTransitionKind): WorkshopCommandResult
    {
        if (kind === 'sit' && Math.hypot(this.avatar.x, this.avatar.z - 1.8) > 1.35)
        {
            return reject('workstation-out-of-range');
        }

        const result = tryBeginWorkshopTransition(this.interaction, kind);

        if (!result.accepted)
        {
            return reject('transition-not-allowed');
        }

        this.endStroke();
        this.interaction = result.state;
        this.transitionElapsed = 0;
        return accept(true);
    }

    private tick(deltaSeconds: number): WorkshopCommandResult
    {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
        {
            return reject('invalid-time');
        }

        if (this.interaction.mode !== 'transition' || deltaSeconds === 0)
        {
            return accept(false);
        }

        this.transitionElapsed += deltaSeconds;
        const duration = WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS[this.interaction.transition.kind];

        if (this.transitionElapsed >= duration)
        {
            if (this.interaction.transition.kind === 'stand')
            {
                this.avatar = { x: 0, z: 1.8, yaw: Math.PI };
            }

            const result = completeWorkshopTransition(this.interaction);

            if (result.accepted)
            {
                this.interaction = result.state;
            }

            this.transitionElapsed = 0;
        }

        return accept(true);
    }

    private move(x: number, z: number, deltaSeconds: number): WorkshopCommandResult
    {
        if (!Number.isFinite(x) || !Number.isFinite(z)
            || !Number.isFinite(deltaSeconds) || deltaSeconds < 0)
        {
            return reject('invalid-movement');
        }

        if (this.interaction.mode !== 'workshop')
        {
            return reject('input-not-owned');
        }

        const scale = Math.max(Math.abs(x), Math.abs(z));

        if (scale === 0 || deltaSeconds === 0)
        {
            return accept(false);
        }

        const length = Math.hypot(x / scale, z / scale);
        const directionX = (x / scale) / length;
        const directionZ = (z / scale) / length;
        const next = advanceWorkshopPosition(this.avatar.x, this.avatar.z, directionX, directionZ, Math.min(deltaSeconds, 100));
        const nextX = next.x;
        const nextZ = next.z;
        const yaw = Math.atan2(directionX, directionZ);
        const changed = nextX !== this.avatar.x || nextZ !== this.avatar.z || yaw !== this.avatar.yaw;
        this.avatar = { x: nextX, z: nextZ, yaw };
        return accept(changed);
    }

    private endStroke(): boolean
    {
        const hadStroke = this.strokeBefore !== null;
        const draft = this.getDraft();
        const cells = draft.session.getReadModel().cells;

        if (this.strokeBefore !== null && !cellsEqual(this.strokeBefore, cells))
        {
            draft.undo.push(this.strokeBefore);
            draft.undo = draft.undo.slice(-30);
            draft.redo = [];
        }

        draft.session.endStroke();
        this.strokeBefore = null;
        this.eraseAnchor = null;
        return hadStroke;
    }

    private paint(x: number, y: number, begin: boolean): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (this.interaction.mode !== 'beadwork')
        {
            return reject('input-not-owned');
        }

        if (draft.stage === 'ironing' || draft.stage === 'finished')
        {
            return reject('artwork-read-only');
        }

        if (!isCellCoordinate(draft.pattern, x, y))
        {
            return reject('out-of-bounds');
        }

        if (!begin && this.strokeBefore === null)
        {
            return reject('stroke-not-active');
        }

        if (this.tool === 'place' && draft.stage === 'ready')
        {
            return reject('board-completed');
        }

        if (begin)
        {
            this.endStroke();
            this.strokeBefore = [...draft.session.getReadModel().cells];
        }

        if (this.tool === 'erase')
        {
            const cells = [...draft.session.getReadModel().cells];
            eraseGridLine(cells, draft.pattern.width, this.eraseAnchor ?? { x, y }, { x, y });
            this.eraseAnchor = { x, y };
            this.replaceCells(draft, cells);
        }
        else
        {
            const result = begin
                ? draft.session.beginStroke(x, y)
                : draft.session.continueStroke(x, y);

            if (!result.accepted)
            {
                return reject(result.code);
            }

            if (result.appliedCellCount > 0)
            {
                draft.revision += 1;
            }

            draft.stage = draft.session.getReadModel().isCompleted ? 'ready' : 'editing';
        }

        if (draft.stage === 'ready')
        {
            this.endStroke();
        }

        return accept(true);
    }

    private selectColor(colorNumber: number): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (!Number.isInteger(colorNumber) || colorNumber < 1 || colorNumber > draft.pattern.palette.length)
        {
            return reject('invalid-color-number');
        }

        if (this.interaction.mode === 'transition')
        {
            return reject('input-not-owned');
        }

        const endedStroke = this.endStroke();
        const result = draft.session.selectColor(colorNumber);
        return accept(endedStroke || (result.accepted && result.changed));
    }

    private selectTool(tool: 'place' | 'erase'): WorkshopCommandResult
    {
        if ((tool !== 'place' && tool !== 'erase') || this.interaction.mode === 'transition')
        {
            return reject('invalid-tool');
        }

        const endedStroke = this.endStroke();
        const changed = this.tool !== tool;
        this.tool = tool;
        return accept(endedStroke || changed);
    }

    private applyHistory(redo: boolean): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (this.interaction.mode !== 'beadwork'
            || draft.stage === 'ironing'
            || draft.stage === 'finished')
        {
            return reject('input-not-owned');
        }

        const pendingChange = this.strokeBefore !== null
            && !cellsEqual(this.strokeBefore, draft.session.getReadModel().cells);

        if ((redo && (draft.redo.length === 0 || pendingChange))
            || (!redo && draft.undo.length === 0 && !pendingChange))
        {
            return reject('history-empty');
        }

        this.endStroke();
        const source = redo ? draft.redo : draft.undo;
        const destination = redo ? draft.undo : draft.redo;
        const cells = source.pop();

        if (cells === undefined)
        {
            return reject('history-empty');
        }

        destination.push([...draft.session.getReadModel().cells]);
        this.replaceCells(draft, cells);
        return accept(true);
    }

    private replaceCells(draft: Draft, cells: readonly number[]): void
    {
        const current = draft.session.getReadModel();

        if (!cellsEqual(current.cells, cells))
        {
            draft.revision += 1;
        }

        draft.session = new NumberedBeadPaintingSession(draft.pattern, cells, current.selectedColorNumber);
        draft.stage = draft.session.getReadModel().isCompleted ? 'ready' : 'editing';
    }

    private selectPattern(patternId: string): WorkshopCommandResult
    {
        const pattern = PLAYABLE_PATTERN_CATALOG.find((candidate) => candidate.patternId === patternId);

        if (pattern === undefined)
        {
            return reject('unknown-pattern');
        }

        if (this.interaction.mode === 'transition' || this.getDraft().stage === 'ironing')
        {
            return reject('input-not-owned');
        }

        const endedStroke = this.endStroke();

        if (patternId === this.activePatternId)
        {
            return accept(endedStroke);
        }

        if (!this.drafts.has(patternId))
        {
            this.drafts.set(patternId, createDraft(pattern));
        }

        this.activePatternId = patternId;
        this.tool = 'place';
        return accept(true);
    }

    private reset(): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (this.interaction.mode === 'transition' || draft.stage === 'ironing')
        {
            return reject('input-not-owned');
        }

        this.endStroke();
        const next = createDraft(draft.pattern);
        next.revision = draft.revision + 1;
        this.drafts.set(this.activePatternId, next);
        this.tool = 'place';
        return accept(true);
    }

    private restore(serialized: string): WorkshopCommandResult
    {
        let restored: ValidatedSave;

        try
        {
            restored = validateSave(serialized);
        }
        catch
        {
            return reject('invalid-save');
        }

        this.endStroke();
        this.drafts.clear();

        for (const draft of restored.drafts)
        {
            this.drafts.set(draft.pattern.patternId, draft);
        }

        this.activePatternId = restored.activePatternId;
        this.tool = restored.tool;
        this.nextArtworkSequence = restored.nextArtworkSequence;
        this.finishedArtworks.splice(0, this.finishedArtworks.length, ...restored.finishedArtworks);
        this.interaction = createWorkshopInteractionState();
        this.transitionElapsed = 0;
        this.avatar = { x: 0, z: 2.4, yaw: Math.PI };
        return accept(true);
    }

    private startIroning(): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (this.interaction.mode !== 'beadwork' || draft.stage !== 'ready')
        {
            return reject('artwork-not-ready');
        }

        if (this.finishedArtworks.length >= 256)
        {
            return reject('collection-full');
        }

        this.endStroke();
        draft.stage = 'ironing';
        draft.ironCoverage.fill(false);
        return accept(true);
    }

    private cancelIroning(): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (draft.stage !== 'ironing')
        {
            return reject('ironing-not-active');
        }

        draft.stage = 'ready';
        draft.ironCoverage.fill(false);
        return accept(true);
    }

    private ironCell(x: number, y: number): WorkshopCommandResult
    {
        const draft = this.getDraft();

        if (!isCellCoordinate(draft.pattern, x, y))
        {
            return reject('out-of-bounds');
        }

        if (draft.stage === 'finished')
        {
            return accept(false);
        }

        if (this.interaction.mode !== 'beadwork' || draft.stage !== 'ironing')
        {
            return reject('ironing-not-active');
        }

        const index = y * draft.pattern.width + x;

        if (draft.pattern.targetNumbers[index] === 0 || draft.ironCoverage[index])
        {
            return accept(false);
        }

        draft.ironCoverage[index] = true;
        const complete = draft.pattern.targetNumbers.every((target, cellIndex) =>
            target === 0 || draft.ironCoverage[cellIndex]);

        if (complete)
        {
            const artworkId = `local-artwork-${this.nextArtworkSequence}`;
            this.nextArtworkSequence += 1;
            draft.stage = 'finished';
            draft.finishedArtworkId = artworkId;
            this.finishedArtworks.push(Object.freeze({
                artworkId,
                patternId: draft.pattern.patternId,
                name: draft.pattern.name,
                width: draft.pattern.width,
                height: draft.pattern.height,
                cells: Object.freeze([...draft.session.getReadModel().cells])
            }));
        }

        return accept(true);
    }

    private getDraft(): Draft
    {
        const draft = this.drafts.get(this.activePatternId);

        if (draft === undefined)
        {
            throw new Error('The active workshop pattern has no draft.');
        }

        return draft;
    }
}

function createDraft(pattern: NumberedBeadPattern): Draft
{
    return {
        pattern,
        session: new NumberedBeadPaintingSession(pattern),
        stage: 'editing',
        ironCoverage: Array.from({ length: pattern.width * pattern.height }, () => false),
        finishedArtworkId: null,
        undo: [],
        redo: [],
        revision: 0
    };
}

function cellsEqual(left: readonly number[], right: readonly number[]): boolean
{
    return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function isCellCoordinate(pattern: NumberedBeadPattern, x: number, y: number): boolean
{
    return Number.isInteger(x) && Number.isInteger(y)
        && x >= 0 && x < pattern.width && y >= 0 && y < pattern.height;
}

function eraseGridLine(
    cells: number[],
    width: number,
    start: { x: number; y: number },
    end: { x: number; y: number }
): void
{
    let x = start.x;
    let y = start.y;
    const distanceX = Math.abs(end.x - x);
    const distanceY = Math.abs(end.y - y);
    const stepX = x < end.x ? 1 : -1;
    const stepY = y < end.y ? 1 : -1;
    let error = distanceX - distanceY;

    while (true)
    {
        cells[y * width + x] = 0;

        if (x === end.x && y === end.y)
        {
            return;
        }

        const doubledError = error * 2;

        if (doubledError > -distanceY)
        {
            error -= distanceY;
            x += stepX;
        }

        if (doubledError < distanceX)
        {
            error += distanceX;
            y += stepY;
        }
    }
}

interface ValidatedSave
{
    readonly activePatternId: string;
    readonly tool: 'place' | 'erase';
    readonly nextArtworkSequence: number;
    readonly drafts: readonly Draft[];
    readonly finishedArtworks: readonly FinishedWorkshopArtwork[];
}

function validateSave(serialized: string): ValidatedSave
{
    if (typeof serialized !== 'string' || serialized.length > 4_000_000)
    {
        throw new Error('Invalid local save payload.');
    }

    const value: unknown = JSON.parse(serialized);
    requireRecord(value);
    requireKeys(value, ['schemaVersion', 'activePatternId', 'tool', 'nextArtworkSequence', 'drafts', 'finishedArtworks']);

    if (value.schemaVersion !== 1
        || typeof value.activePatternId !== 'string'
        || (value.tool !== 'place' && value.tool !== 'erase')
        || !isPositiveInteger(value.nextArtworkSequence)
        || value.nextArtworkSequence >= Number.MAX_SAFE_INTEGER - 256
        || !Array.isArray(value.drafts)
        || value.drafts.length < 1
        || value.drafts.length > PLAYABLE_PATTERN_CATALOG.length
        || !Array.isArray(value.finishedArtworks)
        || value.finishedArtworks.length > 256)
    {
        throw new Error('Unsupported local save schema.');
    }

    const drafts = value.drafts.map(validateDraft);
    const patternIds = new Set(drafts.map((draft) => draft.pattern.patternId));

    if (patternIds.size !== drafts.length || !patternIds.has(value.activePatternId))
    {
        throw new Error('Invalid active draft.');
    }

    const finishedArtworks = value.finishedArtworks.map(validateFinishedArtwork);
    const finishedIds = new Set(finishedArtworks.map((artwork) => artwork.artworkId));

    if (finishedIds.size !== finishedArtworks.length)
    {
        throw new Error('Duplicate finished artwork.');
    }

    for (const artwork of finishedArtworks)
    {
        const sequence = Number(artwork.artworkId.slice('local-artwork-'.length));

        if (sequence >= value.nextArtworkSequence)
        {
            throw new Error('Finished artwork sequence would collide.');
        }
    }

    for (const draft of drafts)
    {
        if (draft.stage !== 'finished')
        {
            continue;
        }

        const artwork = finishedArtworks.find((candidate) => candidate.artworkId === draft.finishedArtworkId);

        if (artwork === undefined
            || artwork.patternId !== draft.pattern.patternId
            || !cellsEqual(artwork.cells, draft.session.getReadModel().cells))
        {
            throw new Error('Finished draft has no matching display piece.');
        }
    }

    return {
        activePatternId: value.activePatternId,
        tool: value.tool,
        nextArtworkSequence: value.nextArtworkSequence,
        drafts,
        finishedArtworks
    };
}

function validateDraft(value: unknown): Draft
{
    requireRecord(value);
    requireKeys(value, ['patternId', 'contentSignature', 'cells', 'selectedColor', 'stage', 'ironCoverage', 'finishedArtworkId']);
    const pattern = PLAYABLE_PATTERN_CATALOG.find((candidate) => candidate.patternId === value.patternId);

    if (pattern === undefined || value.contentSignature !== patternSignature(pattern))
    {
        throw new Error('Unknown or changed pattern content.');
    }

    const cells = validateCells(value.cells, pattern);

    if (!isPositiveInteger(value.selectedColor)
        || value.selectedColor > pattern.palette.length
        || !isStage(value.stage)
        || !Array.isArray(value.ironCoverage)
        || value.ironCoverage.length !== cells.length
        || !value.ironCoverage.every((covered: unknown, index: number) =>
            typeof covered === 'boolean' && (!covered || pattern.targetNumbers[index] > 0)))
    {
        throw new Error('Invalid draft state.');
    }

    const draft = createDraft(pattern);
    draft.session = new NumberedBeadPaintingSession(pattern, cells, value.selectedColor);
    draft.stage = value.stage;
    draft.ironCoverage = value.ironCoverage.slice();
    const completed = draft.session.getReadModel().isCompleted;
    const coverageComplete = pattern.targetNumbers.every((target, index) => target === 0 || draft.ironCoverage[index]);

    if ((draft.stage === 'editing') === completed
        || ((draft.stage === 'editing' || draft.stage === 'ready') && draft.ironCoverage.some(Boolean))
        || (draft.stage === 'ironing' && coverageComplete)
        || (draft.stage === 'finished' && (!coverageComplete || typeof value.finishedArtworkId !== 'string'))
        || (draft.stage !== 'finished' && value.finishedArtworkId !== null))
    {
        throw new Error('Inconsistent draft phase.');
    }

    draft.finishedArtworkId = typeof value.finishedArtworkId === 'string' ? value.finishedArtworkId : null;
    return draft;
}

function validateFinishedArtwork(value: unknown): FinishedWorkshopArtwork
{
    requireRecord(value);
    requireKeys(value, ['artworkId', 'patternId', 'name', 'width', 'height', 'cells']);
    const pattern = PLAYABLE_PATTERN_CATALOG.find((candidate) => candidate.patternId === value.patternId);

    if (pattern === undefined
        || typeof value.artworkId !== 'string'
        || !/^local-artwork-[1-9][0-9]*$/.test(value.artworkId)
        || !isPositiveInteger(Number(value.artworkId.slice('local-artwork-'.length)))
        || value.width !== pattern.width
        || value.height !== pattern.height
        || value.name !== pattern.name)
    {
        throw new Error('Invalid finished artwork identity.');
    }

    const cells = validateCells(value.cells, pattern);

    if (!new NumberedBeadPaintingSession(pattern, cells).getReadModel().isCompleted)
    {
        throw new Error('Finished artwork is incomplete.');
    }

    return Object.freeze({
        artworkId: value.artworkId,
        patternId: pattern.patternId,
        name: pattern.name,
        width: pattern.width,
        height: pattern.height,
        cells: Object.freeze(cells)
    });
}

function validateCells(value: unknown, pattern: NumberedBeadPattern): number[]
{
    if (!Array.isArray(value)
        || value.length !== pattern.width * pattern.height
        || !value.every((cell: unknown) => typeof cell === 'number'
            && Number.isInteger(cell) && cell >= 0 && cell <= pattern.palette.length))
    {
        throw new Error('Invalid saved cells.');
    }

    return value.slice();
}

function requireRecord(value: unknown): asserts value is Record<string, unknown>
{
    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        throw new Error('Expected a saved record.');
    }
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void
{
    const actual = Object.keys(value);

    if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    {
        throw new Error('Unknown or missing save fields.');
    }
}

function isPositiveInteger(value: unknown): value is number
{
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isStage(value: unknown): value is WorkshopReadModel['stage']
{
    return value === 'editing' || value === 'ready' || value === 'ironing' || value === 'finished';
}

function patternSignature(pattern: NumberedBeadPattern): string
{
    return JSON.stringify([pattern.width, pattern.height, pattern.palette, pattern.targetNumbers]);
}

function accept(changed: boolean): WorkshopCommandResult
{
    return { accepted: true, changed };
}

function reject(code: string): WorkshopCommandResult
{
    return { accepted: false, changed: false, code };
}
