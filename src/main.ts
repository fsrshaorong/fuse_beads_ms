import {
    DirectionalLight, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer
} from 'three';

import { WorkshopApplication } from './App/WorkshopApplication';
import { OnlineWorkshopApplication } from './App/OnlineWorkshopApplication';
import { MultiplayerClient } from './Networking/MultiplayerClient';
import { RoomPanel } from './Ui/RoomPanel';
import { PartnerView } from './Scene/PartnerView';
import { WORKSHOP_LAYOUT } from './Core/Multiplayer/WorkshopLayout';
import type { WorkshopCommand, WorkshopReadModel } from './App/WorkshopApplication';
import { BeadBoardView } from './Rendering/BeadBoardView';
import { BEAD_TOP_Y } from './Rendering/BeadDimensions';
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

const localApplication = new WorkshopApplication();
let application: WorkshopApplication | OnlineWorkshopApplication = localApplication;
let online: OnlineWorkshopApplication | null = null;
const ONLINE_KEY = 'fuse-beads.online-session.v1';
const OUTBOX_KEY = 'fuse-beads.online-outbox.v1';
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
const walkDirection = new Vector3();
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
const roomPanel = new RoomPanel(root, {
    create: (nickname, name) => connectRoom(nickname, { name }),
    join: (nickname, roomId) => connectRoom(nickname, { roomId }),
    leave: leaveRoom,
    interrupt: interruptInput,
    notify: (message) => hud.notify(message)
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
const beadModels = await loadBeadModels(`${import.meta.env.BASE_URL}models/mini-bead-kit.glb`).catch((error: unknown) =>
{
    hud.fail('拼豆模型加载失败，请刷新重试。');
    throw error;
});
const environment = createWorkshopEnvironment(materials, beadModels);
const partners = new PartnerView(environment.avatar, materials);
const boardView = new BeadBoardView(materials, beadModels);
boardView.root.position.copy(environment.boardPosition);
const finishingView = new FinishingView(materials, environment.displayPosition, beadModels);
scene.add(environment.root, boardView.root, finishingView.root, partners.root);
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
    environment.updateCutaway(cameraRig.camera.position, false);
    outline.render(scene, cameraRig.camera);
    hud.ready();
    previousTime = performance.now();
    frameRequest = requestAnimationFrame(frame);
    void resumeOnline();
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
    metrics()
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
            beadDimensions: boardView.dimensions,
            beadModels: boardView.metrics(),
            zoom: cameraRig.zoom,
            online: online !== null,
            connected: online?.client.ready ?? false,
            roomId: online?.room.roomId ?? null,
            playerId: online?.client.session?.playerId ?? null,
            players: online?.room.players ?? [],
            pending: online?.pendingCount ?? 0,
            visibleWalls: ['CutawayBackWall', 'CutawayLeftWall', 'CutawayRightWall', 'CutawayFrontWall']
                .filter((name) => environment.root.getObjectByName(name)?.visible),
            partnerCount: partners.root.children.filter((object) => object.name.startsWith('Partner:')).length,
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
            'collection-full': '本地收藏已经放满了，当前图案会继续保留。',
            'not-connected': '连接暂时断开，正在重连；已确认的作品会保留。'
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

        if (online === null && command.type !== 'tick' && command.type !== 'move')
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
        hud.update(model, online === null ? Math.hypot(model.avatar.x, model.avatar.z - 1.8) <= 1.35 : online.nearestSeat !== null);
        finishingView.sync(model);
        lastViewRevision = model.revision;
    }
    hud.setOnline(online);
    roomPanel.update(online);

    if (model.board.revision !== lastBoardRevision || model.pattern.patternId !== lastPattern
        || model.stage !== lastStage || model.ironProgress !== lastIronProgress)
    {
        boardView.sync(model);
        boardPlane.constant = -boardView.hitPlaneHeight;
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
            if (online !== null && online.player?.seat !== null && online.player?.seat !== undefined)
            {
                const seat = WORKSHOP_LAYOUT.seats[online.player.seat];
                avatarTarget.set(seat.x, -0.03, seat.z);
            }
            else { avatarTarget.copy(environment.seatPosition); }
        }

        environment.avatar.position.lerp(avatarTarget, 1 - Math.exp(-delta * 12));
        environment.avatar.rotation.y = seated && online === null ? Math.PI : model.avatar.yaw;
        const walking = model.mode === 'workshop' && hasMovementKeys() && !hud.modalOpen;
        environment.update(elapsed, walking, seated);
        cameraRig.setSeat(online?.player?.seat ?? 0);
        cameraRig.update(delta, model, environment.avatar.position);
        environment.updateCutaway(cameraRig.camera.position, model.mode === 'beadwork');
        const gallery = finishingView.root.getObjectByName('FinishedPlayerArtworks');
        if (gallery !== undefined) { gallery.visible = environment.root.getObjectByName('CutawayBackWall')?.visible ?? true; }
        partners.update(online?.room ?? null, online?.client.session?.playerId, boardView, delta, elapsed, model.mode === 'beadwork');
        boardView.setDetail(cameraRig.detailAmount);
        boardView.update(elapsed);
        let ironPoint = pointerWorld;
        let ironing = pointerMode === 'iron';
        if (online !== null && !online.ownsIron)
        {
            const holder = online.room.players.find((player) => player.playerId === online?.room.ironLease?.playerId);
            ironing = holder?.cursor !== null && holder?.cursor !== undefined;
            ironPoint = ironing ? boardView.cellWorld(holder!.cursor! % model.pattern.width, Math.floor(holder!.cursor! / model.pattern.width), hit) : null;
        }
        finishingView.update(elapsed, ironPoint, ironing);
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
        cameraRig.getWalkDirection(x, -z, walkDirection);
        application.dispatch({ type: 'move', x: walkDirection.x, z: walkDirection.z, deltaSeconds: delta });
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
    online?.setCursor(cell);

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
    online?.setCursor(null);
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
    if (online !== null) { return; }
    if (!storageWritable)
    {
        return;
    }

    try
    {
        localStorage.setItem(SAVE_KEY, localApplication.exportSave());
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
            const result = localApplication.dispatch({ type: 'restore', serialized });

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

async function connectRoom(nickname: string, target: { name: string } | { roomId: string }): Promise<void>
{
    if (online !== null) { throw new Error('请先离开当前小店。'); }
    if (!nickname.trim()) { throw new Error('先给自己取个名字吧。'); }
    interruptInput();
    save();
    let token: string | undefined;
    let savedCommands: unknown[] = [];
    let savedPlayer: string | undefined;
    try
    {
        token = JSON.parse(sessionStorage.getItem(ONLINE_KEY) ?? '{}').token;
        const outbox = JSON.parse(sessionStorage.getItem(OUTBOX_KEY) ?? '{}');
        savedCommands = Array.isArray(outbox.commands) ? outbox.commands : [];
        savedPlayer = outbox.playerId;
    }
    catch { /* Session storage may be unavailable; normal single-player saves remain untouched. */ }
    const url = import.meta.env.VITE_MULTIPLAYER_URL || location.origin;
    const client = new MultiplayerClient(url, token === undefined ? { nickname } : { token });
    try
    {
        const session = await client.connect();
        const snapshot = 'name' in target
            ? await client.create({ opId: crypto.randomUUID(), name: target.name })
            : await client.join(target.roomId);
        const instance = new OnlineWorkshopApplication(client, savedPlayer === session.playerId ? savedCommands : []);
        online = instance;
        application = instance;
        instance.onNotice = (message) => hud.notify(message);
        instance.persist = (commands) =>
        {
            try { sessionStorage.setItem(OUTBOX_KEY, JSON.stringify({ playerId: session.playerId, commands })); }
            catch { hud.notify('浏览器暂时无法保存待确认操作，请保持页面开启。'); }
        };
        client.onError = (error) => hud.notify(error.message === 'session-replaced'
            ? '同一身份已在另一页面连接，可用“新玩家打开测试”加入。' : '正在尝试恢复联机连接…');
        try { sessionStorage.setItem(ONLINE_KEY, JSON.stringify({ token: session.token, nickname: session.nickname, roomId: snapshot.roomId })); }
        catch { hud.notify('这次联机身份暂存于页面中，刷新后可能需要重新加入。'); }
        resetViewCache();
        cameraRig.initializeWorldView(environment.avatar.position);
        hud.notify('已进入小店。走近任意空座位，按 E 一起拼豆。');
    }
    catch (error)
    {
        client.close();
        throw error;
    }
}

async function leaveRoom(): Promise<void>
{
    if (online === null) { return; }
    const instance = online;
    interruptInput();
    await instance.drain();
    await instance.client.leave();
    instance.dispose();
    online = null;
    application = localApplication;
    try
    {
        const saved = JSON.parse(sessionStorage.getItem(ONLINE_KEY) ?? '{}');
        sessionStorage.setItem(ONLINE_KEY, JSON.stringify({ token: saved.token, nickname: saved.nickname }));
        sessionStorage.removeItem(OUTBOX_KEY);
    }
    catch { /* Optional session persistence. */ }
    history.replaceState(null, '', location.pathname);
    resetViewCache();
    hud.setSaveStatus('已回到本机作品');
    save();
}

function resetViewCache(): void
{
    lastViewRevision = -1; lastBoardRevision = -1; lastPattern = ''; lastStage = ''; lastIronProgress = -1;
    refreshView();
}

async function resumeOnline(): Promise<void>
{
    const query = new URL(location.href).searchParams;
    const invited = query.get('room');
    try
    {
        if (query.get('guest') === 'new')
        {
            sessionStorage.removeItem(ONLINE_KEY);
            sessionStorage.removeItem(OUTBOX_KEY);
            query.delete('guest');
            history.replaceState(null, '', `${location.pathname}?${query}`);
        }
        const saved = JSON.parse(sessionStorage.getItem(ONLINE_KEY) ?? '{}');
        if (saved.token && (invited === null || invited === saved.roomId) && saved.roomId)
        {
            await connectRoom(saved.nickname ?? '手作朋友', { roomId: saved.roomId });
        }
        else if (invited !== null) { roomPanel.open(invited); }
    }
    catch { hud.notify('暂未恢复联机，可点击“一起拼豆”重新加入。'); }
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
        roomPanel.dispose();
        online?.dispose();
        partners.dispose();
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
