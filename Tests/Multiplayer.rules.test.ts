import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCraftAction, createSharedWork } from '../src/Core/Multiplayer/RoomState';
import type { CraftAction, RoomState } from '../src/Core/Multiplayer/RoomState';
import { DEFAULT_PLAYABLE_PATTERN } from '../src/Core/Gameplay/Board/PlayablePatterns';

function setup()
{
    const pattern = DEFAULT_PLAYABLE_PATTERN;
    const room: RoomState = {
        id: 'room', name: 'test', hostId: 'a', members: ['a', 'b'], version: 0,
        work: createSharedWork(pattern, 'work', 'test-signature'), ironLease: null, proposal: null
    };
    const index = pattern.targetNumbers.findIndex(Boolean);
    function apply(actor: string, action: CraftAction)
    {
        return applyCraftAction(room, pattern, actor, action, 1000, 'lease', 'artwork');
    }
    function paint(actor: string, strokeId: string, color: number)
    {
        return apply(actor, { type: 'paint', strokeId, edits: [{ index, color, expectedVersion: room.work.cellVersions[index] }] });
    }
    return { room, index, apply, paint };
}

test('successive own strokes undo and redo in order without falsely treating own undo as a conflict', () =>
{
    const f = setup();
    f.paint('a', 'one', 1);
    f.apply('a', { type: 'endStroke' });
    f.paint('a', 'two', 2);
    f.apply('a', { type: 'endStroke' });
    f.apply('a', { type: 'undo' });
    assert.equal(f.room.work.cells[f.index], 1);
    assert.deepEqual(f.apply('a', { type: 'undo' }), []);
    assert.equal(f.room.work.cells[f.index], 0);
    f.apply('a', { type: 'redo' });
    assert.equal(f.room.work.cells[f.index], 1);
    f.apply('a', { type: 'redo' });
    assert.equal(f.room.work.cells[f.index], 2);
});

test('a collaborator changing a cell away and back still invalidates an older undo', () =>
{
    const f = setup();
    f.paint('a', 'one', 1);
    f.apply('a', { type: 'endStroke' });
    f.paint('b', 'two', 2);
    f.paint('b', 'three', 1);
    assert.deepEqual(f.apply('a', { type: 'undo' }), [f.index]);
    assert.equal(f.room.work.cells[f.index], 1);
});

test('extending a held stroke across an intervening collaborator edit restores that collaborator value', () =>
{
    const f = setup();
    f.paint('a', 'one', 1);
    f.paint('b', 'two', 2);
    f.paint('a', 'one', 3);
    f.apply('a', { type: 'undo' });
    assert.equal(f.room.work.cells[f.index], 2);
});
