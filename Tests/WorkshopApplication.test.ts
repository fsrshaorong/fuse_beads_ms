import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopApplication } from '../src/App/WorkshopApplication.ts';
import { NumberedBeadBoard } from '../src/Core/Gameplay/Board/NumberedBeadBoard.ts';
import { getBeadColor, getBeadColorName } from '../src/Rendering/BeadPalette.ts';

const STRAWBERRY_PATTERN_ID = 'atelier-strawberry-charm-29-v1';
const MINI_STRAWBERRY_PATTERN_ID = 'atelier-strawberry-mini-50-v1';

test('the world, tabletop and board share one draft while transitions reject drawing', () =>
{
    const app = new WorkshopApplication();
    app.dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    assert.equal(app.getReadModel().mode, 'workshop');
    assert.equal(app.dispatch({ type: 'focus' }).accepted, false);
    assert.equal(app.dispatch({ type: 'sit' }).accepted, true);
    assert.equal(app.getReadModel().transition?.to, 'tabletop');
    assert.equal(app.dispatch({ type: 'beginStroke', x: 3, y: 3 }).accepted, false);
    app.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    assert.equal(app.getReadModel().mode, 'tabletop');
    app.dispatch({ type: 'focus' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.4 });
    assert.equal(app.getReadModel().mode, 'beadwork');
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    app.dispatch({ type: 'retreat' });
    assert.equal(app.getReadModel().strokeActive, false);
    app.dispatch({ type: 'tick', deltaSeconds: 0.35 });
    app.dispatch({ type: 'stand' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    assert.equal(app.getReadModel().mode, 'workshop');
    assert.equal(app.getReadModel().board.cells[51], 1);
});

test('whole strokes undo and redo, pause leaves a gap, and erasing is reversible', () =>
{
    const app = enterBoard();
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    app.dispatch({ type: 'continueStroke', x: 7, y: 3 });
    app.dispatch({ type: 'pauseStroke' });
    app.dispatch({ type: 'continueStroke', x: 12, y: 3 });
    app.dispatch({ type: 'endStroke' });
    assert.deepEqual(app.getReadModel().board.cells.slice(51, 61), [1, 1, 1, 1, 1, 0, 0, 0, 0, 1]);
    assert.equal(app.dispatch({ type: 'undo' }).accepted, true);
    assert.equal(app.getReadModel().board.cells.filter((cell) => cell !== 0).length, 0);
    app.dispatch({ type: 'redo' });
    app.dispatch({ type: 'selectTool', tool: 'erase' });
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    app.dispatch({ type: 'continueStroke', x: 5, y: 3 });
    app.dispatch({ type: 'endStroke' });
    assert.deepEqual(app.getReadModel().board.cells.slice(51, 56), [0, 0, 0, 1, 1]);
    app.dispatch({ type: 'undo' });
    assert.deepEqual(app.getReadModel().board.cells.slice(51, 56), [1, 1, 1, 1, 1]);
    app.dispatch({ type: 'selectTool', tool: 'place' });
    app.dispatch({ type: 'beginStroke', x: 4, y: 4 });
    app.dispatch({ type: 'selectColor', colorNumber: 2 });
    assert.equal(app.getReadModel().strokeActive, false);
    assert.equal(app.getReadModel().selectedColor, 2);
});

function enterBoard(patternId = 'pixel-heart'): WorkshopApplication
{
    const app = new WorkshopApplication();
    assert.equal(app.dispatch({ type: 'selectPattern', patternId }).accepted, true);
    app.dispatch({ type: 'sit' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    app.dispatch({ type: 'focus' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.4 });
    return app;
}

test('pattern drafts survive save and reload and invalid saves cannot replace existing work', () =>
{
    const app = enterBoard();
    app.dispatch({ type: 'selectColor', colorNumber: 2 });
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    app.dispatch({ type: 'endStroke' });
    app.dispatch({ type: 'retreat' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.35 });
    const secondPattern = app.getReadModel().patterns.find((pattern) => pattern.patternId === 'starter-heart')!;
    assert.equal(app.dispatch({ type: 'selectPattern', patternId: secondPattern.patternId }).accepted, true);
    assert.equal(app.getReadModel().board.cells[51], 0);
    app.dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    assert.equal(app.getReadModel().board.cells[51], 2);
    assert.equal(app.getReadModel().selectedColor, 2);
    const saved = app.exportSave();
    const reloaded = new WorkshopApplication();
    assert.equal(reloaded.dispatch({ type: 'restore', serialized: saved }).accepted, true);
    assert.equal(reloaded.getReadModel().board.cells[51], 2);
    assert.equal(reloaded.getReadModel().selectedColor, 2);
    const before = reloaded.exportSave();
    assert.equal(reloaded.dispatch({ type: 'restore', serialized: '{bad' }).accepted, false);
    assert.equal(reloaded.dispatch({ type: 'restore', serialized: saved.replace('"schemaVersion":1', '"schemaVersion":9') }).accepted, false);
    const corrupted = JSON.parse(saved);
    corrupted.drafts[0].cells[0] = '2';
    assert.equal(reloaded.dispatch({ type: 'restore', serialized: JSON.stringify(corrupted) }).accepted, false);
    assert.equal(reloaded.exportSave(), before);
});

test('the last stroke can be undone before ironing and recovered ironing creates exactly one piece', () =>
{
    const app = enterBoard();
    const pattern = app.getReadModel().pattern;

    for (let index = 0; index < pattern.targetNumbers.length; index += 1)
    {
        const colorNumber = pattern.targetNumbers[index];

        if (colorNumber === 0)
        {
            continue;
        }

        app.dispatch({ type: 'selectColor', colorNumber });
        app.dispatch({ type: 'beginStroke', x: index % pattern.width, y: Math.floor(index / pattern.width) });
        app.dispatch({ type: 'endStroke' });
    }

    assert.equal(app.getReadModel().stage, 'ready');
    assert.equal(app.getReadModel().strokeActive, false);
    app.dispatch({ type: 'undo' });
    assert.equal(app.getReadModel().stage, 'editing');
    app.dispatch({ type: 'redo' });
    assert.equal(app.dispatch({ type: 'startIroning' }).accepted, true);
    app.dispatch({ type: 'ironCell', x: 3, y: 3 });
    assert.ok(app.getReadModel().ironProgress > 0);
    assert.equal(app.dispatch({ type: 'undo' }).accepted, false);
    const reloaded = new WorkshopApplication();
    assert.equal(reloaded.dispatch({ type: 'restore', serialized: app.exportSave() }).accepted, true);
    assert.equal(reloaded.getReadModel().stage, 'ironing');
    reloaded.dispatch({ type: 'sit' });
    reloaded.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    reloaded.dispatch({ type: 'focus' });
    reloaded.dispatch({ type: 'tick', deltaSeconds: 0.4 });

    for (let pass = 0; pass < 2; pass += 1)
    {
        for (let index = 0; index < pattern.targetNumbers.length; index += 1)
        {
            reloaded.dispatch({ type: 'ironCell', x: index % pattern.width, y: Math.floor(index / pattern.width) });
        }
    }

    assert.equal(reloaded.getReadModel().stage, 'finished');
    assert.equal(reloaded.getReadModel().ironProgress, 1);
    assert.equal(reloaded.getReadModel().finishedArtworks.length, 1);
    assert.equal(reloaded.getReadModel().finishedArtworks[0].patternId, 'pixel-heart');
    const restoredFinish = new WorkshopApplication();
    assert.equal(restoredFinish.dispatch({ type: 'restore', serialized: reloaded.exportSave() }).accepted, true);
    assert.equal(restoredFinish.getReadModel().finishedArtworks.length, 1);
    restoredFinish.dispatch({ type: 'reset' });
    assert.equal(restoredFinish.getReadModel().stage, 'editing');
    assert.equal(restoredFinish.getReadModel().finishedArtworks.length, 1);
});

test('world movement is normalized and bounded and sitting requires the local workstation', () =>
{
    const app = new WorkshopApplication();
    app.dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    assert.deepEqual(app.getReadModel().avatar, { x: 0, z: 2.4, yaw: Math.PI });
    assert.equal(app.dispatch({ type: 'move', x: 1, z: 0, deltaSeconds: 1 }).accepted, true);
    assert.equal(app.getReadModel().avatar.x, 2);
    assert.equal(app.dispatch({ type: 'sit' }).accepted, false);
    app.dispatch({ type: 'move', x: -1, z: 0, deltaSeconds: 1 });
    app.dispatch({ type: 'sit' });
    assert.equal(app.dispatch({ type: 'move', x: 1, z: 0, deltaSeconds: 1 }).accepted, false);
    app.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    assert.equal(app.getReadModel().avatar.x, 0);
    assert.equal(app.dispatch({ type: 'move', x: 1, z: 0, deltaSeconds: Number.NaN }).accepted, false);
    app.dispatch({ type: 'stand' });
    app.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    assert.equal(app.getReadModel().avatar.z, 1.8);
    app.dispatch({ type: 'move', x: 1, z: 1, deltaSeconds: 100 });
    assert.deepEqual(app.getReadModel().avatar, { x: 5.5, z: 4.2, yaw: Math.PI / 4 });
});

test('a rejected redo during a fresh stroke does not silently end that stroke', () =>
{
    const app = enterBoard();
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    assert.equal(app.dispatch({ type: 'redo' }).accepted, false);
    assert.equal(app.dispatch({ type: 'continueStroke', x: 4, y: 3 }).accepted, true);
    app.dispatch({ type: 'endStroke' });
    app.dispatch({ type: 'undo' });
    assert.deepEqual(app.getReadModel().board.cells.slice(51, 53), [0, 0]);
});

test('the original strawberry charm keeps its connected silhouette and empty background', () =>
{
    const app = new WorkshopApplication();
    app.dispatch({ type: 'selectPattern', patternId: STRAWBERRY_PATTERN_ID });
    const model = app.getReadModel();
    const pattern = model.pattern;
    assert.equal(pattern.patternId, STRAWBERRY_PATTERN_ID);
    assert.deepEqual([pattern.width, pattern.height], [29, 29]);
    assert.equal(pattern.palette.length, 4);
    assert.equal(pattern.targetNumbers.filter((cell) => cell > 0).length, 320);
    assert.equal(pattern.targetNumbers.filter((cell) => cell === 0).length, 521);
    assert.equal(model.board.cells.every((cell) => cell === 0), true);

    const remaining = new Set(pattern.targetNumbers.flatMap((cell, index) => cell > 0 ? [index] : []));
    const queue = [remaining.values().next().value!];
    remaining.delete(queue[0]);

    for (let cursor = 0; cursor < queue.length; cursor += 1)
    {
        const index = queue[cursor];
        const x = index % pattern.width;
        const y = Math.floor(index / pattern.width);
        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]])
        {
            if (nextX >= 0 && nextX < pattern.width && nextY >= 0 && nextY < pattern.height)
            {
                const nextIndex = nextY * pattern.width + nextX;
                if (remaining.delete(nextIndex))
                {
                    queue.push(nextIndex);
                }
            }
        }
    }

    assert.equal(remaining.size, 0, 'the stem, leaf crown and fruit form one four-connected physical piece');
    assert.equal(pattern.targetNumbers.every((cell, index) => Boolean(cell)
        === Boolean(pattern.targetNumbers[Math.floor(index / 29) * 29 + 28 - index % 29])), true,
    'the outer silhouette is centered and symmetric');
});

test('a legacy-only save restores the original pattern instead of replacing it with the new default', () =>
{
    const legacy = enterBoard();
    legacy.dispatch({ type: 'selectColor', colorNumber: 2 });
    legacy.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    legacy.dispatch({ type: 'endStroke' });
    const oldSave = JSON.parse(legacy.exportSave());
    oldSave.drafts = oldSave.drafts.filter((draft: { patternId: string }) => draft.patternId === 'pixel-heart');
    const restored = new WorkshopApplication();
    assert.equal(restored.dispatch({ type: 'restore', serialized: JSON.stringify(oldSave) }).accepted, true);
    assert.equal(restored.getReadModel().pattern.patternId, 'pixel-heart');
    assert.equal(restored.getReadModel().board.cells[51], 2);
    assert.equal(restored.getReadModel().selectedColor, 2);
    assert.equal(JSON.parse(restored.exportSave()).schemaVersion, 1);
});

test('new visitors receive the detailed 50-grid Mini strawberry with six independent colors', () =>
{
    const model = new WorkshopApplication().getReadModel();
    const pattern = model.pattern;
    assert.equal(pattern.patternId, MINI_STRAWBERRY_PATTERN_ID);
    assert.equal(model.patterns[0].patternId, MINI_STRAWBERRY_PATTERN_ID);
    assert.equal(pattern.name, '莓果小物');
    assert.deepEqual([pattern.width, pattern.height], [50, 50]);
    assert.equal(pattern.palette.length, 6);
    assert.equal(model.board.targetCellCount, 1159);
    assert.equal(pattern.targetNumbers.filter((value) => value === 0).length, 1341);
    assert.equal(model.board.cells.every((value) => value === 0), true);
    assert.deepEqual(pattern.palette.map((entry) => getBeadColor(entry.colorId)),
        ['#A92F45', '#E75463', '#F78889', '#326A49', '#76A85F', '#F9DE99']);
    assert.deepEqual(pattern.palette.map((entry) => getBeadColorName(entry.colorId)),
        ['莓果深红', '草莓红', '果肉粉', '叶脉深绿', '新叶绿', '奶油籽']);

    const occupied = pattern.targetNumbers.flatMap((value, index) => value > 0 ? [index] : []);
    const xs = occupied.map((index) => index % pattern.width);
    const ys = occupied.map((index) => Math.floor(index / pattern.width));
    assert.deepEqual([Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1], [40, 44]);
    const remaining = new Set(occupied);
    const queue = [occupied[0]];
    remaining.delete(queue[0]);

    for (let cursor = 0; cursor < queue.length; cursor += 1)
    {
        const x = queue[cursor] % pattern.width;
        const y = Math.floor(queue[cursor] / pattern.width);

        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]])
        {
            if (nextX >= 0 && nextX < pattern.width && nextY >= 0 && nextY < pattern.height
                && remaining.delete(nextY * pattern.width + nextX))
            {
                queue.push(nextY * pattern.width + nextX);
            }
        }
    }

    assert.equal(remaining.size, 0, 'all Mini beads belong to one four-connected physical piece');
});

test('numbered boards support the 52-grid kit boundary and reject dimensions beyond it', () =>
{
    const pattern = {
        patternId: 'test-52-grid-boundary', name: 'Boundary board', width: 52, height: 52,
        palette: [{ colorId: 'red', number: 1 }], targetNumbers: Array.from({ length: 52 * 52 }, () => 1)
    };
    const board = new NumberedBeadBoard(pattern);
    assert.equal(board.fillCell(51, 51, 1).accepted, true);
    assert.equal(board.getReadModel().cells[52 * 52 - 1], 1);
    assert.equal(board.fillCell(52, 51, 1).accepted, false);
    assert.equal(board.fillCell(51, 52, 1).accepted, false);
    assert.throws(() => new NumberedBeadBoard({
        ...pattern, width: 53, targetNumbers: Array.from({ length: 53 * 52 }, () => 1)
    }), RangeError);
    assert.throws(() => new NumberedBeadBoard({
        ...pattern, height: 53, targetNumbers: Array.from({ length: 52 * 53 }, () => 1)
    }), RangeError);
});

test('a save containing only the original 29-grid draft restores without injecting the Mini default', () =>
{
    const legacy = enterBoard(STRAWBERRY_PATTERN_ID);
    legacy.dispatch({ type: 'selectColor', colorNumber: 3 });
    legacy.dispatch({ type: 'beginStroke', x: 14, y: 2 });
    legacy.dispatch({ type: 'endStroke' });
    const saved = JSON.parse(legacy.exportSave());
    saved.drafts = saved.drafts.filter((draft: { patternId: string }) => draft.patternId === STRAWBERRY_PATTERN_ID);
    const serialized = JSON.stringify(saved);
    const restored = new WorkshopApplication();
    assert.equal(restored.getReadModel().pattern.patternId, MINI_STRAWBERRY_PATTERN_ID);
    assert.equal(restored.dispatch({ type: 'restore', serialized }).accepted, true);
    assert.equal(restored.getReadModel().pattern.patternId, STRAWBERRY_PATTERN_ID);
    assert.equal(restored.getReadModel().board.cells[2 * 29 + 14], 3);
    assert.equal(restored.getReadModel().selectedColor, 3);
    assert.equal(restored.exportSave(), serialized, 'legacy schema, signatures and drafts round trip unchanged');
});

test('the 1159-bead Mini cutout completes, restores partial ironing and collects one persistent piece', () =>
{
    const app = enterBoard(MINI_STRAWBERRY_PATTERN_ID);
    const pattern = app.getReadModel().pattern;

    for (let index = 0; index < pattern.targetNumbers.length; index += 1)
    {
        const colorNumber = pattern.targetNumbers[index];

        if (colorNumber > 0)
        {
            assert.equal(app.dispatch({ type: 'selectColor', colorNumber }).accepted, true);
            assert.equal(app.dispatch({ type: 'beginStroke', x: index % 50, y: Math.floor(index / 50) }).accepted, true);
            app.dispatch({ type: 'endStroke' });
        }
    }

    assert.equal(app.getReadModel().stage, 'ready');
    assert.equal(app.getReadModel().board.correctCellCount, 1159);
    assert.deepEqual(app.getReadModel().board.cells, pattern.targetNumbers);
    assert.equal(app.dispatch({ type: 'startIroning' }).accepted, true);
    const first = pattern.targetNumbers.findIndex((value) => value > 0);
    assert.equal(app.dispatch({ type: 'ironCell', x: first % 50, y: Math.floor(first / 50) }).accepted, true);
    const restored = new WorkshopApplication();
    assert.equal(restored.dispatch({ type: 'restore', serialized: app.exportSave() }).accepted, true);
    assert.equal(restored.getReadModel().stage, 'ironing');
    assert.equal(restored.getReadModel().ironCoverage.filter(Boolean).length, 1);
    restored.dispatch({ type: 'sit' });
    restored.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    restored.dispatch({ type: 'focus' });
    restored.dispatch({ type: 'tick', deltaSeconds: 0.4 });

    for (let index = 0; index < pattern.targetNumbers.length; index += 1)
    {
        assert.equal(restored.dispatch({ type: 'ironCell', x: index % 50, y: Math.floor(index / 50) }).accepted, true);
    }

    assert.equal(restored.getReadModel().stage, 'finished');
    const pieces = restored.getReadModel().finishedArtworks;
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].patternId, MINI_STRAWBERRY_PATTERN_ID);
    assert.deepEqual([pieces[0].width, pieces[0].height], [50, 50]);
    assert.deepEqual(pieces[0].cells, pattern.targetNumbers, 'transparent background stays absent in the finished cutout');
    const finalReload = new WorkshopApplication();
    assert.equal(finalReload.dispatch({ type: 'restore', serialized: restored.exportSave() }).accepted, true);
    assert.equal(finalReload.getReadModel().stage, 'finished');
    assert.deepEqual(finalReload.getReadModel().finishedArtworks, pieces);
    assert.equal(finalReload.dispatch({ type: 'ironCell', x: first % 50, y: Math.floor(first / 50) }).accepted, true);
    assert.equal(finalReload.getReadModel().finishedArtworks.length, 1);
    finalReload.dispatch({ type: 'selectPattern', patternId: STRAWBERRY_PATTERN_ID });
    finalReload.dispatch({ type: 'selectPattern', patternId: MINI_STRAWBERRY_PATTERN_ID });
    assert.equal(finalReload.getReadModel().stage, 'finished');
    assert.deepEqual(finalReload.getReadModel().board.cells, pattern.targetNumbers);
    assert.deepEqual(finalReload.getReadModel().finishedArtworks, pieces);
});

test('the strawberry draft, legacy draft and finished cutout survive collection and save round trips', () =>
{
    const app = enterBoard(STRAWBERRY_PATTERN_ID);
    app.dispatch({ type: 'selectColor', colorNumber: 3 });
    app.dispatch({ type: 'beginStroke', x: 14, y: 2 });
    app.dispatch({ type: 'endStroke' });
    app.dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    app.dispatch({ type: 'selectColor', colorNumber: 2 });
    app.dispatch({ type: 'beginStroke', x: 3, y: 3 });
    app.dispatch({ type: 'endStroke' });
    const restored = new WorkshopApplication();
    assert.equal(restored.dispatch({ type: 'restore', serialized: app.exportSave() }).accepted, true);
    assert.equal(restored.getReadModel().pattern.patternId, 'pixel-heart');
    assert.equal(restored.getReadModel().board.cells[51], 2);
    restored.dispatch({ type: 'selectPattern', patternId: STRAWBERRY_PATTERN_ID });
    assert.equal(restored.getReadModel().board.cells[2 * 29 + 14], 3);
    restored.dispatch({ type: 'sit' });
    restored.dispatch({ type: 'tick', deltaSeconds: 0.6 });
    restored.dispatch({ type: 'focus' });
    restored.dispatch({ type: 'tick', deltaSeconds: 0.4 });
    const pattern = restored.getReadModel().pattern;
    for (let index = 0; index < pattern.targetNumbers.length; index += 1)
    {
        const colorNumber = pattern.targetNumbers[index];
        if (colorNumber > 0)
        {
            restored.dispatch({ type: 'selectColor', colorNumber });
            restored.dispatch({ type: 'beginStroke', x: index % 29, y: Math.floor(index / 29) });
            restored.dispatch({ type: 'endStroke' });
        }
    }
    assert.equal(restored.getReadModel().stage, 'ready');
    assert.deepEqual(restored.getReadModel().board.cells, pattern.targetNumbers);
    assert.equal(restored.dispatch({ type: 'startIroning' }).accepted, true);
    for (let index = 0; index < pattern.targetNumbers.length; index += 1)
    {
        restored.dispatch({ type: 'ironCell', x: index % 29, y: Math.floor(index / 29) });
    }
    const piece = restored.getReadModel().finishedArtworks[0];
    assert.equal(restored.getReadModel().stage, 'finished');
    assert.deepEqual([piece.width, piece.height], [29, 29]);
    assert.equal(piece.patternId, STRAWBERRY_PATTERN_ID);
    assert.deepEqual(piece.cells, pattern.targetNumbers, 'the finished piece does not manufacture a rectangular background');
    const finalReload = new WorkshopApplication();
    assert.equal(finalReload.dispatch({ type: 'restore', serialized: restored.exportSave() }).accepted, true);
    assert.deepEqual(finalReload.getReadModel().finishedArtworks, [piece]);
    assert.equal(finalReload.getReadModel().stage, 'finished');
    finalReload.dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    assert.equal(finalReload.getReadModel().board.cells[51], 2);
    assert.equal(finalReload.getReadModel().finishedArtworks.length, 1);
});
