import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WorkshopApplication } from '../src/App/WorkshopApplication.ts';
import { DETAILED_PATTERN_CATALOG, LEGACY_COMPLEX_PATTERN_IDS } from '../src/Core/Gameplay/Board/DetailedPatterns.ts';
import { PLAYABLE_PATTERN_CATALOG } from '../src/Core/Gameplay/Board/PlayablePatterns.ts';
import { getBeadColor, getBeadColorName } from '../src/Rendering/BeadPalette.ts';

test('complex editions contain connected 50-grid cutouts, readable extents and usable numbered palettes', () =>
{
    assert.equal(DETAILED_PATTERN_CATALOG.length, 7);
    for (const pattern of DETAILED_PATTERN_CATALOG)
    {
        assert.equal(pattern.width, 50);
        assert.equal(pattern.height, 50);
        assert.equal(pattern.targetNumbers.length, 2500);
        const occupied = pattern.targetNumbers.flatMap((n, i) => n > 0 ? [i] : []);
        const seen = new Set([occupied[0]]);
        const queue = [occupied[0]];
        for (let head = 0; head < queue.length; head += 1)
        {
            const index = queue[head], x = index % 50, y = Math.floor(index / 50);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]])
            {
                const next = ny * 50 + nx;
                if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && pattern.targetNumbers[next] > 0 && !seen.has(next))
                {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        assert.equal(seen.size, occupied.length, `${pattern.name}: no floating islands`);
        assert.ok(occupied.length >= 1000, `${pattern.name}: meaningful colored detail`);
        for (const coordinate of [occupied.map((i) => i % 50), occupied.map((i) => Math.floor(i / 50))])
        {
            assert.ok(Math.max(...coordinate) - Math.min(...coordinate) + 1 >= 34, `${pattern.name}: content fills at least two thirds of each axis`);
        }
        assert.ok(pattern.palette.length <= 9);
        assert.deepEqual([...new Set(pattern.targetNumbers)].filter(Boolean).sort(), pattern.palette.map((entry) => entry.number));
        for (const entry of pattern.palette)
        {
            assert.notEqual(getBeadColor(entry.colorId), '#bba1b2');
            assert.notEqual(getBeadColorName(entry.colorId), entry.colorId);
        }
    }
});

test('all fifteen old patterns keep their complete signatures while detailed editions get independent drafts', () =>
{
    const newIds = new Set(DETAILED_PATTERN_CATALOG.map((p) => p.patternId));
    const old = PLAYABLE_PATTERN_CATALOG.filter((p) => !newIds.has(p.patternId)).sort((a, b) => a.patternId.localeCompare(b.patternId));
    assert.equal(old.length, 15);
    assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'),
        '1f2645fc8065aa6a735f732e004c848b09f39a87090f8290d4f53655125cde0f');
    assert.ok(LEGACY_COMPLEX_PATTERN_IDS.every((id) => old.some((p) => p.patternId === id)));
    const app = new WorkshopApplication();
    for (const pattern of [...old, ...DETAILED_PATTERN_CATALOG])
    {
        assert.equal(app.dispatch({ type: 'selectPattern', patternId: pattern.patternId }).accepted, true);
    }
    const save = app.exportSave();
    const restored = new WorkshopApplication();
    assert.equal(restored.dispatch({ type: 'restore', serialized: save }).accepted, true);
    assert.equal(restored.exportSave(), save, 'all old and new drafts coexist in the unchanged save schema');
});
