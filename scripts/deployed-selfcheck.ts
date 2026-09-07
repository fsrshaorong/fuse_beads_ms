import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const url = process.env.ATELIER_DEPLOYED_URL;
if (url === undefined || !url.startsWith('https://')) { throw new Error('Set ATELIER_DEPLOYED_URL to the HTTPS deployment being tested.'); }
const output = resolve('artifacts/deployed');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1280, height: 800 } })));
const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
const errors: string[] = [];
for (const page of [a, b])
{
    page.setDefaultTimeout(45000);
    page.on('pageerror', (error) => errors.push(error.message));
}
const waitRestart = process.argv.includes('--wait-for-restart');
try
{
    const health = await a.request.get(`${url}/health`);
    assert.equal(health.status(), 200);
    assert.equal((await health.json()).protocolVersion, 1);
    await a.goto(url);
    await a.waitForFunction(() => window.beadsAtelier?.metrics().ready);
    await a.locator('#room-button').click();
    await a.locator('#room-nickname').fill('部署验证甲');
    await a.locator('#room-name').fill('公网部署验证');
    await a.locator('#create-room').click();
    await a.waitForFunction(() => window.beadsAtelier.metrics().online);
    const roomId = await a.evaluate(() => window.beadsAtelier.metrics().roomId);
    const playerId = await a.evaluate(() => window.beadsAtelier.metrics().playerId);
    await b.goto(`${url}/?room=${roomId}`);
    await b.waitForFunction(() => window.beadsAtelier?.metrics().ready);
    await b.locator('#room-nickname').fill('部署验证乙');
    await b.locator('#join-room').click();
    await b.waitForFunction(() => window.beadsAtelier.metrics().online);
    await a.waitForFunction(() => window.beadsAtelier.metrics().players.length === 2);
    await a.locator('#primary-button').click();
    await a.waitForFunction(() => window.beadsAtelier.read().mode === 'tabletop');
    await a.locator('#primary-button').click();
    await a.waitForFunction(() => window.beadsAtelier.read().mode === 'beadwork');
    const pattern = await a.evaluate(() => window.beadsAtelier.read().pattern);
    const candidates = pattern.targetNumbers.flatMap((color, index) => color > 0 ? [index] : []);
    const index = candidates[Math.floor(candidates.length / 2)];
    await a.locator(`[data-color="${pattern.targetNumbers[index]}"]`).click();
    const point = await a.evaluate(({ x, y }) => window.beadsAtelier.projectCell(x, y), { x: index % pattern.width, y: Math.floor(index / pattern.width) });
    await a.mouse.click(point.x, point.y);
    await b.waitForFunction(() => window.beadsAtelier.read().board.correctCellCount === 1);
    await a.locator('#undo-button').click();
    await b.waitForFunction(() => window.beadsAtelier.read().board.correctCellCount === 0);
    await a.locator('#redo-button').click();
    await b.waitForFunction(() => window.beadsAtelier.read().board.correctCellCount === 1);
    await a.screenshot({ path: `${output}/shared-board.png` });
    console.log('Public HTTPS, two browser players, real pointer painting and undo/redo passed.');
    if (waitRestart)
    {
        console.log('READY_FOR_SERVER_RESTART: restart the remote backend, then press Enter.');
        await new Promise<void>((done) => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); done(); }); });
    }
    await a.reload();
    await a.waitForFunction(() => window.beadsAtelier?.metrics().connected);
    assert.equal(await a.evaluate(() => window.beadsAtelier.metrics().playerId), playerId);
    assert.equal(await a.evaluate(() => window.beadsAtelier.metrics().roomId), roomId);
    assert.equal(await a.evaluate(() => window.beadsAtelier.read().board.correctCellCount), 1);
    assert.equal(await a.evaluate(() => window.beadsAtelier.metrics().webglError), 0);
    assert.deepEqual(errors, []);
    for (const page of [a, b])
    {
        await page.locator('#room-button').click();
        await page.locator('#leave-room').click();
        await page.waitForFunction(() => !window.beadsAtelier.metrics().online);
    }
    await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, url, tlsVerification: true,
        checks: ['HTTPS health', 'two independent browsers', 'WSS create/join', 'real pointer painting',
            'remote undo/redo', 'identity and work after reload', 'zero WebGL errors'],
        operatorConfirmedServerRestart: waitRestart, errors }, null, 4));
    console.log('Public deployment browser checks passed.');
}
catch (error)
{
    await a.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    throw error;
}
finally { await browser.close(); }
