import {
    BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
    DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial,
    Object3D, PlaneGeometry, SRGBColorSpace, TorusGeometry, Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { WorkshopReadModel } from '../App/WorkshopApplication';
import { getBeadColor } from './BeadPalette';
import type { PainterlyMaterials } from './PainterlyMaterials';
import type { BeadModels } from './BeadModels';
import {
    BEAD_DIMENSIONS, BEAD_PITCH, BOARD_SIZE, BOARD_SURFACE_Y,
    BOARD_THICKNESS, MILLIMETRES_TO_WORLD, patternGridOffset
} from './BeadDimensions';
import type { BeadDimensions } from './BeadDimensions';

/** Projects the existing integer board into a solid pegboard with hollow, beveled beads. */
export class BeadBoardView
{
    public readonly root = new Group();
    public readonly hover = new Mesh(
        new TorusGeometry(BEAD_PITCH * 0.50, BEAD_PITCH * 0.022, 6, 48),
        new MeshBasicMaterial({ color: '#c2875e', transparent: true, opacity: 0.8 })
    );
    private readonly marker = new Object3D();
    private readonly color = new Color();
    private readonly ownedGeometries: BufferGeometry[] = [];
    private beads: InstancedMesh | null = null;
    private fusedBeads: InstancedMesh | null = null;
    private hints: InstancedMesh | null = null;
    private labels: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
    private labelTexture: CanvasTexture | null = null;
    private cells: readonly number[] = [];
    private cellColors: Color[] = [];
    private spawnTimes: number[] = [];
    private patternId = '';
    private width = 16;
    private height = 16;
    private stage = '';
    private readonly pitch = BEAD_PITCH;
    private readonly spec: Readonly<BeadDimensions> = BEAD_DIMENSIONS;
    private time = 0;
    private ironCoverage: readonly boolean[] = [];

    public constructor(private readonly materials: PainterlyMaterials, private readonly models: BeadModels)
    {
        this.root.name = 'EditablePegboard';
        this.root.position.set(0, BOARD_SURFACE_Y, 0);
        this.hover.rotation.x = -Math.PI / 2;
        this.hover.visible = false;
    }

    public get dimensions(): Readonly<BeadDimensions>
    {
        return this.spec;
    }

    public get hitPlaneHeight(): number
    {
        return this.root.position.y + this.beadHeight;
    }

    private get beadHeight(): number
    {
        return this.spec.heightMm * MILLIMETRES_TO_WORLD;
    }

    private get pegHeight(): number
    {
        return this.spec.pegHeightMm * MILLIMETRES_TO_WORLD;
    }

    /** Updates only changed cell transforms and colors; all beads share geometry and material. */
    public sync(model: WorkshopReadModel): void
    {
        if (model.pattern.patternId !== this.patternId)
        {
            this.rebuild(model);
        }

        if (this.beads === null || this.fusedBeads === null || this.hints === null)
        {
            return;
        }

        for (let index = 0; index < model.board.cells.length; index += 1)
        {
            const value = model.board.cells[index];

            if (value !== this.cells[index])
            {
                this.spawnTimes[index] = value === 0 ? -10 : this.time;
                const entry = model.pattern.palette[value - 1];

                if (entry !== undefined)
                {
                    this.cellColors[index].set(getBeadColor(entry.colorId));
                }
            }

            this.positionCell(this.marker, index, 0.0003);
            const target = model.pattern.targetNumbers[index];
            this.marker.scale.setScalar(value === 0 && target !== 0 ? 1 : 0);
            this.marker.updateMatrix();
            this.hints.setMatrixAt(index, this.marker.matrix);
        }

        this.cells = model.board.cells;
        this.stage = model.stage;
        this.ironCoverage = model.ironCoverage;
        this.hints.instanceMatrix.needsUpdate = true;

        if (this.beads.instanceColor !== null)
        {
            this.beads.instanceColor.needsUpdate = true;
        }
        if (this.fusedBeads.instanceColor !== null)
        {
            this.fusedBeads.instanceColor.needsUpdate = true;
        }

        this.updateLabels(model);
        this.update(this.time);
    }

    /** Advances the short placement response without delaying new pointer commands. */
    public update(timeSeconds: number): void
    {
        this.time = timeSeconds;

        if (this.beads === null || this.fusedBeads === null)
        {
            return;
        }

        let rawCount = 0;
        let fusedCount = 0;
        for (let index = 0; index < this.cells.length; index += 1)
        {
            if (this.cells[index] === 0)
            {
                continue;
            }
            const age = Math.min(1, Math.max(0, (timeSeconds - this.spawnTimes[index]) / 0.14));
            const lift = (1 - age) * (1 - age) * this.beadHeight * 1.5;
            const fused = this.stage === 'finished' || this.ironCoverage[index] === true;
            this.positionCell(this.marker, index, lift);
            this.marker.scale.setScalar(1);
            this.marker.updateMatrix();
            const batch = fused ? this.fusedBeads : this.beads;
            const instance = fused ? fusedCount++ : rawCount++;
            batch.setMatrixAt(instance, this.marker.matrix);
            batch.setColorAt(instance, this.cellColors[index]);
        }

        this.beads.count = rawCount;
        this.fusedBeads.count = fusedCount;
        this.beads.instanceMatrix.needsUpdate = true;
        this.fusedBeads.instanceMatrix.needsUpdate = true;
        if (this.beads.instanceColor !== null)
        {
            this.beads.instanceColor.needsUpdate = true;
        }
        if (this.fusedBeads.instanceColor !== null)
        {
            this.fusedBeads.instanceColor.needsUpdate = true;
        }
    }

    /** Fades information by camera scale while the physical board stays in the same world. */
    public setDetail(amount: number): void
    {
        if (this.labels !== null)
        {
            this.labels.material.opacity = Math.max(0, Math.min(1, amount));
            this.labels.visible = amount > 0.01 && this.stage !== 'finished';
        }
    }

    /** Maps a world-space board hit to authoritative integer coordinates. */
    public hitCell(world: Vector3): { x: number; y: number } | null
    {
        const x = Math.floor((world.x - this.root.position.x) / this.pitch - patternGridOffset(this.width, this.spec.gridSize) + 0.5);
        const y = Math.floor((world.z - this.root.position.z) / this.pitch - patternGridOffset(this.height, this.spec.gridSize) + 0.5);

        if (x < 0 || y < 0 || x >= this.width || y >= this.height)
        {
            return null;
        }

        return { x, y };
    }

    /** Writes a cell center into a reusable vector for picking diagnostics and tool placement. */
    public cellWorld(x: number, y: number, target: Vector3): Vector3
    {
        return target.set(
            this.root.position.x + (x + patternGridOffset(this.width, this.spec.gridSize)) * this.pitch,
            this.hitPlaneHeight,
            this.root.position.z + (y + patternGridOffset(this.height, this.spec.gridSize)) * this.pitch
        );
    }

    /** Places the stable cursor ring above the selected peg; null clears transient feedback. */
    public setHover(cell: { x: number; y: number } | null): void
    {
        this.hover.visible = cell !== null;

        if (cell !== null)
        {
            this.hover.position.set(
                (cell.x + patternGridOffset(this.width, this.spec.gridSize)) * this.pitch,
                this.beadHeight + 0.001,
                (cell.y + patternGridOffset(this.height, this.spec.gridSize)) * this.pitch
            );
            this.hover.scale.setScalar(this.pitch / BEAD_PITCH);
        }
    }

    /** Releases per-board GPU resources; shared role materials remain owned by the material library. */
    public dispose(): void
    {
        this.clearBoard();
        this.hover.geometry.dispose();
        this.hover.material.dispose();
    }

    /** Reports loaded mesh measurements, not just the intended modeling constants. */
    public metrics(): object
    {
        const bounds = this.beads?.geometry.boundingBox;
        return {
            source: 'Blender GLB',
            format: this.spec.format,
            rawCount: this.beads?.count ?? 0,
            fusedCount: this.fusedBeads?.count ?? 0,
            diameterMm: bounds === null || bounds === undefined ? 0 : (bounds.max.x - bounds.min.x) / MILLIMETRES_TO_WORLD,
            heightMm: bounds === null || bounds === undefined ? 0 : (bounds.max.y - bounds.min.y) / MILLIMETRES_TO_WORLD,
            bottomMm: bounds === null || bounds === undefined ? 0 : bounds.min.y / MILLIMETRES_TO_WORLD,
            pegCount: this.spec.gridSize ** 2,
            pitchMm: this.pitch / MILLIMETRES_TO_WORLD
        };
    }

    private rebuild(model: WorkshopReadModel): void
    {
        this.clearBoard();
        this.patternId = model.pattern.patternId;
        this.width = model.pattern.width;
        this.height = model.pattern.height;
        const count = this.width * this.height;
        this.cells = new Array<number>(count).fill(0);
        this.cellColors = Array.from({ length: count }, () => new Color('#ffffff'));
        this.spawnTimes = new Array<number>(count).fill(-10);

        const baseGeometry = new RoundedBoxGeometry(
            BOARD_SIZE, BOARD_THICKNESS, BOARD_SIZE, 3, MILLIMETRES_TO_WORLD * 0.5
        );
        this.ownedGeometries.push(baseGeometry);
        const base = new Mesh(baseGeometry, this.materials.create('#eee9d9', 'board'));
        base.name = `${this.spec.format}Pegboard145mm`;
        base.position.y = -BOARD_THICKNESS / 2;
        base.castShadow = true;
        base.receiveShadow = true;
        this.root.add(base);

        const pinRadius = this.spec.pegDiameterMm * MILLIMETRES_TO_WORLD / 2;
        const pinGeometry = new CylinderGeometry(pinRadius * 0.80, pinRadius, this.pegHeight, 12);
        this.ownedGeometries.push(pinGeometry);
        const pins = new InstancedMesh(pinGeometry, this.materials.create('#dad6c7', 'board'),
            this.spec.gridSize ** 2);
        pins.name = 'PegboardPins';
        pins.userData.painterlyOutline = { enabled: false };
        pins.receiveShadow = true;
        pins.castShadow = false;

        for (let row = 0; row < this.spec.gridSize; row += 1)
        {
            for (let column = 0; column < this.spec.gridSize; column += 1)
            {
                const center = (this.spec.gridSize - 1) / 2;
                this.marker.position.set((column - center) * this.pitch, this.pegHeight / 2, (row - center) * this.pitch);
                this.marker.rotation.set(0, 0, 0);
                this.marker.scale.setScalar(1);
                this.marker.updateMatrix();
                pins.setMatrixAt(row * this.spec.gridSize + column, this.marker.matrix);
            }
        }

        const beadGeometry = this.models.raw.clone();
        this.ownedGeometries.push(beadGeometry);
        this.beads = new InstancedMesh(beadGeometry, this.materials.create('#ffffff', 'bead'), count);
        this.beads.name = 'HollowBeadInstances';
        this.beads.castShadow = true;
        this.beads.receiveShadow = true;
        this.beads.frustumCulled = false;
        const fusedGeometry = this.models.fused.clone();
        this.ownedGeometries.push(fusedGeometry);
        this.fusedBeads = new InstancedMesh(fusedGeometry, this.materials.create('#ffffff', 'bead'), count);
        this.fusedBeads.name = 'LocallyFusedBeadInstances';
        this.fusedBeads.userData.painterlyOutline = { enabled: false };
        this.fusedBeads.castShadow = true;
        this.fusedBeads.receiveShadow = true;
        this.fusedBeads.frustumCulled = false;

        const hintGeometry = new PlaneGeometry(this.pitch * 0.82, this.pitch * 0.82);
        hintGeometry.rotateX(-Math.PI / 2);
        this.ownedGeometries.push(hintGeometry);
        const hintMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false });
        this.hints = new InstancedMesh(hintGeometry, hintMaterial, count);

        for (let index = 0; index < count; index += 1)
        {
            const entry = model.pattern.palette[model.pattern.targetNumbers[index] - 1];
            this.color.set(entry === undefined ? '#ffffff' : getBeadColor(entry.colorId));
            this.hints.setColorAt(index, this.color);
        }

        this.root.add(pins, this.hints, this.beads, this.fusedBeads, this.hover);
        this.createLabels(model);
    }

    private createLabels(model: WorkshopReadModel): void
    {
        const canvas = document.createElement('canvas');
        canvas.width = 9 * 96;
        canvas.height = 96;
        const context = canvas.getContext('2d');

        if (context === null)
        {
            throw new Error('[BeadBoardView] Number atlas canvas is unavailable.');
        }

        context.font = '700 64px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#57513f';

        for (let number = 1; number <= 9; number += 1)
        {
            context.fillText(String(number), (number - 0.5) * 96, 49);
        }

        this.labelTexture = new CanvasTexture(canvas);
        this.labelTexture.colorSpace = SRGBColorSpace;
        const positions: number[] = [];
        const uvs: number[] = [];
        const size = this.pitch * 0.60;

        for (let index = 0; index < this.width * this.height; index += 1)
        {
            const x = (index % this.width + patternGridOffset(this.width, this.spec.gridSize)) * this.pitch;
            const z = (Math.floor(index / this.width) + patternGridOffset(this.height, this.spec.gridSize)) * this.pitch + this.pitch * 0.12;
            positions.push(x - size / 2, 0.012, z - size / 2, x + size / 2, 0.012, z - size / 2,
                x - size / 2, 0.012, z + size / 2, x + size / 2, 0.012, z - size / 2,
                x + size / 2, 0.012, z + size / 2, x - size / 2, 0.012, z + size / 2);
            const number = Math.max(1, model.pattern.targetNumbers[index]);
            const left = (number - 1) / 9;
            const right = number / 9;
            uvs.push(left, 1, right, 1, left, 0, right, 1, right, 0, left, 0);
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
        this.labels = new Mesh(geometry, new MeshBasicMaterial({
            map: this.labelTexture, transparent: true, depthWrite: false,
            side: DoubleSide, opacity: 0, toneMapped: false
        }));
        this.labels.frustumCulled = false;
        this.root.add(this.labels);
        this.ownedGeometries.push(geometry);
    }

    private updateLabels(model: WorkshopReadModel): void
    {
        if (this.labels === null)
        {
            return;
        }

        const positions = this.labels.geometry.getAttribute('position');

        for (let index = 0; index < this.cells.length; index += 1)
        {
            const target = model.pattern.targetNumbers[index];
            const filled = model.board.cells[index];
            const visible = target !== 0 && filled !== target;
            let labelHeight = -0.08;

            if (visible)
            {
                labelHeight = filled === 0 ? this.pegHeight + 0.001 : this.beadHeight + 0.001;
            }

            for (let vertex = 0; vertex < 6; vertex += 1)
            {
                positions.setY(index * 6 + vertex, labelHeight);
            }
        }

        positions.needsUpdate = true;
    }

    private positionCell(object: Object3D, index: number, height: number): void
    {
        object.position.set(
            (index % this.width + patternGridOffset(this.width, this.spec.gridSize)) * this.pitch,
            height,
            (Math.floor(index / this.width) + patternGridOffset(this.height, this.spec.gridSize)) * this.pitch
        );
        object.rotation.set(0, 0, 0);
    }

    private clearBoard(): void
    {
        for (const geometry of this.ownedGeometries)
        {
            geometry.dispose();
        }

        this.ownedGeometries.length = 0;
        this.labelTexture?.dispose();
        this.labels?.material.dispose();

        if (this.hints !== null && !Array.isArray(this.hints.material))
        {
            this.hints.material.dispose();
        }

        this.beads?.dispose();
        this.fusedBeads?.dispose();
        const pins = this.root.getObjectByName('PegboardPins');
        if (pins instanceof InstancedMesh)
        {
            pins.dispose();
        }
        this.hints?.dispose();
        this.root.clear();
        this.beads = null;
        this.fusedBeads = null;
        this.hints = null;
        this.labels = null;
    }
}
