import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ProfileStore } from '../desktop/ProfileStore';
import { assetPath } from '../desktop/AssetPath';
import { WorkshopApplication } from '../src/App/WorkshopApplication';

test('desktop saves are validated, ordered, backed up, and restored across store instances', async (t) =>
{
    const directory = await mkdtemp(join(tmpdir(), 'beads-desktop-save-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new ProfileStore(directory);
    const app = new WorkshopApplication();
    const first = app.exportSave();
    app.dispatch({ type: 'selectColor', colorNumber: 2 });
    const second = app.exportSave();
    assert.equal(await store.readSave(), null);
    await Promise.all([store.writeSave(first), store.writeSave(second)]);
    assert.equal(await new ProfileStore(directory).readSave(), second);
    assert.equal(await readFile(join(directory, 'workshop.backup.json'), 'utf8'), first);
    assert.throws(() => store.writeSave('{broken'), /invalid-workshop-save/);
    assert.equal(await store.readSave(), second);
    await writeFile(join(directory, 'workshop.json.tmp'), '{interrupted');
    assert.equal(await new ProfileStore(directory).readSave(), second);
});

test('a corrupt desktop save is preserved and cannot be overwritten by a fresh game', async (t) =>
{
    const directory = await mkdtemp(join(tmpdir(), 'beads-desktop-corrupt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'workshop.json'), '{broken');
    const store = new ProfileStore(directory);
    await assert.rejects(store.readSave(), /invalid-workshop-save/);
    await assert.rejects(store.writeSave(new WorkshopApplication().exportSave()), /invalid-workshop-save/);
    assert.equal(await readFile(join(directory, 'workshop.json'), 'utf8'), '{broken');
});

test('desktop profiles keep online identities separate and reject arbitrary storage keys', async (t) =>
{
    const directory = await mkdtemp(join(tmpdir(), 'beads-desktop-profiles-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const a = new ProfileStore(join(directory, 'a'));
    const b = new ProfileStore(join(directory, 'b'));
    const data = { 'fuse-beads.online-session.v1': JSON.stringify({ token: 'test-only' }) };
    await a.writeSession(data);
    assert.deepEqual(await a.readSession(), data);
    assert.deepEqual(await b.readSession(), {});
    assert.throws(() => a.writeSession({ arbitrary: 'value' }), /invalid-session/);
    assert.deepEqual(await a.readSession(), data);
});

test('desktop local protocol only serves bundled assets within its root', () =>
{
    const root = resolve('.desktop/web');
    assert.equal(assetPath(root, 'atelier://game/'), join(root, 'index.html'));
    assert.equal(assetPath(root, 'atelier://game/models/mini-bead-kit.glb'), join(root, 'models/mini-bead-kit.glb'));
    assert.throws(() => assetPath(root, 'atelier://game/..%5c..%5cprivate.txt'), /invalid-asset-path/);
    assert.throws(() => assetPath(root, 'https://example.com/'), /invalid-origin/);
    assert.throws(() => assetPath(root, 'atelier://elsewhere/'), /invalid-origin/);
});
