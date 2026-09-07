import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// A synthetic component fixture, with no main entry point, HUD, or player storage.
const output = new URL('../artifacts/mini-check/', import.meta.url);
const project = fileURLToPath(new URL('../', import.meta.url));
const report = { passed: false, timestamp: new Date().toISOString(), errors: [], assets: {} };
await mkdir(output, { recursive: true });
for (const name of ['mini-bead-kit.glb'])
{
    const bytes = await readFile(new URL(`../public/models/${name}`, import.meta.url));
    report.assets[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const server = await createServer({ root: project, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['three'] } });
await server.listen();
let browser;
try
{
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(() =>
    {
        for (const property of ['localStorage', 'sessionStorage'])
        {
            Object.defineProperty(window, property, { get() { throw new Error(`Fixture forbids ${property}`); } });
        }
    });
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) =>
    {
        if (message.type() === 'error')
        {
            report.errors.push(message.text());
        }
    });
    await page.route('**/*', (route) =>
    {
        const url = route.request().url();
        if (!url.startsWith(`${origin}/`))
        {
            return route.abort();
        }
        if (url.endsWith('/__mini-selfcheck.html'))
        {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0}canvas{display:block}</style></head><body></body></html>' });
        }
        return route.continue();
    });
    await page.goto(`${origin}/__mini-selfcheck.html`);
    const module = await (await fetch(`${origin}/src/Rendering/PainterlyMaterials.ts`)).text();
    const threeUrl = module.match(/from\s+["']([^"']*three[^"']*\.js[^"']*)["']/)?.[1];
    assert.ok(threeUrl, 'fixture and production components share one Three module');
    const result = await page.evaluate(runChecks, threeUrl);
    for (const [name, data] of Object.entries(result.images))
    {
        await writeFile(new URL(`${name}.png`, output), Buffer.from(data.split(',')[1], 'base64'));
    }
    const columns = [
        ['legacy-29-raw', '01 / 旧图 · MINI 未熨烫', '29 × 29 图案 · 320 颗', '外径 2.61 mm · 高 2.8 mm · 钉距 2.7 mm'],
        ['mini-50-raw', '02 / 新图 · MINI 未熨烫', '50 × 50 图案 · 1,159 颗', '外径 2.61 mm · 高 2.8 mm · 钉距 2.7 mm'],
        ['mini-50-fused', '03 / 新图 · MINI 已熨烫', '同一张新图 · 1,159 颗', '高 2 mm · 细小上孔 · 关闭逐豆描边']
    ];
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;background:#f9f1e8;color:#59424f;font-family:"Microsoft YaHei",sans-serif;padding:38px 40px 28px}
        .eyebrow{font-size:12px;letter-spacing:3px;color:#987571}h1{font-size:30px;margin:10px 0 12px;font-weight:600}
        .intro{font-size:14px;color:#806a68;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
        article{background:#fffaf4;border:1px solid #eadbd2;border-radius:16px;overflow:hidden}header{padding:22px 22px 0}
        h2{font-size:16px;margin:0 0 9px}p{font-size:14px;margin:0;color:#876c68}img{width:100%;display:block}
        footer{padding:0 22px 22px;font-size:12px;color:#8f7671}.note{margin:22px 0 0;font-size:12px;line-height:1.8;color:#8e7772}
        </style></head><body><div class="eyebrow">豆间 / 实体尺度对照</div><h1>同一块 145 mm 板，同一台相机</h1>
        <div class="intro">全部采用同一套 Mini GLB、52 × 52 钉阵、光照与静态手绘材质 · 无数字覆盖 · 相机、画幅和物理比例保持一致</div>
        <div class="grid">${columns.map(([name, title, subtitle, dimensions]) => `<article><header><h2>${title}</h2><p>${subtitle}</p></header><img src="${result.images[name]}" alt="${title}"><footer>${dimensions}</footer></article>`).join('')}</div>
        <div class="note">旧图格位和豆色数据保留原值；所有图案使用相同大小的豆，新图以更多格位增加细节和实体面积。中、右两列保持图案、豆色、相机与光照完全一致。<br>孔径、钉距及熨烫形态为明确记录的建模估值；此图验证真实组件装配，不代表完整主页面交互或其他 GPU 的性能。</div></body></html>`;
    await writeFile(new URL('comparison.html', output), html);
    await page.setViewportSize({ width: 1860, height: 915 });
    await page.setContent(html);
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: fileURLToPath(new URL('comparison.png', output)), fullPage: true });
    delete result.images;
    Object.assign(report, result);
    report.isolation = { syntheticPage: true, storageBlocked: true,
        importedMainOrHud: requests.some((url) => /\/src\/(main\.ts|Ui\/WorkshopHud)/.test(url)),
        externalRequests: requests.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith('data:')) };
    assert.equal(report.isolation.importedMainOrHud, false);
    assert.deepEqual(report.isolation.externalRequests, []);
    assert.deepEqual(report.checks.filter((check) => !check.passed), [], 'uniform Mini component checks');
    assert.deepEqual(report.errors, [], 'browser and WebGL console');
    report.passed = true;
    await context.close();
}
catch (error)
{
    report.failure = String(error?.stack ?? error);
    process.exitCode = 1;
}
finally
{
    await browser?.close();
    await server.close();
    await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/** Exercises actual application commands and rendered component state in an isolated document. */
async function runChecks(threeUrl)
{
    const T = await import(threeUrl);
    const { WorkshopApplication } = await import('/src/App/WorkshopApplication.ts');
    const { BeadBoardView } = await import('/src/Rendering/BeadBoardView.ts');
    const { loadBeadModels } = await import('/src/Rendering/BeadModels.ts');
    const { getBeadColor } = await import('/src/Rendering/BeadPalette.ts');
    const { PainterlyMaterials } = await import('/src/Rendering/PainterlyMaterials.ts');
    const { PainterlyOutline } = await import('/src/Rendering/PainterlyOutline.ts');
    const { configurePainterlyRenderer, createPainterlyLighting } = await import('/src/Rendering/PainterlyLighting.ts');
    const owner = new PainterlyMaterials();
    const [models] = await Promise.all([loadBeadModels('/models/mini-bead-kit.glb'), owner.ready]);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    configurePainterlyRenderer(renderer, 1);
    renderer.setSize(1000, 1000);
    document.body.append(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#fffaf4');
    const lighting = createPainterlyLighting();
    scene.add(lighting);
    const camera = new T.PerspectiveCamera(38, 1, 0.01, 20);
    camera.position.set(0, 2.78, 0.40);
    camera.lookAt(0, 1.155, 0);
    camera.updateMatrixWorld(true);
    const outline = new PainterlyOutline(renderer);
    const board = new BeadBoardView(owner, models);
    scene.add(board.root);
    const gl = renderer.getContext();
    const checks = [];
    const images = {};
    const measurements = {};
    const check = (name, passed, details = {}) => checks.push({ name, passed, ...details });
    const near = (actual, expected, epsilon = 0.001) => Math.abs(actual - expected) < epsilon;
    let time = 0;
    let sourceDisposals = 0;
    let retiredGeometries = 0;
    let watchedGeometries = 0;
    const watched = new Set();
    const sources = [models.raw, models.fused];
    for (const geometry of sources)
    {
        geometry.addEventListener('dispose', () => sourceDisposals += 1);
    }
    function command(app, value)
    {
        const result = app.dispatch(value);
        if (!result.accepted)
        {
            throw new Error(`Rejected fixture command ${JSON.stringify(value)}: ${result.code}`);
        }
    }
    function createStages(id)
    {
        const app = new WorkshopApplication();
        command(app, { type: 'selectPattern', patternId: id });
        command(app, { type: 'sit' });
        command(app, { type: 'tick', deltaSeconds: 1 });
        command(app, { type: 'focus' });
        command(app, { type: 'tick', deltaSeconds: 1 });
        const pattern = app.getReadModel().pattern;
        const occupied = [];
        for (let index = 0; index < pattern.targetNumbers.length; index += 1)
        {
            const colorNumber = pattern.targetNumbers[index];
            if (colorNumber === 0)
            {
                continue;
            }
            const cell = { x: index % pattern.width, y: Math.floor(index / pattern.width) };
            occupied.push(cell);
            command(app, { type: 'selectColor', colorNumber });
            command(app, { type: 'beginStroke', ...cell });
            command(app, { type: 'endStroke' });
        }
        const raw = app.getReadModel();
        const rawSave = app.exportSave();
        command(app, { type: 'startIroning' });
        command(app, { type: 'ironCell', ...occupied[0] });
        const single = app.getReadModel();
        const singleSave = app.exportSave();
        for (const cell of occupied.slice(1))
        {
            command(app, { type: 'ironCell', ...cell });
        }
        return { raw, single, fused: app.getReadModel(), occupied,
            saves: { raw: rawSave, single: singleSave, fused: app.exportSave() } };
    }
    function sync(model)
    {
        board.sync(model);
        time += 1;
        board.update(time);
        owner.update(time);
        board.setDetail(0);
        scene.updateMatrixWorld(true);
        board.root.traverse((object) =>
        {
            if (object.isMesh && object !== board.hover && !watched.has(object.geometry))
            {
                watched.add(object.geometry);
                watchedGeometries += 1;
                object.geometry.addEventListener('dispose', () => retiredGeometries += 1);
            }
        });
        outline.render(scene, camera);
        outline.render(scene, camera);
    }
    function read(name)
    {
        const pixels = new Uint8Array(1000 * 1000 * 4);
        gl.readPixels(0, 0, 1000, 1000, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (name)
        {
            images[name] = renderer.domElement.toDataURL('image/png');
        }
        return pixels;
    }
    function pixelDifference(left, right)
    {
        let changed = 0;
        for (let index = 0; index < left.length; index += 4)
        {
            if (left[index] !== right[index] || left[index + 1] !== right[index + 1] || left[index + 2] !== right[index + 2])
            {
                changed += 1;
            }
        }
        return changed;
    }
    function verifyInstances(model, name)
    {
        const meshes = ['HollowBeadInstances', 'LocallyFusedBeadInstances'].map((key) => board.root.getObjectByName(key));
        const actual = new Map();
        const matrix = new T.Matrix4();
        const color = new T.Color();
        let valid = true;
        for (const [batchIndex, mesh] of meshes.entries())
        {
            for (let index = 0; index < mesh.count; index += 1)
            {
                mesh.getMatrixAt(index, matrix);
                const position = new T.Vector3().setFromMatrixPosition(matrix).add(board.root.position);
                const cell = board.hitCell(position);
                mesh.getColorAt(index, color);
                const scale = new T.Vector3().setFromMatrixScale(matrix);
                valid &&= cell !== null && near(position.y, 1.155, 1e-6) && scale.distanceTo(new T.Vector3(1, 1, 1)) < 1e-6;
                if (cell === null)
                {
                    continue;
                }
                const key = cell.y * model.pattern.width + cell.x;
                valid &&= !actual.has(key);
                actual.set(key, { color: color.clone(), fused: batchIndex === 1, position });
            }
        }
        for (let index = 0; index < model.board.cells.length; index += 1)
        {
            const value = model.board.cells[index];
            const instance = actual.get(index);
            if (value === 0)
            {
                valid &&= instance === undefined;
                continue;
            }
            const expectedColor = new T.Color(getBeadColor(model.pattern.palette[value - 1].colorId));
            const expected = board.cellWorld(index % model.pattern.width, Math.floor(index / model.pattern.width), new T.Vector3());
            valid &&= instance !== undefined && Math.max(...['r', 'g', 'b'].map((channel) => Math.abs(instance.color[channel] - expectedColor[channel]))) < 1e-6;
            valid &&= instance !== undefined && near(instance.position.x, expected.x, 1e-6) && near(instance.position.z, expected.z, 1e-6);
            valid &&= instance !== undefined && instance.fused === (model.stage === 'finished' || model.ironCoverage[index]);
        }
        check(`${name}: all occupied instances retain position, color and local ironing state`, valid,
            { raw: meshes[0].count, fused: meshes[1].count, occupied: actual.size });
    }
    function verifyPicking(model, name)
    {
        const raycaster = new T.Raycaster();
        const plane = new T.Plane(new T.Vector3(0, 1, 0), -board.hitPlaneHeight);
        let correct = 0;
        const pinPositions = new Set();
        const pins = board.root.getObjectByName('PegboardPins');
        const matrix = new T.Matrix4();
        const key = (x, z) => `${x.toFixed(5)},${z.toFixed(5)}`;
        for (let index = 0; index < pins.count; index += 1)
        {
            pins.getMatrixAt(index, matrix);
            pinPositions.add(key(matrix.elements[12], matrix.elements[14]));
        }
        let aligned = true;
        for (let y = 0; y < model.pattern.height; y += 1)
        {
            for (let x = 0; x < model.pattern.width; x += 1)
            {
                const center = board.cellWorld(x, y, new T.Vector3());
                const projected = center.clone().project(camera);
                raycaster.setFromCamera(new T.Vector2(projected.x, projected.y), camera);
                const hit = raycaster.ray.intersectPlane(plane, new T.Vector3());
                const cell = hit === null ? null : board.hitCell(hit);
                correct += Number(cell?.x === x && cell?.y === y);
                aligned &&= pinPositions.has(key(center.x, center.z));
            }
        }
        const first = board.cellWorld(0, 0, new T.Vector3());
        const last = board.cellWorld(model.pattern.width - 1, model.pattern.height - 1, new T.Vector3());
        const pitch = board.dimensions.pitchMm * 0.006;
        const outside = [first.clone().add(new T.Vector3(-pitch * 0.51, 0, 0)),
            first.clone().add(new T.Vector3(0, 0, -pitch * 0.51)), last.clone().add(new T.Vector3(pitch * 0.51, 0, 0)),
            last.clone().add(new T.Vector3(0, 0, pitch * 0.51))];
        check(`${name}: screen ray hits every cell and rejects four outer edges`, correct === model.pattern.width * model.pattern.height
            && outside.every((point) => board.hitCell(point) === null), { correct });
        check(`${name}: all pattern cells coincide with actual peg centers`, aligned, { pegs: pins.count });
    }
    function verifyGeometry(geometry, name, dimensions, fused)
    {
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        const size = bounds.getSize(new T.Vector3()).divideScalar(0.006);
        const expectedDiameter = fused ? dimensions.pitchMm : dimensions.diameterMm;
        const expectedHeight = fused ? dimensions.fusedHeightMm : dimensions.heightMm;
        check(`${name}: real GLB dimensions, bottom and COLOR_0`, near(size.x, expectedDiameter) && near(size.z, expectedDiameter)
            && near(size.y, expectedHeight) && near(bounds.min.y, 0, 1e-7) && geometry.hasAttribute('color'),
        { sizeMm: size.toArray(), bottomMm: bounds.min.y / 0.006, triangles: geometry.index.count / 3 });
        const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
        const mesh = new T.Mesh(geometry, material);
        mesh.updateMatrixWorld(true);
        const ray = new T.Raycaster();
        let minimumGapMm = Infinity;
        let missingWalls = 0;
        for (let slice = 1; slice <= 24; slice += 1)
        {
            const yMm = dimensions.pegHeightMm * slice / 24;
            const pinRadiusMm = dimensions.pegDiameterMm / 2 * (1 - 0.2 * yMm / dimensions.pegHeightMm);
            for (let angle = 0; angle < 48; angle += 1)
            {
                const theta = angle / 48 * Math.PI * 2;
                ray.set(new T.Vector3(0, yMm * 0.006, 0), new T.Vector3(Math.cos(theta), 0, Math.sin(theta)));
                const hit = ray.intersectObject(mesh, false)[0];
                if (!hit)
                {
                    missingWalls += 1;
                }
                else
                {
                    minimumGapMm = Math.min(minimumGapMm, hit.distance / 0.006 - pinRadiusMm);
                }
            }
        }
        ray.set(new T.Vector3(0, (expectedHeight + 1) * 0.006, 0), new T.Vector3(0, -1, 0));
        const blockedAxis = ray.intersectObject(mesh, false).length;
        check(`${name}: actual inner wall clears full peg height and central hole is through`, minimumGapMm > 0.005
            && missingWalls === 0 && blockedAxis === 0, { minimumGapMm, radialSamples: 1152, missingWalls, blockedAxis });
        material.dispose();
    }
    const scenarios = [
        { key: 'legacy-16', id: 'pixel-heart', width: 16, count: 84,
            originalSignature: '0b8d60982007f653fca6fee2ee3b6f8745a29a7ef9a6bee57e1a808bbe25a565' },
        { key: 'legacy-29', id: 'atelier-strawberry-charm-29-v1', width: 29, count: 320,
            originalSignature: 'ec04b3c21e284e5d1ede9db25d8b42a50ae740e248bb618258c25405814bf76d' },
        { key: 'mini-50', id: 'atelier-strawberry-mini-50-v1', width: 50, count: 1159 }
    ];
    const snapshots = {};
    const frames = {};
    for (const scenario of scenarios)
    {
        const { key } = scenario;
        const stages = createStages(scenario.id);
        snapshots[key] = stages;
        if (scenario.originalSignature)
        {
            // Frozen before the uniform-Mini change: old cell/color identities must remain compatible.
            const pattern = stages.raw.pattern;
            const bytes = new TextEncoder().encode(JSON.stringify([pattern.width, pattern.height, pattern.palette, pattern.targetNumbers]));
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
            check(`${key}: original layout and palette signature remains unchanged`, hash === scenario.originalSignature, { sha256: hash });
        }
        check(`${key}: real command workflow fills the expected pattern`, stages.raw.stage === 'ready'
            && stages.raw.pattern.width === scenario.width && stages.occupied.length === scenario.count
            && stages.single.stage === 'ironing' && stages.single.ironCoverage.filter(Boolean).length === 1
            && stages.fused.stage === 'finished');
        sync(stages.raw);
        const metrics = board.metrics();
        measurements[key] = metrics;
        const boardGeometry = board.root.children.find((object) => /Pegboard145mm$/.test(object.name)).geometry;
        boardGeometry.computeBoundingBox();
        check(`${key}: 145 mm board uses the same 2.61 mm Mini bead and 52 × 52 pegs`, near(metrics.diameterMm, 2.61)
            && near(metrics.heightMm, 2.8) && near(metrics.pitchMm, 2.7) && metrics.pegCount === 2704
            && near(boardGeometry.boundingBox.max.x * 2 / 0.006, 145), metrics);
        verifyPicking(stages.raw, key);
        verifyGeometry(models.raw, `${key} raw`, board.dimensions, false);
        verifyGeometry(models.fused, `${key} fused`, board.dimensions, true);
        for (const stage of ['raw', 'single', 'fused'])
        {
            sync(stages[stage]);
            verifyInstances(stages[stage], `${key} ${stage}`);
            const frame = read(`${key}-${stage}`);
            frames[`${key}-${stage}`] = frame;
            board.update(time + 0.6);
            owner.update(time + 0.6);
            outline.render(scene, camera);
            const difference = pixelDifference(frame, read());
            check(`${key} ${stage}: settled rendering has no temporal drift`, difference === 0, { changedPixels: difference });
            const fused = board.root.getObjectByName('LocallyFusedBeadInstances');
            check(`${key} ${stage}: fused instances suppress per-bead outline`, fused.userData.painterlyOutline?.enabled === false);
        }
        for (const stage of ['raw', 'single', 'fused'])
        {
            const restored = new WorkshopApplication();
            command(restored, { type: 'restore', serialized: stages.saves[stage] });
            const model = restored.getReadModel();
            sync(model);
            verifyInstances(model, `${key} restored ${stage} save`);
            check(`${key}: ${stage} save preserves every cell, coverage flag and rendered pixel`,
                JSON.stringify(model.board.cells) === JSON.stringify(stages[stage].board.cells)
                && JSON.stringify(model.ironCoverage) === JSON.stringify(stages[stage].ironCoverage)
                && pixelDifference(frames[`${key}-${stage}`], read()) === 0);
        }
        check(`${key}: local and complete ironing visibly change geometry`, pixelDifference(frames[`${key}-raw`], frames[`${key}-single`]) > 0
            && pixelDifference(frames[`${key}-raw`], frames[`${key}-fused`]) > 1000);
    }
    for (let cycle = 0; cycle < 3; cycle += 1)
    {
        for (const key of ['legacy-16', 'legacy-29', 'mini-50'])
        {
            sync(snapshots[key].raw);
            check(`switch ${cycle + 1} → ${key}: complete original frame returns`, pixelDifference(frames[`${key}-raw`], read()) === 0);
        }
    }
    check('pattern switching leaves the one shared Mini model pair alive', sourceDisposals === 0, { sourceDisposals });
    check('renderer reports no WebGL error', gl.getError() === gl.NO_ERROR);
    measurements.camera = { type: 'PerspectiveCamera', fov: camera.fov, position: camera.position.toArray(),
        target: [0, 1.155, 0], resolution: [1000, 1000], boardMm: 145 };
    measurements.rendering = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        note: 'One fixture frame only; not a frame-rate guarantee or the full workshop.' };
    board.dispose();
    outline.dispose();
    check('all retired per-board geometries are disposed without releasing shared GLBs', retiredGeometries === watchedGeometries
        && sourceDisposals === 0, { retiredGeometries, watchedGeometries, sourceDisposals });
    models.dispose();
    check('model owner releases exactly two shared Mini geometries', sourceDisposals === 2, { sourceDisposals });
    owner.dispose();
    lighting.traverse((object) => object.shadow?.dispose());
    renderer.dispose();
    return { checks, measurements, images };
}
