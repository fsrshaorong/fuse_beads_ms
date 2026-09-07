import {
    BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
    DoubleSide, Group, InstancedMesh, LatheGeometry, Mesh, MeshBasicMaterial,
    Object3D, PlaneGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { WorkshopReadModel } from '../App/WorkshopApplication';
import { getBeadColor } from './BeadPalette';
import type { PainterlyMaterials } from './PainterlyMaterials';

/** Projects the existing integer board into a solid pegboard with hollow, beveled beads. */
export class BeadBoardView
{
    public readonly root = new Group();
    public readonly hover = new Mesh(
        new TorusGeometry(0.041, 0.002, 6, 32),
        new MeshBasicMaterial({ color: '#c2875e', transparent: true, opacity: 0.8 })
    );
    private readonly marker = new Object3D();
    private readonly color = new Color();
    private readonly ownedGeometries: BufferGeometry[] = [];
    private beads: InstancedMesh | null = null;
    private hints: InstancedMesh | null = null;
    private labels: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
    private labelTexture: CanvasTexture | null = null;
    private cells: readonly number[] = [];
    private spawnTimes: number[] = [];
    private patternId = '';
    private width = 16;
    private height = 16;
    private stage = '';
    private pitch = 1.44 / 16;
    private time = 0;
    private ironProgress = 0;

    public constructor(private readonly materials: PainterlyMaterials)
    {
        this.root.name = 'EditablePegboard';
        this.root.position.set(0, 1.18, 0);
        this.hover.rotation.x = -Math.PI / 2;
        this.hover.visible = false;
    }

    /** Updates only changed cell transforms and colors; all beads share geometry and material. */
    public sync(model: WorkshopReadModel): void
    {
        if (model.pattern.patternId !== this.patternId)
        {
            this.rebuild(model);
        }

        if (this.beads === null || this.hints === null)
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
                    this.color.set(getBeadColor(entry.colorId));
                    this.beads.setColorAt(index, this.color);
                }
            }

            this.positionCell(this.marker, index, 0.007);
            const target = model.pattern.targetNumbers[index];
            this.marker.scale.setScalar(value === 0 && target !== 0 ? 1 : 0);
            this.marker.updateMatrix();
            this.hints.setMatrixAt(index, this.marker.matrix);
        }

        this.cells = model.board.cells;
        this.stage = model.stage;
        this.ironProgress = model.ironProgress;
        this.hints.instanceMatrix.needsUpdate = true;

        if (this.beads.instanceColor !== null)
        {
            this.beads.instanceColor.needsUpdate = true;
        }

        this.updateLabels(model);
        this.update(this.time);
    }

    /** Advances the short placement response without delaying new pointer commands. */
    public update(timeSeconds: number): void
    {
        this.time = timeSeconds;

        if (this.beads === null)
        {
            return;
        }

        const pressed = this.stage === 'finished' ? 0.78 : 1 - this.ironProgress * 0.22;

        for (let index = 0; index < this.cells.length; index += 1)
        {
            const age = Math.min(1, Math.max(0, (timeSeconds - this.spawnTimes[index]) / 0.14));
            const lift = (1 - age) * (1 - age) * 0.15;
            this.positionCell(this.marker, index, 0.013 + lift);
            const scale = this.cells[index] === 0 ? 0 : this.pitch / 0.09;
            this.marker.scale.set(scale, scale * pressed, scale);
            this.marker.updateMatrix();
            this.beads.setMatrixAt(index, this.marker.matrix);
        }

        this.beads.instanceMatrix.needsUpdate = true;
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
        const x = Math.floor((world.x - this.root.position.x) / this.pitch + this.width / 2);
        const y = Math.floor((world.z - this.root.position.z) / this.pitch + this.height / 2);

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
            this.root.position.x + (x - (this.width - 1) / 2) * this.pitch,
            this.root.position.y + 0.035,
            this.root.position.z + (y - (this.height - 1) / 2) * this.pitch
        );
    }

    /** Places the stable cursor ring above the selected peg; null clears transient feedback. */
    public setHover(cell: { x: number; y: number } | null): void
    {
        this.hover.visible = cell !== null;

        if (cell !== null)
        {
            this.hover.position.set(
                (cell.x - (this.width - 1) / 2) * this.pitch,
                0.077,
                (cell.y - (this.height - 1) / 2) * this.pitch
            );
            this.hover.scale.setScalar(this.pitch / 0.09);
        }
    }

    /** Releases per-board GPU resources; shared role materials remain owned by the material library. */
    public dispose(): void
    {
        this.clearBoard();
        this.hover.geometry.dispose();
        this.hover.material.dispose();
    }

    private rebuild(model: WorkshopReadModel): void
    {
        this.clearBoard();
        this.patternId = model.pattern.patternId;
        this.width = model.pattern.width;
        this.height = model.pattern.height;
        this.pitch = 1.44 / Math.max(this.width, this.height);
        const count = this.width * this.height;
        this.cells = new Array<number>(count).fill(0);
        this.spawnTimes = new Array<number>(count).fill(-10);

        const baseGeometry = new RoundedBoxGeometry(
            this.width * this.pitch + 0.18, 0.065, this.height * this.pitch + 0.18, 4, 0.035
        );
        this.ownedGeometries.push(baseGeometry);
        const base = new Mesh(baseGeometry, this.materials.create('#e8e8ce', 'board'));
        base.position.y = -0.033;
        base.castShadow = true;
        base.receiveShadow = true;
        this.root.add(base);

        const pinGeometry = new CylinderGeometry(0.006, 0.01, 0.039, 10);
        this.ownedGeometries.push(pinGeometry);
        const pins = new InstancedMesh(pinGeometry, this.materials.create('#dadcc5', 'board'), count);
        pins.receiveShadow = true;
        pins.castShadow = true;

        const points = [
            new Vector2(0.018, 0.004), new Vector2(0.022, 0),
            new Vector2(0.034, 0), new Vector2(0.039, 0.005),
            new Vector2(0.039, 0.052), new Vector2(0.035, 0.057),
            new Vector2(0.022, 0.057), new Vector2(0.018, 0.053),
            new Vector2(0.018, 0.004)
        ];
        const beadGeometry = new LatheGeometry(points, 28);
        this.ownedGeometries.push(beadGeometry);
        this.beads = new InstancedMesh(beadGeometry, this.materials.create('#ffffff', 'bead'), count);
        this.beads.name = 'HollowBeadInstances';
        this.beads.castShadow = true;
        this.beads.receiveShadow = true;
        this.beads.frustumCulled = false;

        const hintGeometry = new PlaneGeometry(this.pitch * 0.82, this.pitch * 0.82);
        hintGeometry.rotateX(-Math.PI / 2);
        this.ownedGeometries.push(hintGeometry);
        const hintMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false });
        this.hints = new InstancedMesh(hintGeometry, hintMaterial, count);

        for (let index = 0; index < count; index += 1)
        {
            this.positionCell(this.marker, index, 0.02);
            this.marker.scale.setScalar(this.pitch / 0.09);
            this.marker.updateMatrix();
            pins.setMatrixAt(index, this.marker.matrix);
            const entry = model.pattern.palette[model.pattern.targetNumbers[index] - 1];
            this.color.set(entry === undefined ? '#ffffff' : getBeadColor(entry.colorId));
            this.hints.setColorAt(index, this.color);
        }

        this.root.add(pins, this.hints, this.beads, this.hover);
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
            const x = (index % this.width - (this.width - 1) / 2) * this.pitch;
            const z = (Math.floor(index / this.width) - (this.height - 1) / 2) * this.pitch + this.pitch * 0.12;
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
                labelHeight = filled === 0 ? 0.049 : 0.081;
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
            (index % this.width - (this.width - 1) / 2) * this.pitch,
            height,
            (Math.floor(index / this.width) - (this.height - 1) / 2) * this.pitch
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
        this.hints?.dispose();
        this.root.clear();
        this.beads = null;
        this.hints = null;
        this.labels = null;
    }
}
