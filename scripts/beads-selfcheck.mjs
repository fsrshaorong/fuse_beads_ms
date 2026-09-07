import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const url = process.env.ATELIER_URL ?? 'http://127.0.0.1:5173/';
const output = new URL('../artifacts/beads/', import.meta.url);
const strawberryId = 'atelier-strawberry-charm-29-v1';
const saveKey = 'fuse-beads.web-playground.v1';
const errors = [];
const checks = [];
const measurements = {};
let browser;
let context;
let page;

await mkdir(output, { recursive: true });

const read = () => page.evaluate(() => window.beadsAtelier.read());
const metrics = () => page.evaluate(() => window.beadsAtelier.metrics());
const dispatch = (command) => page.evaluate((value) => window.beadsAtelier.dispatch(value), command);
const waitMode = (mode) => page.waitForFunction((expected) => window.beadsAtelier.read().mode === expected, mode);
const snapshot = (name) => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });

function passed(check)
{
    checks.push(check);
    process.stdout.write(`PASS ${check}\n`);
}

function assertModelDimensions(model)
{
    assert.equal(model.source, 'Blender GLB', 'rendered geometry comes from the Blender asset');
    // GLB positions use float32; 0.001 mm is substantially below a manufacturing tolerance.
    assert.ok(Math.abs(model.diameterMm - 4.77) < 0.001, `actual diameter: ${model.diameterMm} mm`);
    assert.ok(Math.abs(model.heightMm - 5.07) < 0.001, `actual height: ${model.heightMm} mm`);
    assert.ok(Math.abs(model.bottomMm) < 0.001, `actual bottom: ${model.bottomMm} mm`);
    assert.equal(model.pegCount, 841, 'the physical board always has 29 × 29 pegs');
    assert.ok(Math.abs(model.pitchMm - 5) < 0.001, `actual peg pitch: ${model.pitchMm} mm`);
}

async function assertModels(rawCount, fusedCount, label)
{
    // Scene projection happens on animation frames, after the application command.
    await page.waitForFunction(([raw, fused]) =>
    {
        const model = window.beadsAtelier.metrics().beadModels;
        return model.rawCount === raw && model.fusedCount === fused;
    }, [rawCount, fusedCount]);
    const current = await metrics();
    assert.equal(current.webglError, 0, `no WebGL error at ${label}`);
    assertModelDimensions(current.beadModels);
    measurements[label] = current.beadModels;
}

async function focusBoard()
{
    await page.keyboard.press('KeyE');
    await waitMode('tabletop');
    await page.getByRole('button', { name: '开始拼豆', exact: true }).click();
    await waitMode('beadwork');
    await page.waitForTimeout(180);
}

async function waitSaved(stage, coverageCount)
{
    await page.waitForFunction(({ key, expectedStage, expectedCount }) =>
    {
        const serialized = localStorage.getItem(key);

        if (serialized === null)
        {
            return false;
        }

        const save = JSON.parse(serialized);
        const draft = save.drafts.find((candidate) => candidate.patternId === save.activePatternId);
        return draft?.stage === expectedStage && draft.ironCoverage.filter(Boolean).length === expectedCount;
    }, { key: saveKey, expectedStage: stage, expectedCount: coverageCount });
}

try
{
    browser = await chromium.launch({
        executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true
    });
    // An ephemeral context has its own cookies and localStorage; never attach to a user's tab.
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) =>
    {
        if (message.type() === 'error')
        {
            errors.push(message.text());
        }
    });
    await page.goto(url);
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready === true);
    const initial = await read();
    assert.equal(initial.mode, 'workshop');
    assert.equal(initial.pattern.patternId, strawberryId);
    assert.equal(initial.pattern.width, 29);
    assert.equal(initial.pattern.height, 29);
    assert.equal(initial.pattern.targetNumbers.filter((value) => value > 0).length, 320);
    assert.equal(initial.pattern.targetNumbers.filter((value) => value === 0).length, 521);
    assert.equal(initial.board.cells.filter(Boolean).length, 0);
    assert.equal(initial.finishedArtworks.length, 0);
    await assertModels(0, 0, 'new-visitor');
    passed('new visitor receives the empty 29 × 29 strawberry and real-size Blender bead kit');

    await focusBoard();
    assert.equal((await read()).board.cells.filter(Boolean).length, 0, 'entering the board places no bead');
    const row = { y: 10, fromX: 8, toX: 22, color: 1 };
    const expectedRow = Array.from({ length: 841 }, () => 0);

    for (let x = row.fromX; x <= row.toX; x += 1)
    {
        assert.equal(initial.pattern.targetNumbers[row.y * 29 + x], row.color, 'fixture is a continuous red row');
        expectedRow[row.y * 29 + x] = row.color;
    }

    const points = await page.evaluate(({ y, fromX, toX }) => ({
        from: window.beadsAtelier.projectCell(fromX, y),
        to: window.beadsAtelier.projectCell(toX, y)
    }), row);
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 2 });
    await page.mouse.up();
    assert.deepEqual((await read()).board.cells, expectedRow, 'physical fast drag hits only the intended 15 cells');
    await assertModels(15, 0, 'physical-29-grid-drag');
    passed('real mouse drag hits 15 consecutive cells on the 29-grid without gaps or stray beads');

    await page.waitForFunction((key) =>
    {
        const save = JSON.parse(localStorage.getItem(key) ?? 'null');
        const draft = save?.drafts.find((candidate) => candidate.patternId === save.activePatternId);
        return draft?.cells.filter(Boolean).length === 15;
    }, saveKey);
    const originalSave = await page.evaluate((key) => localStorage.getItem(key), saveKey);
    const changedSave = JSON.parse(originalSave);
    const restoredDraft = changedSave.drafts.find((candidate) => candidate.patternId === strawberryId);
    const extraIndex = initial.pattern.targetNumbers.findIndex((number, index) => number > 0 && expectedRow[index] === 0);
    restoredDraft.cells[extraIndex] = initial.pattern.targetNumbers[extraIndex];
    await dispatch({ type: 'restore', serialized: originalSave });
    assert.equal((await read()).board.revision, 0);
    await assertModels(15, 0, 'first-live-restore');
    await dispatch({ type: 'restore', serialized: JSON.stringify(changedSave) });
    assert.equal((await read()).board.revision, 0, 'restored boards reuse local revision zero');
    await assertModels(16, 0, 'second-live-restore');
    await dispatch({ type: 'restore', serialized: originalSave });
    await assertModels(15, 0, 'original-live-restore');
    await focusBoard();
    passed('consecutive live restores refresh rendered instances even when local revisions and stages match');

    await dispatch({ type: 'selectPattern', patternId: 'pixel-heart' });
    assert.equal((await read()).pattern.width, 16);
    await dispatch({ type: 'selectColor', colorNumber: 1 });
    await dispatch({ type: 'beginStroke', x: 3, y: 5 });
    await dispatch({ type: 'endStroke' });
    await assertModels(1, 0, 'legacy-16-grid');

    for (const key of ['source', 'diameterMm', 'heightMm', 'bottomMm', 'pegCount', 'pitchMm'])
    {
        assert.equal(measurements['legacy-16-grid'][key], measurements['physical-29-grid-drag'][key],
            `${key} is independent from the selected pattern resolution`);
    }

    await dispatch({ type: 'selectPattern', patternId: strawberryId });
    assert.deepEqual((await read()).board.cells, expectedRow, 'the strawberry draft survives the pattern round trip');
    await assertModels(15, 0, 'restored-strawberry-draft');
    passed('16-grid and 29-grid use identical physical beads and preserve independent drafts');

    await page.evaluate(() =>
    {
        const app = window.beadsAtelier;
        const model = app.read();

        for (let index = 0; index < model.pattern.targetNumbers.length; index += 1)
        {
            const colorNumber = model.pattern.targetNumbers[index];

            if (colorNumber > 0 && app.read().board.cells[index] !== colorNumber)
            {
                app.dispatch({ type: 'selectColor', colorNumber });
                app.dispatch({ type: 'beginStroke', x: index % 29, y: Math.floor(index / 29) });
                app.dispatch({ type: 'endStroke' });
            }
        }
    });
    assert.equal((await read()).stage, 'ready');
    assert.deepEqual((await read()).board.cells, initial.pattern.targetNumbers, 'the strawberry has no filled background');
    await assertModels(320, 0, 'complete-raw-strawberry');
    await page.mouse.move(30, 650);
    await page.waitForTimeout(250);
    await snapshot('raw-full');
    await page.mouse.move(480, 350);
    await page.mouse.wheel(0, -600);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(650);
    assert.ok((await metrics()).zoom > 0.3, 'the close-up screenshot is physically zoomed in');
    await page.mouse.move(30, 650);
    await snapshot('raw-close');
    passed('320 unfused beads form the transparent-background strawberry; full and close-up captures saved');

    await page.getByRole('button', { name: '回到桌边 ↗' }).click();
    await waitMode('tabletop');
    await page.getByRole('button', { name: '开始拼豆', exact: true }).click();
    await waitMode('beadwork');
    await page.getByRole('button', { name: '开始熨烫 →', exact: true }).click();
    await page.mouse.move(30, 650);
    assert.equal((await read()).stage, 'ironing');
    await assertModels(320, 0, 'ironing-before-coverage');
    await dispatch({ type: 'ironCell', x: 14, y: 2 });
    assert.equal((await read()).ironCoverage.filter(Boolean).length, 1);
    await assertModels(319, 1, 'one-covered-cell');
    await waitSaved('ironing', 1);
    await page.reload();
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready === true);
    const restored = await read();
    assert.equal(restored.mode, 'workshop');
    assert.equal(restored.pattern.patternId, strawberryId);
    assert.equal(restored.stage, 'ironing');
    assert.equal(restored.ironCoverage.filter(Boolean).length, 1);
    assert.deepEqual(restored.board.cells, initial.pattern.targetNumbers);
    await assertModels(319, 1, 'one-covered-cell-after-reload');
    await focusBoard();
    await assertModels(319, 1, 'one-covered-cell-after-refocus');
    await snapshot('partial-ironing');
    passed('one covered cell swaps one raw mesh for one fused mesh and survives save/reload/refocus');

    await page.evaluate(() =>
    {
        const app = window.beadsAtelier;
        const targets = app.read().pattern.targetNumbers;

        for (let index = 0; index < targets.length; index += 1)
        {
            if (targets[index] > 0)
            {
                app.dispatch({ type: 'ironCell', x: index % 29, y: Math.floor(index / 29) });
            }
        }
    });
    const finished = await read();
    assert.equal(finished.stage, 'finished');
    assert.equal(finished.ironProgress, 1);
    assert.equal(finished.finishedArtworks.length, 1);
    assert.equal(finished.finishedArtworks[0].patternId, strawberryId);
    assert.equal(finished.finishedArtworks[0].width, 29);
    assert.equal(finished.finishedArtworks[0].height, 29);
    assert.deepEqual(finished.finishedArtworks[0].cells, initial.pattern.targetNumbers);
    await dispatch({ type: 'ironCell', x: 14, y: 2 });
    assert.equal((await read()).finishedArtworks.length, 1, 'repeated coverage cannot duplicate a finished piece');
    await assertModels(0, 320, 'complete-fused-strawberry');
    await page.mouse.move(30, 650);
    await page.waitForTimeout(250);
    await snapshot('fused-full');
    await page.getByRole('button', { name: '回到桌边 ↗' }).click();
    await waitMode('tabletop');
    await page.keyboard.press('KeyE');
    await waitMode('workshop');
    await page.waitForTimeout(250);
    await snapshot('gallery');
    await page.getByRole('button', { name: '我的作品', exact: true }).click();
    assert.equal(await page.locator('#collection-grid > *').count(), 1);
    await snapshot('collection');
    await page.locator('.collection-dialog [data-close]').click();
    await waitSaved('finished', 320);
    passed('all 320 beads use the fused mesh; one matching collectible appears after return to the workshop');

    assert.equal((await metrics()).webglError, 0);
    assert.deepEqual(errors, [], 'browser, asset loading and shader compilation have no console errors');
    passed('zero console, page and WebGL errors');
    const report = { passed: true, url, viewport: '1280x720', checks, measurements, errors };
    await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
catch (error)
{
    if (page !== undefined && !page.isClosed())
    {
        await snapshot('failure').catch(() => undefined);
    }
    await writeFile(new URL('report.json', output), `${JSON.stringify({
        passed: false, url, checks, measurements, error: String(error), errors
    }, null, 4)}\n`);
    throw error;
}
finally
{
    try
    {
        await context?.close();
    }
    finally
    {
        await browser?.close();
    }
}
