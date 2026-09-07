import {
    BufferGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    Float32BufferAttribute,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry,
    Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { PainterlyRole } from '../Rendering/PainterlyMaterials';
import { REFERENCE_PAINTERLY_PALETTE } from '../Rendering/ReferenceProfile';
import { BOARD_SURFACE_Y } from '../Rendering/BeadDimensions';
import type { BeadModels } from '../Rendering/BeadModels';
import { WORKSHOP_LAYOUT } from '../Core/Multiplayer/WorkshopLayout';

export interface WorkshopMaterialFactory
{
    create(color: string, role: PainterlyRole): MeshStandardMaterial;
}

export interface WorkshopEnvironment
{
    root: Group;
    avatar: Group;
    seatPosition: Vector3;
    standPosition: Vector3;
    boardPosition: Vector3;
    displayPosition: Vector3;
    workbench: Mesh;
    update(time: number, isWalking: boolean, isSeated: boolean): void;
    updateCutaway(cameraPosition: Vector3, closeUp: boolean): void;
    dispose(): void;
}

const PALETTE = [
    REFERENCE_PAINTERLY_PALETTE.wood,
    REFERENCE_PAINTERLY_PALETTE.yellow,
    REFERENCE_PAINTERLY_PALETTE.accent,
    REFERENCE_PAINTERLY_PALETTE.lavender,
    REFERENCE_PAINTERLY_PALETTE.fabric,
    REFERENCE_PAINTERLY_PALETTE.blue
];

// Source: live ToyRoomScene-CuoAGneb.js, cf() palette and M() material roles.
// The shop keeps its geometry, while every authored surface takes an exact
// reference role instead of introducing a second palette of beige variations.
const REFERENCE_SURFACE_ROLES: Readonly<Record<string, PainterlyRole>> = {
    [REFERENCE_PAINTERLY_PALETTE.background]: 'background',
    [REFERENCE_PAINTERLY_PALETTE.ground]: 'ground',
    [REFERENCE_PAINTERLY_PALETTE.wood]: 'wood',
    [REFERENCE_PAINTERLY_PALETTE.woodDark]: 'woodDark',
    [REFERENCE_PAINTERLY_PALETTE.fabric]: 'fabric',
    [REFERENCE_PAINTERLY_PALETTE.accent]: 'accent',
    [REFERENCE_PAINTERLY_PALETTE.cream]: 'cream',
    [REFERENCE_PAINTERLY_PALETTE.lavender]: 'lavender',
    [REFERENCE_PAINTERLY_PALETTE.yellow]: 'yellow',
    [REFERENCE_PAINTERLY_PALETTE.charcoal]: 'charcoal',
    [REFERENCE_PAINTERLY_PALETTE.green]: 'green',
    [REFERENCE_PAINTERLY_PALETTE.blue]: 'blue'
};

/** Builds an authored miniature craft shop; gameplay and camera ownership stay outside. */
export function createWorkshopEnvironment(materials: WorkshopMaterialFactory, beadModels: BeadModels): WorkshopEnvironment
{
    const root = new Group();
    root.name = 'LittleColourWorkshop';
    const geometryCache = new Map<string, BufferGeometry>();
    const materialCache = new Map<string, MeshStandardMaterial>();
    const ownedGeometries = new Set<BufferGeometry>();
    const ownedExtraMaterials = new Set<MeshStandardMaterial | MeshBasicMaterial>();
    const ownedTextures = new Set<CanvasTexture>();
    const staticAssemblies: Group[] = [];
    let disposed = false;

    function material(color: string, role: PainterlyRole): MeshStandardMaterial
    {
        const surfaceRole = role === 'bead' || role === 'board'
            ? role
            : REFERENCE_SURFACE_ROLES[color] ?? role;
        const key = `${surfaceRole}:${color}`;
        let result = materialCache.get(key);
        if (result === undefined)
        {
            result = materials.create(color, surfaceRole);
            materialCache.set(key, result);
        }
        return result;
    }

    function cached(key: string, create: () => BufferGeometry): BufferGeometry
    {
        let geometry = geometryCache.get(key);
        if (geometry === undefined)
        {
            geometry = create();
            geometryCache.set(key, geometry);
        }
        return geometry;
    }

    function assembly(name: string): Group
    {
        const group = new Group();
        group.name = name;
        root.add(group);
        staticAssemblies.push(group);
        return group;
    }

    function mesh(
        parent: Object3D,
        name: string,
        geometry: BufferGeometry,
        color: string,
        role: PainterlyRole,
        x: number,
        y: number,
        z: number
    ): Mesh
    {
        const result = new Mesh(geometry, material(color, role));
        result.name = name;
        result.position.set(x, y, z);
        result.castShadow = true;
        result.receiveShadow = true;
        parent.add(result);
        return result;
    }

    function box(
        parent: Object3D,
        name: string,
        size: [number, number, number],
        position: [number, number, number],
        color: string,
        role: PainterlyRole = 'wood',
        radius = 0.035
    ): Mesh
    {
        const rounding = Math.min(radius, Math.min(...size) * 0.46);
        const key = `box:${size.join(':')}:${rounding}`;
        return mesh(parent, name, cached(key, () => new RoundedBoxGeometry(
            size[0], size[1], size[2], 2, rounding
        )), color, role, ...position);
    }

    function cylinder(
        parent: Object3D,
        name: string,
        radius: number,
        height: number,
        position: [number, number, number],
        color: string,
        role: PainterlyRole = 'wood',
        topRadius = radius
    ): Mesh
    {
        return mesh(parent, name, cached(`cyl:${radius}:${topRadius}:${height}`, () =>
            new CylinderGeometry(topRadius, radius, height, 24, 1)
        ), color, role, ...position);
    }

    function ellipsoid(
        parent: Object3D,
        name: string,
        position: [number, number, number],
        scale: [number, number, number],
        color: string,
        role: PainterlyRole
    ): Mesh
    {
        const result = mesh(parent, name, cached('sphere', () => new SphereGeometry(1, 20, 12)),
            color, role, ...position);
        result.scale.set(...scale);
        return result;
    }

    function ring(
        parent: Object3D,
        name: string,
        radius: number,
        thickness: number,
        position: [number, number, number],
        color: string,
        role: PainterlyRole
    ): Mesh
    {
        const result = mesh(parent, name, cached(`ring:${radius}:${thickness}`, () =>
            new TorusGeometry(radius, thickness, 8, 32)
        ), color, role, ...position);
        result.rotation.x = Math.PI / 2;
        return result;
    }

    function rod(
        parent: Object3D,
        name: string,
        start: Vector3,
        end: Vector3,
        radius: number,
        color: string,
        role: PainterlyRole
    ): Mesh
    {
        const direction = end.clone().sub(start);
        const center = start.clone().add(end).multiplyScalar(0.5);
        const result = cylinder(parent, name, radius, direction.length(),
            [center.x, center.y, center.z], color, role);
        result.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
        return result;
    }

    // A dollhouse cutaway keeps the work surface visible from the overview camera.
    const architecture = assembly('WarmPlasterRoom');
    const wallBack = assembly('CutawayBackWall');
    const wallLeft = assembly('CutawayLeftWall');
    const wallRight = assembly('CutawayRightWall');
    const wallFront = assembly('CutawayFrontWall');
    const roof = assembly('CutawayRoof');
    box(architecture, 'FloorPlinth', [9.08, 0.18, 7.48], [0, -0.14, 0], REFERENCE_PAINTERLY_PALETTE.ground, 'wood', 0.08).castShadow = false;
    box(architecture, 'FloorFoundation', [8.88, 0.12, 7.28], [0, -0.065, 0], REFERENCE_PAINTERLY_PALETTE.ground, 'floor').castShadow = false;
    for (let row = 0; row < 16; row += 1)
    {
        const z = -3.36 + row * 0.447;
        box(architecture, `OakFloorboard:${row}`, [8.79, 0.027, 0.44], [0, 0.006, z],
            REFERENCE_PAINTERLY_PALETTE.ground, 'floor', 0.009).castShadow = false;
        for (let joint = 0; joint < 3; joint += 1)
        {
            const x = -3.1 + joint * 2.9 + (row % 3) * 0.37;
            box(architecture, `FloorJoint:${row}:${joint}`, [0.009, 0.003, 0.42], [x, 0.021, z],
                REFERENCE_PAINTERLY_PALETTE.ground, 'floor', 0.001).castShadow = false;
        }
    }
    box(architecture, 'BackPlasterWall', [8.96, 3.5, 0.18], [0, 1.75, -3.65], REFERENCE_PAINTERLY_PALETTE.background, 'wall', 0.06).castShadow = false;
    box(architecture, 'LeftPlasterWall', [0.18, 3.5, 7.3], [-4.45, 1.75, -0.05], REFERENCE_PAINTERLY_PALETTE.background, 'wall', 0.06).castShadow = false;
    box(architecture, 'BackSkirting', [8.8, 0.21, 0.08], [0, 0.13, -3.52], REFERENCE_PAINTERLY_PALETTE.cream, 'wood');
    box(architecture, 'LeftSkirting', [0.08, 0.21, 7.18], [-4.32, 0.13, -0.02], REFERENCE_PAINTERLY_PALETTE.cream, 'wood');
    box(architecture, 'BackPictureRail', [8.84, 0.065, 0.065], [0, 3.23, -3.52], REFERENCE_PAINTERLY_PALETTE.cream, 'wood');
    box(architecture, 'LeftPictureRail', [0.065, 0.065, 7.18], [-4.32, 3.23, -0.02], REFERENCE_PAINTERLY_PALETTE.cream, 'wood');
    for (const child of [...architecture.children])
    {
        if (child.name.startsWith('Back'))
        {
            wallBack.add(child);
            child.scale.x *= 11.8 / 8.9;
            child.position.z -= 1.05;
        }
        else if (child.name.startsWith('Left'))
        {
            wallLeft.add(child);
            child.scale.z *= 9.4 / 7.3;
            child.position.x -= 1.45;
        }
        else
        {
            child.scale.x *= 11.8 / 8.9;
            child.scale.z *= 9.4 / 7.3;
            child.position.x *= 11.8 / 8.9;
            child.position.z *= 9.4 / 7.3;
        }
    }
    box(wallRight, 'RightPlasterWall', [0.18, 3.5, 9.4], [5.9, 1.75, 0], REFERENCE_PAINTERLY_PALETTE.background, 'wall', 0.06);
    for (const x of [-3.38, 3.38])
    {
        box(wallFront, 'EntranceWall', [5.0, 3.5, 0.18], [x, 1.75, 4.7], REFERENCE_PAINTERLY_PALETTE.background, 'wall', 0.06);
    }
    box(wallFront, 'DoorLintel', [1.85, 0.80, 0.18], [0, 3.1, 4.7], REFERENCE_PAINTERLY_PALETTE.background, 'wall');
    box(wallFront, 'SageShopDoor', [1.64, 2.68, 0.07], [0, 1.34, 4.66], REFERENCE_PAINTERLY_PALETTE.accent, 'wood');
    box(wallFront, 'DoorWindow', [1.30, 1.55, 0.03], [0, 1.78, 4.60], REFERENCE_PAINTERLY_PALETTE.blue, 'ceramic');
    box(roof, 'CreamCeiling', [11.8, 0.16, 9.4], [0, 3.57, 0], REFERENCE_PAINTERLY_PALETTE.cream, 'wall');
    for (const wall of [wallBack, wallLeft, wallRight, wallFront, roof])
    {
        wall.traverse((object) => { object.castShadow = false; });
    }

    const window = assembly('SageCurtainedWindow');
    box(window, 'WindowRecess', [0.075, 1.94, 2.56], [-4.305, 2.01, -0.63], REFERENCE_PAINTERLY_PALETTE.accent, 'wood').castShadow = false;
    box(window, 'BlueMorningGlass', [0.018, 1.72, 2.32], [-4.249, 2.01, -0.63], REFERENCE_PAINTERLY_PALETTE.blue, 'ceramic').castShadow = false;
    for (const z of [-1.85, -0.63, 0.59])
    {
        box(window, 'WindowMullion', [0.09, 1.9, 0.065], [-4.2, 2.01, z], REFERENCE_PAINTERLY_PALETTE.cream, 'wood', 0.012);
    }
    for (const y of [1.09, 2.0, 2.94])
    {
        box(window, 'WindowCrossbar', [0.09, 0.065, 2.53], [-4.2, y, -0.63], REFERENCE_PAINTERLY_PALETTE.cream, 'wood', 0.012);
    }
    box(window, 'DeepWindowSill', [0.38, 0.10, 2.72], [-4.13, 1.02, -0.63], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    rod(window, 'CurtainRod', new Vector3(-4.05, 3.055, -2.14), new Vector3(-4.05, 3.055, 0.89),
        0.028, REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal');
    for (const side of [-1, 1])
    {
        const zCenter = -0.63 + side * 1.12;
        mesh(window, `PleatedCurtain:${side}`, createCurtainGeometry(),
            REFERENCE_PAINTERLY_PALETTE.fabric, 'fabric', -4.04, 1.96, zCenter)
            .userData.painterlyOutline = { enabled: false };
        for (let fold = 0; fold < 5; fold += 1)
        {
            const loop = ring(window, 'CurtainBrassLoop', 0.032, 0.007,
                [-4.045, 3.055, zCenter - 0.22 + fold * 0.11], REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal');
            loop.rotation.x = 0;
        }
    }

    // Same unlit, static floor patch as the reference, placed below this window.
    const sunPatchMaterial = new MeshBasicMaterial({
        color: '#ffc4a8', transparent: true, opacity: 0.12,
        depthWrite: false, toneMapped: false
    });
    ownedExtraMaterials.add(sunPatchMaterial);
    const sunPatch = new Mesh(new PlaneGeometry(2.2, 1.45, 5, 4), sunPatchMaterial);
    sunPatch.name = 'ReferenceWindowSunPatch';
    sunPatch.position.set(-3.2, 0.031, -0.63);
    sunPatch.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - 0.18);
    root.add(sunPatch);

    const rug = assembly('WovenApricotRug');
    box(rug, 'ThickWoolRug', [5.02, 0.035, 3.85], [0.02, 0.037, 0.60], REFERENCE_PAINTERLY_PALETTE.lavender, 'fabric', 0.075);
    box(rug, 'WovenRugInset', [4.75, 0.008, 3.59], [0.02, 0.058, 0.60], REFERENCE_PAINTERLY_PALETTE.lavender, 'fabric', 0.04);
    for (let index = 0; index < 15; index += 1)
    {
        for (const edge of [-1, 1])
        {
            box(rug, 'RugTassel', [0.035, 0.025, 0.16], [-2.19 + index * 0.318, 0.045, 0.60 + edge * 1.98],
                REFERENCE_PAINTERLY_PALETTE.lavender, 'fabric', 0.008).userData.painterlyOutline = { enabled: false };
        }
    }
    for (const x of [-2.20, 2.24])
    {
        box(rug, 'RugWovenBorder', [0.022, 0.006, 3.3], [x, 0.064, 0.60], REFERENCE_PAINTERLY_PALETTE.lavender, 'fabric', 0.002)
            .userData.painterlyOutline = { enabled: false };
    }

    const workbench = box(root, 'Workbench', [3.8, 0.18, 2.3], [0, 1.05, 0], REFERENCE_PAINTERLY_PALETTE.wood, 'wood', 0.075);
    workbench.userData.interaction = 'workbench';
    const desk = assembly('RoundedOakWorkbench');
    box(desk, 'TableFrontApron', [3.25, 0.24, 0.105], [0, 0.852, 0.95], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    box(desk, 'TableBackApron', [3.25, 0.24, 0.105], [0, 0.852, -0.95], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    for (const x of [-1.56, 1.56])
    {
        box(desk, 'TableSideApron', [0.105, 0.24, 1.90], [x, 0.852, 0], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
        for (const z of [-0.88, 0.88])
        {
            const leg = cylinder(desk, 'TaperedOakLeg', 0.067, 0.85, [x, 0.51, z], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood', 0.105);
            leg.rotation.z = x > 0 ? -0.04 : 0.04;
            cylinder(desk, 'LegFeltFoot', 0.071, 0.045, [x + Math.sign(x) * 0.017, 0.074, z], REFERENCE_PAINTERLY_PALETTE.charcoal, 'fabric');
        }
    }
    box(desk, 'ToolDrawer', [0.70, 0.185, 0.07], [0.87, 0.861, 1.027], REFERENCE_PAINTERLY_PALETTE.fabric, 'fabric');
    rod(desk, 'BrassDrawerPull', new Vector3(0.73, 0.86, 1.097), new Vector3(1.01, 0.86, 1.097),
        0.016, REFERENCE_PAINTERLY_PALETTE.yellow, 'metal');
    for (const x of [0.73, 1.01])
    {
        rod(desk, 'DrawerPullMount', new Vector3(x, 0.86, 1.05), new Vector3(x, 0.86, 1.097),
            0.017, REFERENCE_PAINTERLY_PALETTE.yellow, 'metal');
    }
    // Thin endgrain bands add construction detail without drawing lines across the board.
    for (const x of [-1.79, 1.79])
    {
        box(desk, 'BreadboardEndgrain', [0.055, 0.009, 2.13], [x, 1.141, 0], REFERENCE_PAINTERLY_PALETTE.wood, 'wood', 0.004);
    }

    const stool = assembly('RoundSageStool');
    cylinder(stool, 'StoolSeat', 0.34, 0.105, [0, 0.433, 1.65], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    ellipsoid(stool, 'SageSeatCushion', [0, 0.489, 1.65], [0.315, 0.041, 0.315], REFERENCE_PAINTERLY_PALETTE.accent, 'fabric');
    ring(stool, 'StoolFootrest', 0.234, 0.019, [0, 0.19, 1.65], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
    for (let leg = 0; leg < 4; leg += 1)
    {
        const angle = Math.PI / 4 + leg * Math.PI / 2;
        rod(stool, 'StoolSplayedLeg',
            new Vector3(Math.cos(angle) * 0.27, 0.06, 1.65 + Math.sin(angle) * 0.27),
            new Vector3(Math.cos(angle) * 0.19, 0.40, 1.65 + Math.sin(angle) * 0.19),
            0.035, REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
    }
    for (let index = 1; index < WORKSHOP_LAYOUT.seats.length; index += 1)
    {
        const chair = assembly(`PartnerStool:${index}`);
        const seat = WORKSHOP_LAYOUT.seats[index];
        for (const source of stool.children)
        {
            const copy = source.clone();
            copy.position.x += seat.x;
            copy.position.z += seat.z - 1.65;
            chair.add(copy);
        }
    }

    const cabinet = assembly('BeadLibraryCabinet');
    const cabinetX = -2.50;
    box(cabinet, 'CabinetBacking', [2.65, 1.83, 0.075], [cabinetX, 1.08, -3.39], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
    for (const x of [-3.825, -1.175])
    {
        box(cabinet, 'CabinetSide', [0.105, 1.98, 0.58], [x, 1.075, -3.14], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    }
    for (let row = 0; row < 4; row += 1)
    {
        box(cabinet, 'CubbyShelf', [2.67, 0.09, 0.59], [cabinetX, 0.25 + row * 0.56, -3.14], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    }
    box(cabinet, 'CabinetCrown', [2.85, 0.13, 0.69], [cabinetX, 2.02, -3.14], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    for (const dividerX of [-2.965, -2.035])
    {
        box(cabinet, 'CubbyDivider', [0.065, 1.71, 0.52], [dividerX, 1.09, -3.15], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    }
    for (let row = 0; row < 3; row += 1)
    {
        for (let column = 0; column < 3; column += 1)
        {
            const x = -3.40 + column * 0.91;
            const y = 0.295 + row * 0.56;
            const color = PALETTE[(row * 3 + column) % PALETTE.length];
            createJar(cabinet, x - 0.13, y, -3.02, color, 0.32);
            createJar(cabinet, x + 0.18, y, -3.10, PALETTE[(row + column + 2) % 6], 0.26);
        }
    }

    function createJar(parent: Group, x: number, base: number, z: number, color: string, height: number): void
    {
        cylinder(parent, 'BeadJarBody', 0.112, height - 0.055, [x, base + height / 2, z], color, 'ceramic');
        ring(parent, 'JarRoundedShoulder', 0.098, 0.016, [x, base + height - 0.030, z], color, 'ceramic');
        cylinder(parent, 'BeechJarLid', 0.114, 0.047, [x, base + height + 0.004, z], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
        box(parent, 'PaperJarLabel', [0.114, 0.090, 0.010], [x, base + height * 0.51, z + 0.112],
            REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic', 0.008);
        box(parent, 'JarLabelRule', [0.052, 0.008, 0.002], [x, base + height * 0.53, z + 0.119],
            REFERENCE_PAINTERLY_PALETTE.woodDark, 'ceramic', 0.001).userData.painterlyOutline = { enabled: false };
    }

    const gallery = assembly('LittleColourGallery');
    box(gallery, 'GalleryLowerShelf', [2.36, 0.09, 0.60], [2.67, 1.24, -3.06], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    box(gallery, 'GalleryShelfLip', [2.36, 0.055, 0.037], [2.67, 1.285, -2.762], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    box(gallery, 'GalleryUpperShelf', [2.36, 0.09, 0.40], [2.67, 2.56, -3.16], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    for (const x of [1.82, 3.53])
    {
        box(gallery, 'GalleryShelfBracket', [0.065, 0.31, 0.065], [x, 1.09, -3.30], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
        rod(gallery, 'GalleryDiagonalBracket', new Vector3(x, 0.95, -3.30), new Vector3(x, 1.20, -2.85),
            0.024, REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood');
    }
    createPoster('BotanicalPixelPoster', 0.68, 0.91, [0.05, 2.18, -3.49], 'flower');
    createPoster('LittleColourTypography', 0.68, 0.91, [0.87, 2.18, -3.49], 'type');
    createPoster('GalleryCherryPrint', 0.46, 0.52, [1.85, 1.60, -2.99], 'cherry');
    createPoster('GalleryFlowerPrint', 0.45, 0.53, [3.52, 1.61, -2.99], 'flower');
    createPoster('GalleryTinyStar', 0.43, 0.47, [2.22, 2.87, -3.24], 'star');
    createPoster('FriendsWallFlower', 0.78, 1.05, [0, 2.1, 0], 'flower');
    createPoster('FriendsWallCherry', 0.78, 1.05, [0, 2.1, 0], 'cherry');
    for (const [name, z] of [['FriendsWallFlower', -0.75], ['FriendsWallCherry', 0.65]] as const)
    {
        const poster = root.getObjectByName(name)!;
        poster.rotation.y = -Math.PI / 2;
        poster.position.set(5.76, 0, z);
    }

    function createPoster(
        name: string,
        width: number,
        height: number,
        position: [number, number, number],
        motif: 'flower' | 'cherry' | 'star' | 'type'
    ): void
    {
        const parent = assembly(name);
        box(parent, 'WalnutPictureFrame', [width + 0.08, height + 0.08, 0.052], position, REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood', 0.025);
        box(parent, 'PaperMat', [width, height, 0.010], [position[0], position[1], position[2] + 0.032],
            REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic', 0.004);
        const artwork = new Mesh(new PlaneGeometry(width * 0.88, height * 0.89),
            createPosterMaterial(materials, motif));
        ownedExtraMaterials.add(artwork.material);
        if (artwork.material.map instanceof CanvasTexture)
        {
            ownedTextures.add(artwork.material.map);
        }
        artwork.name = `${name}:PrintedArtwork`;
        artwork.position.set(position[0], position[1], position[2] + 0.039);
        artwork.receiveShadow = true;
        parent.add(artwork);
    }

    function plant(name: string, position: [number, number, number], scale = 1): void
    {
        const parent = assembly(name);
        const [x, y, z] = position;
        cylinder(parent, 'TerracottaPot', 0.22 * scale, 0.34 * scale,
            [x, y + 0.17 * scale, z], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic', 0.28 * scale);
        ring(parent, 'RolledPotRim', 0.268 * scale, 0.025 * scale,
            [x, y + 0.33 * scale, z], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic');
        cylinder(parent, 'PotSoil', 0.238 * scale, 0.016 * scale,
            [x, y + 0.325 * scale, z], REFERENCE_PAINTERLY_PALETTE.charcoal, 'floor');
        for (let leaf = 0; leaf < 11; leaf += 1)
        {
            const angle = leaf * 2.399;
            const reach = (0.21 + (leaf % 3) * 0.04) * scale;
            const height = (0.48 + (leaf % 4) * 0.09) * scale;
            const tip = new Vector3(x + Math.cos(angle) * reach, y + height, z + Math.sin(angle) * reach);
            rod(parent, 'PlantStem', new Vector3(x, y + 0.29 * scale, z), tip,
                0.008 * scale, REFERENCE_PAINTERLY_PALETTE.green, 'foliage');
            const blade = ellipsoid(parent, 'RubberPlantLeaf', [tip.x, tip.y, tip.z],
                [0.105 * scale, 0.025 * scale, 0.205 * scale],
                REFERENCE_PAINTERLY_PALETTE.green, 'foliage');
            blade.rotation.set(-0.24 - (leaf % 3) * 0.12, -angle + Math.PI / 2, 0.12);
        }
    }
    plant('LargeRubberPlant', [3.55, 0.04, -1.67], 1.2);
    plant('WindowHerbPot', [-4.03, 1.085, 0.25], 0.48);
    plant('CabinetPilea', [-3.42, 2.10, -3.11], 0.64);
    plant('GalleryLittlePlant', [3.38, 2.61, -3.16], 0.50);

    const accessories = assembly('WorkbenchToolsAndBeadTrays');
    // Sorting tools surround the fixed-size physical pegboard.
    box(accessories, 'SortingTrayBase', [0.46, 0.045, 1.37], [-1.36, 1.172, -0.01], REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic', 0.035);
    for (const x of [-1.58, -1.14])
    {
        box(accessories, 'TrayOuterRail', [0.036, 0.09, 1.37], [x, 1.215, -0.01], REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic', 0.012);
    }
    for (let divider = 0; divider < 5; divider += 1)
    {
        box(accessories, 'TrayCompartmentDivider', [0.46, 0.09, 0.03], [-1.36, 1.215, -0.68 + divider * 0.335],
            REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic', 0.012);
    }
    for (let compartment = 0; compartment < 4; compartment += 1)
    {
        scatterBeads(accessories, [-1.36, 1.1945, -0.51 + compartment * 0.335], PALETTE[compartment],
            10, 0.14, 0.094, compartment * 2.7);
    }
    for (let cup = 0; cup < 2; cup += 1)
    {
        const z = -0.39 + cup * 0.64;
        cylinder(accessories, 'GlazedBeadBowl', 0.23, 0.12, [1.34, 1.21, z], cup === 0 ? REFERENCE_PAINTERLY_PALETTE.accent : REFERENCE_PAINTERLY_PALETTE.fabric, 'ceramic', 0.25);
        cylinder(accessories, 'BowlInnerShadow', 0.217, 0.010, [1.34, 1.275, z], cup === 0 ? REFERENCE_PAINTERLY_PALETTE.accent : REFERENCE_PAINTERLY_PALETTE.fabric, 'ceramic');
        ring(accessories, 'BowlSoftRim', 0.242, 0.022, [1.34, 1.275, z], cup === 0 ? REFERENCE_PAINTERLY_PALETTE.accent : REFERENCE_PAINTERLY_PALETTE.fabric, 'ceramic');
        scatterBeads(accessories, [1.34, 1.280, z], PALETTE[cup + 4], 18, 0.177, 0.177, cup + 12);
    }
    for (const x of [-0.16, -0.10])
    {
        const tweezer = box(accessories, 'BrassTweezersArm', [0.023, 0.015, 0.42], [x, 1.167, 0.955], REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal', 0.007);
        tweezer.rotation.y = x < -0.12 ? -0.21 : -0.05;
    }
    const handle = cylinder(accessories, 'BeadPenWoodHandle', 0.035, 0.39, [0.55, 1.19, 0.976], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    handle.rotation.z = Math.PI / 2;
    const nib = cylinder(accessories, 'BeadPenBrassTip', 0.018, 0.11, [0.79, 1.19, 0.976], REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal', 0.006);
    nib.rotation.z = Math.PI / 2;
    box(accessories, 'FoldedLinenCloth', [0.38, 0.033, 0.23], [-1.28, 1.167, 0.935], REFERENCE_PAINTERLY_PALETTE.lavender, 'fabric', 0.025);

    function scatterBeads(
        parent: Group,
        center: [number, number, number],
        color: string,
        count: number,
        radiusX: number,
        radiusZ: number,
        phase: number
    ): void
    {
        const geometry = cached('decorativeMiniBead', () => beadModels.raw.clone());
        const instances = new InstancedMesh(geometry, material(color, 'bead'), count);
        instances.name = 'SortedLooseBeads';
        instances.castShadow = false;
        instances.receiveShadow = true;
        const transform = new Object3D();
        const vertexPosition = new Vector3();
        const positions = geometry.getAttribute('position');
        for (let index = 0; index < count; index += 1)
        {
            const distance = Math.sqrt((index + 0.5) / count);
            const angle = index * 2.399 + phase;
            transform.rotation.set(Math.sin(index * 7) * 0.22, angle, Math.cos(index * 3) * 0.18);
            let lowestVertex = Number.POSITIVE_INFINITY;
            for (let vertex = 0; vertex < positions.count; vertex += 1)
            {
                vertexPosition.fromBufferAttribute(positions, vertex).applyQuaternion(transform.quaternion);
                lowestVertex = Math.min(lowestVertex, vertexPosition.y);
            }
            transform.position.set(center[0] + Math.cos(angle) * radiusX * distance,
                center[1] - lowestVertex, center[2] + Math.sin(angle) * radiusZ * distance);
            transform.updateMatrix();
            instances.setMatrixAt(index, transform.matrix);
        }
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingSphere();
        parent.add(instances);
    }

    const lamp = assembly('ApricotDeskLamp');
    ellipsoid(lamp, 'LampWeightedBase', [1.47, 1.18, -0.96], [0.20, 0.039, 0.17], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic');
    rod(lamp, 'LampBrassUpright', new Vector3(1.47, 1.2, -0.96), new Vector3(1.47, 1.69, -0.96),
        0.023, REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal');
    rod(lamp, 'LampBentNeck', new Vector3(1.47, 1.69, -0.96), new Vector3(1.29, 1.74, -0.96),
        0.023, REFERENCE_PAINTERLY_PALETTE.charcoal, 'metal');
    cylinder(lamp, 'ApricotLampShade', 0.235, 0.20, [1.27, 1.64, -0.96], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic', 0.12);
    ring(lamp, 'LampShadeRolledRim', 0.233, 0.012, [1.27, 1.54, -0.96], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic');
    const bulb = ellipsoid(lamp, 'WarmLampBulb', [1.27, 1.54, -0.96], [0.069, 0.035, 0.069], REFERENCE_PAINTERLY_PALETTE.yellow, 'ceramic');
    const bulbMaterial = clonePainterlyMaterial(bulb.material as MeshStandardMaterial);
    bulbMaterial.emissive = new Color('#ffc4a8');
    bulbMaterial.emissiveIntensity = 0;
    bulb.material = bulbMaterial;
    ownedExtraMaterials.add(bulbMaterial);
    bulb.castShadow = false;

    const avatar = new Group();
    avatar.name = 'PlayerAvatar';
    avatar.position.set(0, 0, 2.4);
    avatar.rotation.y = Math.PI;
    root.add(avatar);
    box(avatar, 'LinenShirt', [0.38, 0.40, 0.25], [0, 0.77, 0], REFERENCE_PAINTERLY_PALETTE.cream, 'fabric', 0.105);
    box(avatar, 'TerracottaApron', [0.33, 0.36, 0.045], [0, 0.725, 0.139], REFERENCE_PAINTERLY_PALETTE.fabric, 'fabric', 0.045);
    box(avatar, 'ApronPocket', [0.155, 0.103, 0.014], [0, 0.701, 0.167], REFERENCE_PAINTERLY_PALETTE.background, 'fabric', 0.02);
    for (const side of [-1, 1])
    {
        const strap = box(avatar, 'ApronShoulderStrap', [0.038, 0.24, 0.015], [side * 0.107, 0.918, 0.107],
            REFERENCE_PAINTERLY_PALETTE.fabric, 'fabric', 0.006);
        strap.rotation.z = side * 0.16;
    }
    const head = new Group();
    head.name = 'AvatarHead';
    head.position.y = 1.105;
    avatar.add(head);
    ellipsoid(head, 'SoftRoundFace', [0, 0, 0], [0.221, 0.225, 0.197], REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic');
    ellipsoid(head, 'SoftBrownHair', [0, 0.098, -0.032], [0.232, 0.148, 0.195], REFERENCE_PAINTERLY_PALETTE.charcoal, 'fabric');
    const beret = ellipsoid(head, 'SageBeret', [0.025, 0.208, -0.015], [0.267, 0.081, 0.236], REFERENCE_PAINTERLY_PALETTE.accent, 'fabric');
    beret.rotation.z = -0.13;
    cylinder(head, 'BeretStalk', 0.018, 0.033, [0.03, 0.290, -0.008], REFERENCE_PAINTERLY_PALETTE.accent, 'fabric');
    for (const side of [-1, 1])
    {
        ellipsoid(head, 'AvatarEar', [side * 0.215, -0.01, -0.009], [0.037, 0.057, 0.038], REFERENCE_PAINTERLY_PALETTE.background, 'ceramic');
        ellipsoid(head, 'AvatarEye', [side * 0.068, 0.014, 0.187], [0.014, 0.019, 0.009], REFERENCE_PAINTERLY_PALETTE.charcoal, 'ceramic')
            .userData.painterlyOutline = { enabled: false };
        ellipsoid(head, 'AvatarRosyCheek', [side * 0.111, -0.039, 0.171], [0.029, 0.016, 0.009], REFERENCE_PAINTERLY_PALETTE.fabric, 'ceramic')
            .userData.painterlyOutline = { enabled: false };
    }
    ellipsoid(head, 'AvatarNose', [0, -0.023, 0.199], [0.023, 0.022, 0.022], REFERENCE_PAINTERLY_PALETTE.background, 'ceramic');
    const arms: Group[] = [];
    const legs: Group[] = [];
    const knees: Group[] = [];
    for (const side of [-1, 1])
    {
        const arm = new Group();
        arm.name = side < 0 ? 'AvatarLeftArm' : 'AvatarRightArm';
        arm.position.set(side * 0.245, 0.905, 0);
        avatar.add(arm);
        box(arm, 'RolledShirtSleeve', [0.14, 0.20, 0.17], [0, -0.064, 0], REFERENCE_PAINTERLY_PALETTE.cream, 'fabric', 0.06);
        ellipsoid(arm, 'AvatarForearm', [0, -0.206, 0], [0.060, 0.123, 0.059], REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic');
        ellipsoid(arm, 'AvatarHand', [0, -0.308, 0], [0.064, 0.062, 0.063], REFERENCE_PAINTERLY_PALETTE.cream, 'ceramic');
        arms.push(arm);
        const leg = new Group();
        leg.name = side < 0 ? 'AvatarLeftLeg' : 'AvatarRightLeg';
        leg.position.set(side * 0.109, 0.52, 0);
        avatar.add(leg);
        box(leg, 'SageTrouserThigh', [0.17, 0.23, 0.18], [0, -0.10, 0], REFERENCE_PAINTERLY_PALETTE.accent, 'fabric', 0.067);
        const knee = new Group();
        knee.name = side < 0 ? 'AvatarLeftKnee' : 'AvatarRightKnee';
        knee.position.y = -0.22;
        leg.add(knee);
        box(knee, 'SageTrouserCalf', [0.151, 0.18, 0.17], [0, -0.085, 0], REFERENCE_PAINTERLY_PALETTE.accent, 'fabric', 0.060);
        cylinder(knee, 'WarmWoolSock', 0.064, 0.085, [0, -0.175, 0.01], REFERENCE_PAINTERLY_PALETTE.cream, 'fabric');
        box(knee, 'SoftBrownShoe', [0.18, 0.12, 0.29], [0, -0.218, 0.045], REFERENCE_PAINTERLY_PALETTE.charcoal, 'wood', 0.051);
        legs.push(leg);
        knees.push(knee);
    }

    // Each named furniture assembly becomes a handful of material batches. Movable
    // avatars, gameplay meshes, and loose-bead instances retain their own identity.
    // Keep the source geometries too: merging detaches meshes from the scene graph.
    window.position.x -= 1.45;
    sunPatch.position.x -= 1.45;
    for (const group of staticAssemblies)
    {
        if (['BeadLibraryCabinet', 'LittleColourGallery', 'BotanicalPixelPoster', 'LittleColourTypography',
            'GalleryCherryPrint', 'GalleryFlowerPrint', 'GalleryTinyStar', 'CabinetPilea', 'GalleryLittlePlant'].includes(group.name))
        {
            group.position.z -= 1.05;
        }
        if (group.name === 'WindowHerbPot') { group.position.x -= 1.45; }
    }
    const entrance = assembly('WelcomeCorner');
    box(entrance, 'EntranceMat', [2.25, 0.035, 1.12], [0, 0.04, 3.62], REFERENCE_PAINTERLY_PALETTE.fabric, 'fabric', 0.06);
    box(entrance, 'WelcomeBench', [1.5, 0.10, 0.55], [4.55, 0.49, 2.65], REFERENCE_PAINTERLY_PALETTE.wood, 'wood');
    for (const x of [3.94, 5.16]) { box(entrance, 'BenchLeg', [0.11, 0.44, 0.42], [x, 0.22, 2.65], REFERENCE_PAINTERLY_PALETTE.woodDark, 'wood'); }
    plant('WelcomePlant', [-4.7, 0.04, 2.7], 1.25);
    root.traverse((object): void =>
    {
        if (object instanceof Mesh)
        {
            ownedGeometries.add(object.geometry);
        }
    });
    // The source's architecture and rug receive furniture shadows without
    // casting their own. Batch keys preserve this flag after geometry merging.
    rug.traverse((object) =>
    {
        object.castShadow = false;
    });
    for (const group of staticAssemblies)
    {
        mergeStaticAssembly(group);
    }

    return {
        root,
        avatar,
        workbench,
        seatPosition: new Vector3(0, -0.03, 1.65),
        standPosition: new Vector3(0, 0, 1.8),
        boardPosition: new Vector3(0, BOARD_SURFACE_Y, 0),
        displayPosition: new Vector3(2.68, 1.43, -4.0),
        updateCutaway(cameraPosition: Vector3, closeUp: boolean): void
        {
            const direction = [cameraPosition.z, cameraPosition.x, -cameraPosition.x, -cameraPosition.z];
            [wallBack, wallLeft, wallRight, wallFront].forEach((wall, index) =>
            {
                const threshold = wall.visible ? -0.8 : 0.8;
                wall.visible = !closeUp && direction[index] > threshold;
            });
            window.visible = wallLeft.visible;
            root.getObjectByName('WindowHerbPot')!.visible = wallLeft.visible;
            for (const name of ['LittleColourGallery', 'BotanicalPixelPoster', 'LittleColourTypography',
                'GalleryCherryPrint', 'GalleryFlowerPrint', 'GalleryTinyStar', 'GalleryLittlePlant'])
            {
                root.getObjectByName(name)!.visible = wallBack.visible;
            }
            for (const name of ['FriendsWallFlower', 'FriendsWallCherry'])
            {
                root.getObjectByName(name)!.visible = wallRight.visible;
            }
            roof.visible = !closeUp && cameraPosition.y < 3.15;
        },
        update(time: number, isWalking: boolean, isSeated: boolean): void
        {
            if (disposed)
            {
                return;
            }
            const stride = isWalking && !isSeated ? Math.sin(time * 9.5) * 0.42 : 0;
            legs[0].rotation.x = isSeated ? -1.25 : stride;
            legs[1].rotation.x = isSeated ? -1.25 : -stride;
            knees[0].rotation.x = isSeated ? 1.28 : Math.max(0, -stride * 0.65);
            knees[1].rotation.x = isSeated ? 1.28 : Math.max(0, stride * 0.65);
            arms[0].rotation.x = isSeated ? -0.65 : -stride * 0.8;
            arms[1].rotation.x = isSeated ? -0.65 : stride * 0.8;
            arms[0].rotation.z = 0.05;
            arms[1].rotation.z = -0.05;
            head.rotation.z = isWalking ? Math.sin(time * 4.75) * 0.025 : 0;
            head.rotation.x = isSeated ? 0.12 : 0;
        },
        dispose(): void
        {
            if (disposed)
            {
                return;
            }
            disposed = true;
            root.removeFromParent();
            root.traverse((object): void =>
            {
                if (object instanceof Mesh)
                {
                    ownedGeometries.add(object.geometry);
                }
                if (object instanceof InstancedMesh)
                {
                    object.dispose();
                }
            });
            for (const geometry of ownedGeometries)
            {
                geometry.dispose();
            }
            for (const texture of ownedTextures)
            {
                texture.dispose();
            }
            for (const extraMaterial of ownedExtraMaterials)
            {
                extraMaterial.dispose();
            }
            // All materialCache entries belong to the external painterly owner.
            root.clear();
            ownedGeometries.clear();
            ownedTextures.clear();
            ownedExtraMaterials.clear();
            geometryCache.clear();
            materialCache.clear();
            staticAssemblies.length = 0;
        }
    };
}

function createCurtainGeometry(): BufferGeometry
{
    const geometry = new PlaneGeometry(0.56, 2.02, 24, 8);
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1)
    {
        const horizontal = position.getX(index);
        const vertical = position.getY(index);
        const pleat = Math.cos((horizontal / 0.56 + 0.5) * Math.PI * 10) * 0.034;
        position.setXYZ(index, pleat, vertical, horizontal + Math.sin(vertical * 2.2) * 0.025);
    }
    geometry.computeVertexNormals();
    // A closed-looking reverse side avoids relying on factory-wide double-sided state.
    const back = geometry.clone();
    const indices = back.getIndex();
    if (indices !== null)
    {
        for (let index = 0; index < indices.count; index += 3)
        {
            const first = indices.getX(index);
            indices.setX(index, indices.getX(index + 2));
            indices.setX(index + 2, first);
        }
    }
    back.computeVertexNormals();
    const merged = mergeGeometries([geometry, back]);
    back.dispose();
    if (merged !== null)
    {
        geometry.dispose();
        return merged;
    }
    return geometry;
}

function createPosterMaterial(
    factory: WorkshopMaterialFactory,
    motif: 'flower' | 'cherry' | 'star' | 'type'
): MeshStandardMaterial
{
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context !== null)
    {
        context.fillStyle = REFERENCE_PAINTERLY_PALETTE.cream;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = REFERENCE_PAINTERLY_PALETTE.woodDark;
        context.font = '15px Georgia, serif';
        context.textAlign = 'center';
        context.fillText('L I T T L E   C O L O U R', 192, 48);
        if (motif === 'type')
        {
            context.fillStyle = REFERENCE_PAINTERLY_PALETTE.accent;
            context.font = 'italic 68px Georgia, serif';
            context.fillText('make', 192, 188);
            context.font = 'italic 44px Georgia, serif';
            context.fillText('a little', 192, 251);
            context.fillStyle = REFERENCE_PAINTERLY_PALETTE.wood;
            context.font = 'italic 64px Georgia, serif';
            context.fillText('colour.', 192, 327);
        }
        else
        {
            const grid = motif === 'flower'
                ? ['....YY....', '...YYYY...', '..YYOOYY..', '..YYOOYY..', '...YYYY...', '....YY....', '....G.....', '..GGGG....', '....GGGG..', '....G.....']
                : motif === 'cherry'
                    ? ['......G...', '.....GG...', '...GG.G...', '..G...G...', '..G....G..', '.RR...RR..', 'RRRR.RRRR.', 'RRRR.RRRR.', '.RR...RR..', '..........']
                    : ['....Y.....', '...YYY....', '...YYY....', 'YYYYYYYYY.', '.YYYYYYY..', '..YYYYY...', '..YYYYY...', '.YYY.YYY..', '.YY...YY..', '..........'];
            const colors: Record<string, string> = { Y: REFERENCE_PAINTERLY_PALETTE.yellow, O: REFERENCE_PAINTERLY_PALETTE.woodDark, G: REFERENCE_PAINTERLY_PALETTE.green, R: REFERENCE_PAINTERLY_PALETTE.wood };
            for (let row = 0; row < grid.length; row += 1)
            {
                for (let column = 0; column < grid[row].length; column += 1)
                {
                    const id = grid[row][column];
                    if (id !== '.')
                    {
                        context.fillStyle = colors[id];
                        const x = 72 + column * 24;
                        const y = 137 + row * 24;
                        context.beginPath();
                        context.roundRect(x, y, 21, 21, 4);
                        context.fill();
                        context.fillStyle = REFERENCE_PAINTERLY_PALETTE.cream;
                        context.beginPath();
                        context.arc(x + 10.5, y + 10.5, 3.1, 0, Math.PI * 2);
                        context.fill();
                    }
                }
            }
        }
        context.fillStyle = REFERENCE_PAINTERLY_PALETTE.woodDark;
        context.font = 'italic 19px Georgia, serif';
        context.fillText('small things, made slowly', 192, 452);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const material = clonePainterlyMaterial(factory.create('#ffffff', 'cream'));
    material.map = texture;
    return material;
}

function clonePainterlyMaterial(source: MeshStandardMaterial): MeshStandardMaterial
{
    const clone = source.clone();
    // Three's Material.clone does not copy compilation callbacks. Keep the shared
    // style uniforms active on the poster and bulb's explicit material exceptions.
    clone.onBeforeCompile = source.onBeforeCompile;
    clone.customProgramCacheKey = source.customProgramCacheKey;
    return clone;
}

/** Bakes only ordinary static meshes; named roots and instances remain queryable. */
function mergeStaticAssembly(group: Group): void
{
    group.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(group.matrixWorld).invert();
    const batches = new Map<string, { material: MeshStandardMaterial; geometries: BufferGeometry[]; sources: Mesh[]; castShadow: boolean }>();
    group.traverse((object): void =>
    {
        if (!(object instanceof Mesh) || object instanceof InstancedMesh || Array.isArray(object.material))
        {
            return;
        }
        const material = object.material as MeshStandardMaterial;
        const key = `${material.uuid}:${object.castShadow}:${JSON.stringify(object.userData.painterlyOutline ?? null)}`;
        let batch = batches.get(key);
        if (batch === undefined)
        {
            batch = { material, geometries: [], sources: [], castShadow: object.castShadow };
            batches.set(key, batch);
        }
        const geometry = object.geometry.index === null ? object.geometry.clone() : object.geometry.toNonIndexed();
        geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
        for (const attribute of Object.keys(geometry.attributes))
        {
            if (!['position', 'normal', 'uv'].includes(attribute))
            {
                geometry.deleteAttribute(attribute);
            }
        }
        if (geometry.getAttribute('uv') === undefined)
        {
            geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
        }
        batch.geometries.push(geometry);
        batch.sources.push(object);
    });
    for (const batch of batches.values())
    {
        if (batch.sources.length < 2)
        {
            for (const geometry of batch.geometries)
            {
                geometry.dispose();
            }
            continue;
        }
        const geometry = mergeGeometries(batch.geometries);
        if (geometry !== null)
        {
            const merged = new Mesh(geometry, batch.material);
            merged.name = `${group.name}:${batch.sources[0].name}:Batch`;
            merged.castShadow = batch.castShadow;
            merged.receiveShadow = true;
            merged.userData.authoredParts = batch.sources.map((source) => source.name);
            merged.userData.painterlyOutline = structuredClone(batch.sources[0].userData.painterlyOutline);
            group.add(merged);
            for (const source of batch.sources)
            {
                source.removeFromParent();
            }
        }
        for (const temporary of batch.geometries)
        {
            temporary.dispose();
        }
    }
}
