import type { NumberedBeadPattern } from '../Gameplay/Board/NumberedBeadBoard';

export interface CellEdit
{
    index: number;
    color: number;
    expectedVersion: number;
}

export interface CellChange
{
    index: number;
    before: number;
    beforeVersion: number;
    after: number;
    version: number;
}

export interface Stroke
{
    id: string;
    changes: CellChange[];
}

export interface PlayerHistory
{
    active: Stroke | null;
    undo: Stroke[];
    redo: Stroke[];
}

export interface SharedWork
{
    id: string;
    patternId: string;
    patternSignature: string;
    cells: number[];
    cellVersions: number[];
    stage: 'editing' | 'ready' | 'ironing' | 'finished';
    coverage: boolean[];
    histories: Record<string, PlayerHistory>;
    contributors: string[];
    artworkId: string | null;
}

export interface IronLease
{
    playerId: string;
    token: string;
    expiresAt: number;
}

export interface PatternProposal
{
    id: string;
    patternId: string;
    draftId: string | null;
    voters: string[];
    approvals: string[];
    expiresAt: number;
}

export interface RoomState
{
    id: string;
    name: string;
    hostId: string;
    version: number;
    members: string[];
    work: SharedWork;
    ironLease: IronLease | null;
    proposal: PatternProposal | null;
}

export type CraftAction =
    | { type: 'paint'; strokeId: string; edits: CellEdit[] }
    | { type: 'endStroke' | 'undo' | 'redo' }
    | { type: 'acquireIron' }
    | { type: 'iron'; leaseToken: string; indices: number[] }
    | { type: 'releaseIron'; leaseToken: string };

/** A signature changes whenever a numbered pattern or palette changes. */
export function patternContent(pattern: NumberedBeadPattern): string
{
    return JSON.stringify([pattern.patternId, pattern.width, pattern.height, pattern.palette, pattern.targetNumbers]);
}

export function createSharedWork(pattern: NumberedBeadPattern, id: string, signature: string): SharedWork
{
    return {
        id, patternId: pattern.patternId, patternSignature: signature,
        cells: pattern.targetNumbers.map(() => 0),
        cellVersions: pattern.targetNumbers.map(() => 0),
        coverage: pattern.targetNumbers.map(() => false),
        stage: 'editing', histories: {}, contributors: [], artworkId: null
    };
}

export class RoomRuleError extends Error
{
    public constructor(public readonly code: string)
    {
        super(code);
    }
}

function requireRule(condition: boolean, code: string): void
{
    if (!condition)
    {
        throw new RoomRuleError(code);
    }
}

export function closeStroke(history: PlayerHistory): void
{
    if (history.active !== null && history.active.changes.length > 0)
    {
        history.undo.push(history.active);
        history.undo = history.undo.slice(-30);
    }
    history.active = null;
}

/** Mutates only a caller-owned candidate. Hosts commit it atomically or discard it on rejection. */
export function applyCraftAction(
    room: RoomState,
    pattern: NumberedBeadPattern,
    actor: string,
    action: CraftAction,
    now: number,
    newLeaseToken: string,
    newArtworkId: string
): number[]
{
    const work = room.work;
    const skipped: number[] = [];
    const history = work.histories[actor] ??= { active: null, undo: [], redo: [] };
    const version = room.version + 1;
    if (action.type === 'paint')
    {
        requireRule(work.stage === 'editing' || work.stage === 'ready', 'work-read-only');
        requireRule(action.edits.length > 0 && action.edits.length <= 128, 'invalid-edits');
        requireRule(new Set(action.edits.map((edit) => edit.index)).size === action.edits.length, 'duplicate-cell');
        for (const edit of action.edits)
        {
            requireRule(Number.isInteger(edit.index) && edit.index >= 0 && edit.index < work.cells.length
                && pattern.targetNumbers[edit.index] !== 0, 'invalid-cell');
            requireRule(Number.isInteger(edit.color) && edit.color >= 0 && edit.color <= pattern.palette.length, 'invalid-color');
            requireRule(Number.isSafeInteger(edit.expectedVersion) && edit.expectedVersion >= 0, 'invalid-version');
        }
        if (history.active?.id !== action.strokeId)
        {
            requireRule(![...history.undo, ...history.redo].some((stroke) => stroke.id === action.strokeId), 'stroke-closed');
            closeStroke(history);
            history.active = { id: action.strokeId, changes: [] };
        }
        const stroke = history.active!;
        for (const edit of action.edits)
        {
            if (work.cellVersions[edit.index] !== edit.expectedVersion)
            {
                skipped.push(edit.index);
                continue;
            }
            if (work.cells[edit.index] === edit.color)
            {
                continue;
            }
            const previous = stroke.changes.find((change) => change.index === edit.index);
            // Preserve a collaborator's intervening value when extending the same held stroke.
            if (previous !== undefined && previous.version === work.cellVersions[edit.index])
            {
                previous.after = edit.color;
                previous.version = version;
            }
            else
            {
                if (previous !== undefined)
                {
                    stroke.changes.splice(stroke.changes.indexOf(previous), 1);
                }
                stroke.changes.push({ index: edit.index, before: work.cells[edit.index],
                    beforeVersion: work.cellVersions[edit.index], after: edit.color, version });
            }
            work.cells[edit.index] = edit.color;
            work.cellVersions[edit.index] = version;
            history.redo = [];
            if (!work.contributors.includes(actor))
            {
                work.contributors.push(actor);
            }
        }
    }
    else if (action.type === 'endStroke')
    {
        closeStroke(history);
    }
    else if (action.type === 'undo' || action.type === 'redo')
    {
        requireRule(work.stage === 'editing' || work.stage === 'ready', 'work-read-only');
        closeStroke(history);
        const source = action.type === 'undo' ? history.undo : history.redo;
        const destination = action.type === 'undo' ? history.redo : history.undo;
        const stroke = source.pop();
        requireRule(stroke !== undefined, 'history-empty');
        const reversed: Stroke = { id: stroke!.id, changes: [] };
        for (const change of stroke!.changes)
        {
            if (work.cellVersions[change.index] !== change.version)
            {
                skipped.push(change.index);
                continue;
            }
            work.cells[change.index] = change.before;
            work.cellVersions[change.index] = version;
            // Follow only this actor's causal chain. Other players' histories are never revived.
            for (const pending of source)
            {
                const ancestor = pending.changes.find((entry) => entry.index === change.index
                    && entry.version === change.beforeVersion);
                if (ancestor !== undefined)
                {
                    ancestor.version = version;
                }
            }
            reversed.changes.push({ index: change.index, before: change.after, beforeVersion: change.version,
                after: change.before, version });
        }
        if (reversed.changes.length > 0)
        {
            destination.push(reversed);
            destination.splice(0, Math.max(0, destination.length - 30));
        }
    }
    else if (action.type === 'acquireIron')
    {
        requireRule(work.stage === 'ready' || work.stage === 'ironing', 'work-not-ready');
        requireRule(room.ironLease === null || room.ironLease.expiresAt <= now
            || room.ironLease.playerId === actor, 'iron-busy');
        for (const entry of Object.values(work.histories))
        {
            closeStroke(entry);
        }
        work.stage = 'ironing';
        room.ironLease = { playerId: actor, token: newLeaseToken, expiresAt: now + 5000 };
    }
    else if (action.type === 'iron' || action.type === 'releaseIron')
    {
        requireRule(work.stage === 'ironing', 'not-ironing');
        requireRule(room.ironLease !== null && room.ironLease.playerId === actor
            && room.ironLease.token === action.leaseToken && room.ironLease.expiresAt > now, 'iron-lease-expired');
        if (action.type === 'releaseIron')
        {
            room.ironLease = null;
        }
        else
        {
            requireRule(action.indices.length > 0 && action.indices.length <= 128, 'invalid-edits');
            for (const index of action.indices)
            {
                requireRule(Number.isInteger(index) && index >= 0 && index < work.cells.length
                    && pattern.targetNumbers[index] !== 0, 'invalid-cell');
                work.coverage[index] = true;
            }
            room.ironLease!.expiresAt = now + 5000;
            if (pattern.targetNumbers.every((target, index) => target === 0 || work.coverage[index]))
            {
                work.stage = 'finished';
                work.artworkId = newArtworkId;
                room.ironLease = null;
            }
        }
    }
    if (work.stage === 'editing' || work.stage === 'ready')
    {
        work.stage = pattern.targetNumbers.every((target, index) => target === 0 || work.cells[index] === target)
            ? 'ready' : 'editing';
    }
    room.version = version;
    return skipped;
}
