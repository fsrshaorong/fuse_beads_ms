import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer } from 'vite';
import { startWorkshopServer } from '../server/server';
import { MultiplayerClient } from '../src/Networking/MultiplayerClient';
import { randomUUID } from 'node:crypto';

const temporary = await mkdtemp(join(tmpdir(), 'beads-browser-'));
const output = resolve('artifacts/multiplayer-browser');
await mkdir(output, { recursive: true });
const port = Number(process.env.MULTIPLAYER_BROWSER_PORT ?? 5191);
const url = `http://127.0.0.1:${port}`;
const serverErrors: unknown[] = [];
const backend = await startWorkshopServer({ port: 0, databasePath: join(temporary, 'test.sqlite'),
    allowedOrigins: [url], onError: (error) => serverErrors.push(String(error)) });
const vite = await createServer({
    define: { 'import.meta.env.VITE_MULTIPLAYER_URL': JSON.stringify(backend.url) },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false }
});
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })));
const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
const pageErrors: string[] = [];
for (const page of [a, b])
{
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
}
const ready = (page: Page) => page.waitForFunction(() => window.beadsAtelier?.metrics().ready, undefined, { timeout: 60000 });
const mode = (page: Page, expected: string) => page.waitForFunction((value) => window.beadsAtelier.read().mode === value, expected);
const read = (page: Page) => page.evaluate(() => window.beadsAtelier.read());
try
{
    await a.goto(url);
    await ready(a);
    await a.waitForTimeout(900);
    await a.screenshot({ path: join(output, '01-expanded-workshop.png') });
    const localBefore = await a.evaluate(() => localStorage.getItem('fuse-beads.web-playground.v1'));
    await a.locator('#room-button').click();
    await a.locator('#room-nickname').fill('小莓');
    await a.locator('#room-name').fill('莓莓手作店');
    await a.locator('#create-room').click();
    await a.waitForFunction(() => window.beadsAtelier.metrics().online === true);
    const roomId = await a.evaluate(() => window.beadsAtelier.metrics().roomId as string);
    await b.goto(`${url}/?room=${roomId}`);
    await ready(b);
    await b.locator('#room-nickname').fill('小豆');
    await b.locator('#join-room').click();
    await b.waitForFunction(() => window.beadsAtelier.metrics().online === true);
    await a.waitForFunction(() => window.beadsAtelier.metrics().players.length === 2);
    console.log('Two browser players joined.');
    await a.waitForTimeout(300);
    assert.equal(await a.evaluate(() => window.beadsAtelier.metrics().partnerCount), 1);
    await a.screenshot({ path: join(output, '06-friends-workshop.png') });
    await a.locator('#primary-button').click();
    await mode(a, 'tabletop');
    await a.locator('#primary-button').click();
    await mode(a, 'beadwork');
    await b.locator('.world-canvas').focus();
    await b.keyboard.down('KeyD');
    await b.waitForFunction(() => !(document.querySelector('#primary-button') as HTMLButtonElement).disabled);
    await b.keyboard.up('KeyD');
    await b.locator('#primary-button').click();
    await mode(b, 'tabletop');
    await b.locator('#primary-button').click();
    await mode(b, 'beadwork');
    console.log('Both players seated with independent cameras.');
    assert.equal((await read(a)).mode, 'beadwork', 'another player entering does not move my camera');
    const pattern = (await read(a)).pattern;
    const indices = pattern.targetNumbers.flatMap((color, index) => color > 0 ? [index] : []);
    const indexA = indices[Math.floor(indices.length * 0.45)], indexB = indices[Math.floor(indices.length * 0.55)];
    async function clickBead(page: Page, index: number)
    {
        const color = pattern.targetNumbers[index];
        await page.locator(`[data-color="${color}"]`).click();
        const point = await page.evaluate(({ x, y }) => window.beadsAtelier.projectCell(x, y), { x: index % pattern.width, y: Math.floor(index / pattern.width) });
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction((i) => window.beadsAtelier.read().board.cells[i] !== 0 && window.beadsAtelier.metrics().pending === 0, index);
    }
    await clickBead(a, indexA);
    await b.waitForFunction((i) => window.beadsAtelier.read().board.cells[i] !== 0, indexA);
    await clickBead(b, indexB);
    await a.waitForFunction((i) => window.beadsAtelier.read().board.cells[i] !== 0, indexB);
    await a.locator('#undo-button').click();
    await a.waitForFunction((i) => window.beadsAtelier.read().board.cells[i] === 0 && window.beadsAtelier.metrics().pending === 0, indexA);
    assert.notEqual((await read(a)).board.cells[indexB], 0, 'undo preserves partner bead');
    await a.locator('#redo-button').click();
    await a.waitForFunction((i) => window.beadsAtelier.read().board.cells[i] !== 0 && window.beadsAtelier.metrics().pending === 0, indexA);
    await a.screenshot({ path: join(output, '02-shared-board.png') });
    console.log('Pointer placement and personal undo/redo passed.');
    await b.screenshot({ path: join(output, '03-partner-view.png') });
    await contexts[1].setOffline(true);
    await b.waitForFunction(() => window.beadsAtelier.metrics().connected === false, undefined, { timeout: 60000 });
    await clickBead(a, indices[indices.length - 100]);
    await contexts[1].setOffline(false);
    await b.waitForFunction(() => window.beadsAtelier.metrics().connected === true, undefined, { timeout: 60000 });
    await b.waitForFunction(() => window.beadsAtelier.read().board.cells.filter(Boolean).length === 3);
    await b.reload();
    await ready(b);
    await b.waitForFunction(() => window.beadsAtelier.metrics().online === true);
    await b.waitForFunction(() => window.beadsAtelier.read().board.cells.filter(Boolean).length === 3);
    assert.deepEqual((await read(a)).board.cells, (await read(b)).board.cells);
    // A third protocol client prepares the remaining cells; the actual browser UI performs ironing and handoff.
    await a.locator('#primary-button').click();
    await mode(a, 'tabletop');
    await a.locator('.world-canvas').focus();
    await a.keyboard.press('KeyE');
    await mode(a, 'workshop');
    const helper = new MultiplayerClient(backend.url, { nickname: '准备材料的朋友' });
    try
    {
        await helper.connect();
        await helper.join(roomId);
        await helper.seat(0);
        for (let offset = 0; offset < indices.length; offset += 128)
        {
            const snapshot = helper.snapshot!;
            await helper.command({ type: 'paint', opId: randomUUID(), roomId, workId: snapshot.work.id,
                strokeId: randomUUID(), edits: indices.slice(offset, offset + 128).map((index) => ({
                    index, color: pattern.targetNumbers[index], expectedVersion: snapshot.work.cellVersions[index]
                })) });
        }
        await helper.leave();
    }
    finally { helper.close(); }
    await a.locator('#primary-button').click();
    await mode(a, 'tabletop');
    await a.locator('#primary-button').click();
    await mode(a, 'beadwork');
    await a.waitForFunction(() => window.beadsAtelier.read().stage === 'ready');
    await a.locator('#iron-button').click();
    await a.waitForFunction(() => window.beadsAtelier.read().stage === 'ironing');
    const ironPoint = await a.evaluate(({ x, y }) => window.beadsAtelier.projectCell(x, y),
        { x: indexA % pattern.width, y: Math.floor(indexA / pattern.width) });
    await a.mouse.click(ironPoint.x, ironPoint.y);
    await a.waitForFunction(() => window.beadsAtelier.read().ironProgress > 0);
    await a.locator('#iron-button').click();
    await b.locator('#primary-button').click();
    await mode(b, 'beadwork');
    await b.locator('#iron-button').click();
    await b.waitForFunction(() => document.querySelector('#iron-button')?.textContent === '放下熨斗，交给伙伴');
    await b.evaluate((targets) =>
    {
        const width = window.beadsAtelier.read().pattern.width;
        for (const index of targets) { window.beadsAtelier.dispatch({ type: 'ironCell', x: index % width, y: Math.floor(index / width) }); }
    }, indices);
    await b.waitForFunction(() => window.beadsAtelier.read().stage === 'finished');
    await a.waitForFunction(() => window.beadsAtelier.read().finishedArtworks.length === 1);
    await b.waitForFunction(() => window.beadsAtelier.read().finishedArtworks.length === 1);
    assert.equal((await read(a)).finishedArtworks[0].artworkId, (await read(b)).finishedArtworks[0].artworkId);
    await a.screenshot({ path: join(output, '04-shared-finished.png') });
    await a.locator('#collection-button').click();
    assert.equal(await a.locator('#collection-grid .pattern-option').count(), 1);
    await a.locator('.collection-dialog [data-close]').click();
    console.log('Browser ironing, handoff and shared collection passed.');
    await a.locator('#room-button').click();
    await a.locator('#leave-room').click();
    await a.waitForFunction(() => window.beadsAtelier.metrics().online === false);
    assert.equal((await read(a)).board.cells.filter(Boolean).length, 0, 'single-player draft remains separate');
    const localAfter = await a.evaluate(() => JSON.parse(localStorage.getItem('fuse-beads.web-playground.v1') ?? '{}'));
    assert.ok(localAfter.drafts.every((draft: { cells: number[] }) => draft.cells.every((color) => color === 0)));
    await a.locator('.world-canvas').focus();
    const wallsBefore = await a.evaluate(() => window.beadsAtelier.metrics().visibleWalls.join(','));
    await a.mouse.move(500, 470);
    await a.mouse.down({ button: 'left' });
    await a.mouse.move(1120, 470, { steps: 12 });
    await a.mouse.up({ button: 'left' });
    await a.waitForFunction((before) => window.beadsAtelier.metrics().visibleWalls.join(',') !== before, wallsBefore);
    await a.waitForTimeout(800);
    await a.screenshot({ path: join(output, '05-room-cutaway.png') });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(serverErrors, []);
    await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, browserContexts: 2,
        checks: ['UI create/join', 'independent cameras and seats', 'real pointer placement', 'remote updates',
            'personal undo/redo', 'offline recovery', 'reload recovery', 'iron tool pointer', 'iron handoff', 'shared collection',
            'leave and local-save isolation', 'camera-dependent cutaway'],
        screenshots: 6, originalSaveExisted: localBefore !== null }, null, 4));
    console.log('Multiplayer browser checks passed: two isolated browsers, live backend, shared board and save isolation.');
}
catch (error)
{
    await a.screenshot({ path: join(output, 'failure-a.png') }).catch(() => {});
    await b.screenshot({ path: join(output, 'failure-b.png') }).catch(() => {});
    console.error({ pageErrors, serverErrors });
    throw error;
}
finally
{
    await browser.close();
    await vite.close();
    await backend.close();
    await rm(temporary, { recursive: true, force: true });
}
