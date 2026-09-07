import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) =>
{
    if (message.type() === 'error')
    {
        errors.push(message.text());
    }
});
const read = () => page.evaluate(() => window.beadsAtelier.read());
const waitMode = (mode) => page.waitForFunction((expected) => window.beadsAtelier.read().mode === expected, mode);
const snapshot = async (name) => page.screenshot({ path: new URL(name, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

try
{
    await page.goto(process.env.ATELIER_URL ?? 'http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready === true);
    await page.waitForTimeout(650);
    const stillFrame = await page.locator('.world-canvas').screenshot();
    await page.waitForTimeout(700);
    assert.ok((await page.locator('.world-canvas').screenshot()).equals(stillFrame),
        'the idle workshop has no model, brush, or camera wobble');
    await page.getByRole('button', { name: '美术调色', exact: true }).click();
    await page.locator('#brush-control').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#brush-control').inputValue(), '0');
    await page.locator('.settings-dialog [data-close]').click();
    const withoutBrush = await page.locator('.world-canvas').screenshot();
    assert.ok(!withoutBrush.equals(stillFrame), 'the brush slider changes the rendered scene');
    await page.getByRole('button', { name: '美术调色', exact: true }).click();
    await page.getByRole('button', { name: '恢复参考效果', exact: true }).click();
    assert.equal(await page.locator('#brush-control').inputValue(), '0.5');
    assert.equal(await page.locator('#warmth-control').inputValue(), '1');
    assert.equal(await page.locator('#shadow-control').inputValue(), '0.92');
    await page.locator('.settings-dialog [data-close]').click();
    assert.ok((await page.locator('.world-canvas').screenshot()).equals(stillFrame),
        'restoring the reference preset restores the exact idle frame');
    await page.getByRole('button', { name: '美术调色', exact: true }).click();
    await page.locator('#outline-enabled').uncheck();
    assert.equal((await page.evaluate(() => window.beadsAtelier.metrics())).outlineEnabled, false);
    await page.locator('.settings-dialog [data-close]').click();
    assert.ok(!(await page.locator('.world-canvas').screenshot()).equals(stillFrame),
        'outlines are visibly present in the default workshop');
    await page.getByRole('button', { name: '美术调色', exact: true }).click();
    await page.getByRole('button', { name: '恢复参考效果', exact: true }).click();
    assert.equal(await page.locator('#outline-enabled').isChecked(), true);
    assert.equal(await page.locator('#outline-control').inputValue(), '1');
    await page.locator('.settings-dialog [data-close]').click();
    assert.ok((await page.locator('.world-canvas').screenshot()).equals(stillFrame),
        'the outline reset restores the exact default workshop');
    await snapshot('01-workshop.png');
    const start = await read();
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(170);
    await page.keyboard.up('KeyD');
    assert.ok((await read()).avatar.x > start.avatar.x, 'real WASD moves the avatar');
    await page.keyboard.press('KeyE');
    await waitMode('tabletop');
    await page.waitForTimeout(150);
    await snapshot('02-tabletop.png');
    const center = await page.evaluate(() => window.beadsAtelier.projectCell(8, 8));
    await page.mouse.click(center.x, center.y);
    await waitMode('beadwork');
    assert.equal((await read()).board.cells.filter((value) => value !== 0).length, 0, 'entry click is consumed');
    await page.waitForTimeout(160);
    await snapshot('03-full-board.png');
    const cells = await page.evaluate(() => ({ from: window.beadsAtelier.projectCell(3, 5), to: window.beadsAtelier.projectCell(12, 5) }));
    await page.mouse.move(cells.from.x, cells.from.y);
    await page.mouse.down();
    await page.mouse.move(cells.to.x, cells.to.y, { steps: 2 });
    await page.mouse.up();
    assert.equal((await read()).board.correctCellCount, 10, 'physical fast drag interpolates all ten cells');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await read()).board.correctCellCount, 0, 'undo removes the entire stroke');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await read()).board.correctCellCount, 10, 'redo restores the stroke');
    await page.mouse.move(480, 350);
    await page.mouse.wheel(0, -600);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(650);
    await snapshot('04-close-beads.png');
    assert.ok((await page.evaluate(() => window.beadsAtelier.metrics())).zoom > 0.3);

    // A captured drag must stop when its screen position enters the HTML palette.
    const safeCell = await page.evaluate(() => window.beadsAtelier.projectCell(9, 6));
    await page.mouse.move(safeCell.x, safeCell.y);
    await page.mouse.down();
    await page.mouse.move(1030, 350);
    assert.equal((await read()).strokeActive, false, 'HUD cancels the captured stroke');
    const beforeReentry = (await read()).board.revision;
    await page.mouse.move(safeCell.x, safeCell.y + 40);
    assert.equal((await read()).board.revision, beforeReentry, 'reentry requires a fresh press');
    await page.mouse.up();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await read()).board.correctCellCount, 10);
    await page.getByRole('button', { name: '回到桌边 ↗' }).click();
    await waitMode('tabletop');
    await page.keyboard.press('KeyE');
    await waitMode('workshop');
    assert.equal((await read()).board.correctCellCount, 10, 'world return keeps the same work');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready === true);
    assert.equal((await read()).mode, 'workshop');
    assert.equal((await read()).board.correctCellCount, 10, 'reload restores the local craft');

    await page.keyboard.press('KeyE');
    await waitMode('tabletop');
    await page.getByRole('button', { name: '开始拼豆', exact: true }).click();
    await waitMode('beadwork');
    await page.evaluate(() =>
    {
        const app = window.beadsAtelier;
        const model = app.read();

        for (let index = 0; index < model.pattern.targetNumbers.length; index += 1)
        {
            const number = model.pattern.targetNumbers[index];

            if (number > 0 && app.read().board.cells[index] !== number)
            {
                app.dispatch({ type: 'selectColor', colorNumber: number });
                app.dispatch({ type: 'beginStroke', x: index % model.pattern.width, y: Math.floor(index / model.pattern.width) });
                app.dispatch({ type: 'endStroke' });
            }
        }
    });
    assert.equal((await read()).stage, 'ready');
    await page.getByRole('button', { name: '开始熨烫 →', exact: true }).click();
    assert.equal((await read()).stage, 'ironing');
    const ironPoint = await page.evaluate(() => window.beadsAtelier.projectCell(7, 6));
    await page.mouse.move(ironPoint.x, ironPoint.y);
    await page.mouse.down();
    await page.waitForTimeout(180);
    await snapshot('05-ironing.png');
    await page.mouse.up();
    assert.ok((await read()).ironProgress > 0, 'real pointer covers an ironing area');
    await page.waitForTimeout(500);
    const coveredBeforeReload = (await read()).ironProgress;
    await page.reload();
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready === true);
    assert.equal((await read()).ironProgress, coveredBeforeReload);
    assert.equal((await page.evaluate(() => window.beadsAtelier.metrics())).ironingToolVisible, false);
    await page.keyboard.press('KeyE');
    await waitMode('tabletop');
    await page.getByRole('button', { name: '开始拼豆', exact: true }).click();
    await waitMode('beadwork');
    assert.equal((await page.evaluate(() => window.beadsAtelier.metrics())).ironingToolVisible, true, 'restored tool follows the view mode before any new coverage');
    await page.waitForTimeout(180);
    await snapshot('05b-restored-ironing.png');
    await page.evaluate(() =>
    {
        const app = window.beadsAtelier;
        const model = app.read();

        for (let y = 0; y < model.board.height; y += 1)
        {
            for (let x = 0; x < model.board.width; x += 1)
            {
                app.dispatch({ type: 'ironCell', x, y });
            }
        }
    });
    assert.equal((await read()).stage, 'finished');
    assert.equal((await read()).finishedArtworks.length, 1);
    await page.waitForTimeout(250);
    await snapshot('06-finished.png');
    const metrics = await page.evaluate(() => window.beadsAtelier.metrics());

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 1920, height: 800 }])
    {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(150);
        await snapshot(`07-board-${viewport.width}x${viewport.height}.png`);
    }

    assert.equal(metrics.webglError, 0);
    assert.deepEqual(errors, [], 'browser and shader console stays clean');
    const report = { passed: true, viewport: '1280x720', metrics, errors, checks: [
        'static idle scene', 'reference style controls and reset', 'visible outline toggle and reset',
        'physical movement', 'sit/focus/return', 'entry-click gate', 'drag interpolation',
        'stroke undo/redo', 'continuous zoom', 'save/reload', 'ironing pointer',
        'HUD captured-pointer isolation', 'restored ironing visibility',
        'finished collection', 'four aspect ratios', 'zero WebGL errors'
    ] };
    await writeFile(new URL('browser-report.json', output), `${JSON.stringify(report, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
catch (error)
{
    await snapshot('failure.png');
    await writeFile(new URL('browser-failure.json', output), `${JSON.stringify({ error: String(error), errors }, null, 4)}\n`);
    throw error;
}
finally
{
    await context.close();
    await browser.close();
}
