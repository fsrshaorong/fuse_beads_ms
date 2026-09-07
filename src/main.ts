import {
    DirectionalLight, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer
} from 'three';

import { WorkshopApplication } from './App/WorkshopApplication';
import type { WorkshopCommand, WorkshopReadModel } from './App/WorkshopApplication';
import { BeadBoardView } from './Rendering/BeadBoardView';
import { BEAD_DIMENSIONS, BEAD_TOP_Y } from './Rendering/BeadDimensions';
import { loadBeadModels } from './Rendering/BeadModels';
import { PainterlyMaterials } from './Rendering/PainterlyMaterials';
import { PainterlyOutline } from './Rendering/PainterlyOutline';
import { configurePainterlyRenderer, createPainterlyLighting } from './Rendering/PainterlyLighting';
import { FinishingView } from './Scene/FinishingView';
import { WorkshopCamera } from './Scene/WorkshopCamera';
import { createWorkshopEnvironment } from './Scene/WorkshopEnvironment';
import { WorkshopHud } from './Ui/WorkshopHud';
import './styles.css';

const SAVE_KEY = 'fuse-beads.web-playground.v1';
const root = document.querySelector<HTMLElement>('#app');

if (root === null)
{
    throw new Error('[Workshop] Missing application root.');
}

const application = new WorkshopApplication();
const materials = new PainterlyMaterials(`${import.meta.env.BASE_URL}textures/painterly/`);
const cameraRig = new WorkshopCamera();
const scene = new Scene();
const inputLifetime = new AbortController();
const keys = new Set<string>();
const pointer = new Vector2();
const raycaster = new Raycaster();
const hit = new Vector3();
const boardPlane = new Plane(new Vector3(0, 1, 0), -BEAD_TOP_Y);
const avatarTarget = new Vector3();
let renderer: WebGLRenderer;
let frameRequest = 0;
let pointerMode: 'none' | 'paint' | 'iron' | 'orbit' | 'pan' = 'none';
let lastPointerX = 0;
let lastPointerY = 0;
let pointerWorld: Vector3 | null = null;
let lastViewRevision = -1;
let lastBoardRevision = -1;
let lastPattern = '';
let lastStage = '';
let lastIronProgress = -1;
let saveTimer = 0;
let storageWritable = true;
let previousTime = performance.now();
let elapsed = 0;
let isReady = false;
let disposed = false;
const frameTimes: number[] = [];

const hud = new WorkshopHud(root, {
    dispatch: runCommand,
    interrupt: interruptInput,
    style: (profile) => materials.setProfile(profile),
    outline: (profile) => outline.setProfile(profile)
});

try
{
    renderer = new WebGLRenderer({ canvas: hud.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
}
catch (error)
{
    hud.fail('这台浏览器暂时无法开启 3D 画面，请开启硬件加速后刷新。');
    throw error;
}

configurePainterlyRenderer(renderer, window.devicePixelRatio);
const outline = new PainterlyOutline(renderer);
const lighting = createPainterlyLighting(new Vector3(1.27, 1.54, -0.96));
scene.add(lighting);
const beadModels = await loadBeadModels(`${import.meta.env.BASE_URL}models/bead-kit.glb`).catch((error: unknown) =>
{
    hud.fail('拼豆模型加载失败，请刷新重试。');
    throw error;
});
const environment = createWorkshopEnvironment(materials, beadModels);
const boardView = new BeadBoardView(materials, beadModels);
boardView.root.position.copy(environment.boardPosition);
const finishingView = new FinishingView(materials, environment.displayPosition, beadModels);
scene.add(environment.root, boardView.root, finishingView.root);
restoreSave();
const initialAvatar = application.getReadModel().avatar;
environment.avatar.position.set(initialAvatar.x, 0, initialAvatar.z);
environment.avatar.rotation.y = initialAvatar.yaw;
environment.update(0, false, false);
resize();
bindInput();

materials.ready.then(() =>
{
    if (disposed)
    {
        return;
    }

    isReady = true;
    refreshView();
    cameraRig.initializeWorldView(environment.avatar.position);
    outline.render(scene, cameraRig.camera);
    hud.ready();
    previousTime = performance.now();
    frameRequest = requestAnimationFrame(frame);
}).catch((error: unknown) =>
{
    if (disposed)
    {
        return;
    }

    hud.fail('画面素材加载失败，请刷新重试。');
    console.error('[Workshop] Failed to load local painterly textures.', error);
});

/** Shared public iteration surface: commands use exactly the same application port as the UI. */
const iterationApi = {
    dispatch(command: WorkshopCommand): void
    {
        runCommand(command);
    },
    read(): WorkshopReadModel
    {
        return application.getReadModel();
    },
    projectCell(x: number, y: number): { x: number; y: number }
    {
        boardView.cellWorld(x, y, hit).project(cameraRig.camera);
        const rect = hud.canvas.getBoundingClientRect();
        return { x: rect.left + (hit.x + 1) * rect.width / 2, y: rect.top + (1 - hit.y) * rect.height / 2 };
    },
    metrics(): object
    {
        const sorted = [...frameTimes].sort((left, right) => left - right);
        return {
            ready: isReady,
            frames: sorted.length,
            p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
            p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
            ironingToolVisible: finishingView.root.getObjectByName('MiniatureCraftIron')?.visible ?? false,
            outlineEnabled: outline.getProfile().enabled,
            beadDimensions: BEAD_DIMENSIONS,
            beadModels: boardView.metrics(),
            zoom: cameraRig.zoom,
            webglError: renderer.getContext().getError()
        };
    }
};

declare global
{
    interface Window
    {
        beadsAtelier: typeof iterationApi;
    }
}

window.beadsAtelier = iterationApi;

function runCommand(command: WorkshopCommand): void
{
    const previousStage = application.getReadModel().stage;
    const result = application.dispatch(command);

    if (!result.accepted)
    {
        const messages: Record<string, string> = {
            'workstation-out-of-range': '再走近一点，就可以坐下啦。',
            'artwork-not-ready': '先把图案上的每一颗颜色放对，再来熨烫。',
            'collection-full': '本地收藏已经放满了，当前图案会继续保留。'
        };

        if (result.code !== undefined && messages[result.code] !== undefined)
        {
            hud.notify(messages[result.code]);
        }

        return;
    }

    if (result.changed)
    {
        // A restored draft can have the same local board revision and coverage
        // count as the previous one while containing different cells or hot spots.
        if (command.type === 'restore')
        {
            lastBoardRevision = -1;
        }
        refreshView();
        const model = application.getReadModel();

        if (model.stage === 'finished' && previousStage !== 'finished')
        {
            hud.notify('完成了！这件小小的作品已经收进收藏。');
        }

        if (command.type !== 'tick' && command.type !== 'move')
        {
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(save, command.type === 'endStroke' ? 50 : 450);
        }
    }
}

function refreshView(): void
{
    const model = application.getReadModel();

    if (model.revision !== lastViewRevision)
    {
        hud.update(model, Math.hypot(model.avatar.x, model.avatar.z - 1.8) <= 1.35);
        finishingView.sync(model);
        lastViewRevision = model.revision;
    }

    if (model.board.revision !== lastBoardRevision || model.pattern.patternId !== lastPattern
        || model.stage !== lastStage || model.ironProgress !== lastIronProgress)
    {
        boardView.sync(model);
        lastBoardRevision = model.board.revision;
        lastPattern = model.pattern.patternId;
        lastStage = model.stage;
        lastIronProgress = model.ironProgress;
    }
}

function frame(now: number): void
{
    if (disposed)
    {
        return;
    }

    const frameMilliseconds = now - previousTime;
    const delta = Math.min(frameMilliseconds / 1000, 0.05);
    previousTime = now;
    elapsed += delta;

    if (!document.hidden)
    {
        frameTimes.push(frameMilliseconds);

        if (frameTimes.length > 600)
        {
            frameTimes.shift();
        }

        updateMovement(delta);
        application.dispatch({ type: 'tick', deltaSeconds: delta });
        refreshView();
        const model = application.getReadModel();
        const seated = model.mode === 'tabletop' || model.mode === 'beadwork'
            || (model.mode === 'transition' && model.transition?.kind !== 'stand');
        avatarTarget.set(model.avatar.x, 0, model.avatar.z);

        if (seated)
        {
            avatarTarget.copy(environment.seatPosition);
        }

        environment.avatar.position.lerp(avatarTarget, 1 - Math.exp(-delta * 12));
        environment.avatar.rotation.y = seated ? Math.PI : model.avatar.yaw;
        const walking = model.mode === 'workshop' && hasMovementKeys() && !hud.modalOpen;
        environment.update(elapsed, walking, seated);
        cameraRig.update(delta, model, environment.avatar.position);
        boardView.setDetail(cameraRig.detailAmount);
        boardView.update(elapsed);
        finishingView.update(elapsed, pointerWorld, pointerMode === 'iron');
        materials.update(elapsed);
        outline.render(scene, cameraRig.camera);
    }

    frameRequest = requestAnimationFrame(frame);
}

function updateMovement(delta: number): void
{
    if (hud.modalOpen || !hasMovementKeys())
    {
        return;
    }

    const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));

    if (application.getReadModel().mode === 'workshop')
    {
        application.dispatch({ type: 'move', x, z, deltaSeconds: delta });
    }
    else if (application.getReadModel().mode === 'beadwork')
    {
        cameraRig.pan(-x * delta * 220, -z * delta * 220);
    }
}

function hasMovementKeys(): boolean
{
    return keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
}

function resize(): void
{
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    cameraRig.resize(window.innerWidth, window.innerHeight);
}

function pickCell(event: PointerEvent): { x: number; y: number } | null
{
    const bounds = hud.canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    raycaster.setFromCamera(pointer, cameraRig.camera);

    if (raycaster.ray.intersectPlane(boardPlane, hit) === null)
    {
        pointerWorld = null;
        return null;
    }

    const cell = boardView.hitCell(hit);

    if (cell === null)
    {
        pointerWorld = null;
    }
    else
    {
        pointerWorld ??= new Vector3();
        pointerWorld.copy(hit);
    }

    return cell;
}

function ironArea(cell: { x: number; y: number }): void
{
    const model = application.getReadModel();

    for (let offsetY = -1; offsetY <= 1; offsetY += 1)
    {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1)
        {
            const x = cell.x + offsetX;
            const y = cell.y + offsetY;

            if (x >= 0 && y >= 0 && x < model.board.width && y < model.board.height)
            {
                runCommand({ type: 'ironCell', x, y });
            }
        }
    }
}

function interruptInput(): void
{
    keys.clear();
    pointerMode = 'none';
    pointerWorld = null;
    boardView.setHover(null);
    runCommand({ type: 'endStroke' });
}

function bindInput(): void
{
    const options = { signal: inputLifetime.signal };
    window.addEventListener('resize', resize, options);
    window.addEventListener('blur', interruptInput, options);
    window.addEventListener('pagehide', save, options);
    document.addEventListener('visibilitychange', () =>
    {
        if (document.hidden)
        {
            interruptInput();
            save();
        }

        previousTime = performance.now();
    }, options);
    hud.canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    hud.canvas.addEventListener('wheel', (event) =>
    {
        if (hud.modalOpen || !isReady)
        {
            return;
        }

        event.preventDefault();
        interruptInput();
        let delta = event.deltaY;

        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE)
        {
            delta *= 16;
        }
        else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
        {
            delta *= window.innerHeight;
        }

        const action = cameraRig.wheel(delta, application.getReadModel());

        if (action !== null)
        {
            runCommand({ type: action });
        }
    }, { ...options, passive: false });
    hud.canvas.addEventListener('pointerdown', (event) =>
    {
        if (hud.modalOpen || !isReady || application.getReadModel().mode === 'transition')
        {
            return;
        }

        hud.canvas.focus({ preventScroll: true });
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        const model = application.getReadModel();

        if (event.button === 2 && model.mode === 'workshop')
        {
            pointerMode = 'orbit';
        }
        else if ((event.button === 1 || keys.has('Space')) && model.mode === 'beadwork')
        {
            pointerMode = 'pan';
        }
        else if (event.button === 0)
        {
            const cell = pickCell(event);

            if (cell === null)
            {
                return;
            }

            if (model.mode === 'tabletop')
            {
                runCommand({ type: 'focus' });
                return;
            }

            if (model.mode !== 'beadwork')
            {
                hud.notify('先按 E 坐到工作台，再开始拼豆。');
                return;
            }

            if (model.stage === 'ironing')
            {
                pointerMode = 'iron';
                ironArea(cell);
            }
            else
            {
                pointerMode = 'paint';
                runCommand({ type: 'beginStroke', ...cell });
            }
        }

        if (pointerMode !== 'none')
        {
            event.preventDefault();
            hud.canvas.setPointerCapture(event.pointerId);
        }
    }, options);
    hud.canvas.addEventListener('pointermove', (event) =>
    {
        const surface = document.elementFromPoint(event.clientX, event.clientY);

        if (surface !== hud.canvas && (pointerMode === 'paint' || pointerMode === 'iron'))
        {
            interruptInput();
            return;
        }

        const deltaX = event.clientX - lastPointerX;
        const deltaY = event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;

        if (pointerMode === 'orbit')
        {
            cameraRig.orbit(deltaX, deltaY);
            return;
        }

        if (pointerMode === 'pan')
        {
            cameraRig.pan(deltaX, deltaY);
            return;
        }

        if (application.getReadModel().mode !== 'beadwork' || hud.modalOpen || surface !== hud.canvas)
        {
            boardView.setHover(null);
            return;
        }

        const cell = pickCell(event);
        boardView.setHover(cell);

        if (pointerMode === 'paint')
        {
            runCommand(cell === null ? { type: 'pauseStroke' } : { type: 'continueStroke', ...cell });
        }
        else if (pointerMode === 'iron' && cell !== null)
        {
            ironArea(cell);
        }
    }, options);
    hud.canvas.addEventListener('pointerup', () =>
    {
        pointerMode = 'none';
        runCommand({ type: 'endStroke' });
        save();
    }, options);
    hud.canvas.addEventListener('pointercancel', interruptInput, options);
    hud.canvas.addEventListener('lostpointercapture', () =>
    {
        pointerMode = 'none';
        runCommand({ type: 'endStroke' });
    }, options);
    hud.canvas.addEventListener('pointerleave', () =>
    {
        boardView.setHover(null);

        if (pointerMode === 'paint')
        {
            runCommand({ type: 'pauseStroke' });
        }
    }, options);
    window.addEventListener('keydown', (event) =>
    {
        if (hud.modalOpen || !isReady || event.target instanceof HTMLInputElement)
        {
            return;
        }

        if (event.target instanceof HTMLButtonElement && (event.code === 'Space' || event.code === 'Enter'))
        {
            return;
        }

        keys.add(event.code);

        if (event.code === 'Space' || event.code.startsWith('Arrow'))
        {
            event.preventDefault();
        }

        if (event.repeat)
        {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ')
        {
            event.preventDefault();
            runCommand({ type: event.shiftKey ? 'redo' : 'undo' });
        }
        else if (event.code === 'KeyE')
        {
            const mode = application.getReadModel().mode;

            if (mode === 'workshop' || mode === 'tabletop')
            {
                runCommand({ type: mode === 'workshop' ? 'sit' : 'stand' });
            }
        }
        else if (/^Digit[1-9]$/.test(event.code))
        {
            runCommand({ type: 'selectColor', colorNumber: Number(event.code.slice(-1)) });
        }
        else if (event.code === 'KeyB' || event.code === 'KeyX')
        {
            runCommand({ type: 'selectTool', tool: event.code === 'KeyB' ? 'place' : 'erase' });
        }
    }, options);
    window.addEventListener('keyup', (event) => keys.delete(event.code), options);
}

function save(): void
{
    if (!storageWritable)
    {
        return;
    }

    try
    {
        localStorage.setItem(SAVE_KEY, application.exportSave());
        hud.setSaveStatus('已保存到这台设备');
    }
    catch (error)
    {
        hud.setSaveStatus('暂未保存，请保持页面开启');
        console.warn('[Workshop] Local save write failed.', error);
    }
}

function restoreSave(): void
{
    try
    {
        const serialized = localStorage.getItem(SAVE_KEY);

        if (serialized !== null)
        {
            const result = application.dispatch({ type: 'restore', serialized });

            if (!result.accepted)
            {
                storageWritable = false;
                hud.setSaveStatus('旧存档已保留，本轮暂不覆盖');
                hud.notify('旧存档暂时无法读取，原始数据已保留。');
            }
        }
    }
    catch (error)
    {
        storageWritable = false;
        hud.setSaveStatus('本次制作暂存在页面中');
        console.warn('[Workshop] Local save read failed.', error);
    }
}

if (import.meta.hot)
{
    import.meta.hot.dispose(() =>
    {
        disposed = true;
        save();
        cancelAnimationFrame(frameRequest);
        window.clearTimeout(saveTimer);
        inputLifetime.abort();
        hud.dispose();
        outline.dispose();
        boardView.dispose();
        finishingView.dispose();
        environment.dispose();
        beadModels.dispose();
        lighting.traverse((object) =>
        {
            if (object instanceof DirectionalLight)
            {
                object.shadow.dispose();
            }
        });
        materials.dispose();
        renderer.dispose();
    });
}
