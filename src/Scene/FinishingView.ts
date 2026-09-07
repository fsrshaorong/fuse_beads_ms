import {
    BufferGeometry,
    CatmullRomCurve3,
    Color,
    CylinderGeometry,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    Shape,
    TubeGeometry,
    Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type {
    FinishedWorkshopArtwork,
    WorkshopReadModel
} from '../App/WorkshopApplication';
import { getBeadColor } from '../Rendering/BeadPalette';
import type { PainterlyMaterials } from '../Rendering/PainterlyMaterials';
import type { BeadModels } from '../Rendering/BeadModels';
import { BEAD_PITCH, BEAD_TOP_Y, BOARD_SIZE } from '../Rendering/BeadDimensions';

const MAXIMUM_DISPLAYED_ARTWORKS = 3;
const PAPER_HEIGHT = BEAD_TOP_Y + 0.002;

/** Displays a physical finishing tool and the player's actual frozen artwork records. */
export class FinishingView
{
    public readonly root = new Group();

    private readonly iron = new Group();
    private readonly collection = new Group();
    private readonly paper: Mesh<PlaneGeometry, MeshStandardMaterial>;
    private readonly ownedGeometries: BufferGeometry[] = [];
    private readonly ownedMaterials: MeshStandardMaterial[] = [];
    private readonly displayPosition: Vector3;
    private readonly displayBeadGeometry: BufferGeometry;
    private readonly displayBaseGeometry: RoundedBoxGeometry;
    private readonly displayStandGeometry: RoundedBoxGeometry;
    private readonly indicatorMaterial: MeshStandardMaterial;
    private displayedArtworks: readonly FinishedWorkshopArtwork[] = [];
    private stage: WorkshopReadModel['stage'] = 'editing';
    private mode: WorkshopReadModel['mode'] = 'workshop';
    private lastTime = 0;
    private disposed = false;

    public constructor(
        private readonly materials: PainterlyMaterials,
        displayPosition: Vector3,
        beadModels: BeadModels
    )
    {
        this.root.name = 'FinishingAndPersonalGallery';
        this.displayPosition = displayPosition.clone();
        this.iron.name = 'MiniatureCraftIron';
        this.iron.position.set(0.20, PAPER_HEIGHT + 0.08, 0.20);
        this.iron.visible = false;
        this.root.add(this.iron);
        this.collection.name = 'FinishedPlayerArtworks';
        this.root.add(this.collection);

        const paperSize = BOARD_SIZE + 0.04;
        const paperGeometry = this.ownGeometry(new PlaneGeometry(paperSize, paperSize, 12, 12));
        paperGeometry.rotateX(-Math.PI / 2);
        const paperPositions = paperGeometry.getAttribute('position');
        for (let vertex = 0; vertex < paperPositions.count; vertex += 1)
        {
            const x = paperPositions.getX(vertex);
            const z = paperPositions.getZ(vertex);
            const edge = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - paperSize * 0.44) / (paperSize * 0.06);
            paperPositions.setY(vertex, edge * edge * 0.004);
        }
        paperGeometry.computeVertexNormals();
        const paperMaterial = this.ownMaterial(new MeshStandardMaterial({
            name: 'TranslucentIroningPaper',
            color: '#faf0da',
            roughness: 1,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            side: DoubleSide
        }));
        this.paper = new Mesh(paperGeometry, paperMaterial);
        this.paper.name = 'RemovableIroningPaper';
        this.paper.position.y = PAPER_HEIGHT;
        this.paper.receiveShadow = true;
        this.paper.visible = false;
        this.root.add(this.paper);

        const sole = this.ownGeometry(createIronHull(0.012, 0.004));
        const soleMesh = new Mesh(sole, materials.create('#a4aaa5', 'metal'));
        soleMesh.name = 'RoundedSilverSoleplate';
        soleMesh.position.y = 0.004;
        soleMesh.castShadow = true;
        this.iron.add(soleMesh);

        const casing = this.ownGeometry(createIronHull(0.060, 0.009));
        const casingMesh = new Mesh(casing, materials.create('#eddec4', 'ceramic'));
        casingMesh.name = 'CreamIronCasing';
        casingMesh.position.y = 0.025;
        casingMesh.scale.set(0.96, 1, 0.96);
        casingMesh.castShadow = true;
        casingMesh.receiveShadow = true;
        this.iron.add(casingMesh);

        const handleCurve = new CatmullRomCurve3([
            new Vector3(0, 0.091, 0.090),
            new Vector3(0, 0.135, 0.088),
            new Vector3(0, 0.150, 0.035),
            new Vector3(0, 0.146, -0.026),
            new Vector3(0, 0.105, -0.066)
        ]);
        const handleGeometry = this.ownGeometry(new TubeGeometry(handleCurve, 24, 0.019, 12, false));
        const handle = new Mesh(handleGeometry, materials.create('#9eb7a6', 'ceramic'));
        handle.name = 'OpenMintIronHandle';
        handle.castShadow = true;
        this.iron.add(handle);

        const dialGeometry = this.ownGeometry(new CylinderGeometry(0.029, 0.031, 0.009, 24));
        const dial = new Mesh(dialGeometry, materials.create('#bda77f', 'metal'));
        dial.name = 'TemperatureDial';
        dial.position.set(0, 0.096, -0.084);
        this.iron.add(dial);

        const dialMarkerGeometry = this.ownGeometry(new RoundedBoxGeometry(0.004, 0.003, 0.013, 1, 0.001));
        const dialMarker = new Mesh(dialMarkerGeometry, materials.create('#725f4c', 'metal'));
        dialMarker.name = 'DialEngraving';
        dialMarker.userData.painterlyOutline = { enabled: false };
        dialMarker.position.set(0, 0.1015, -0.095);
        this.iron.add(dialMarker);

        this.indicatorMaterial = this.ownMaterial(new MeshStandardMaterial({
            color: '#cd9c73',
            emissive: '#eea358',
            emissiveIntensity: 0.08,
            roughness: 0.4
        }));
        const indicator = new Mesh(this.ownGeometry(new CylinderGeometry(0.008, 0.008, 0.003, 12)),
            this.indicatorMaterial);
        indicator.name = 'IronHeatingIndicator';
        indicator.position.set(0.054, 0.091, -0.021);
        this.iron.add(indicator);

        // The same physical fused Blender bead, turned upright for the display stand.
        this.displayBeadGeometry = this.ownGeometry(beadModels.fused.clone());
        this.displayBeadGeometry.rotateX(Math.PI / 2);
        this.displayBaseGeometry = this.ownGeometry(new RoundedBoxGeometry(0.352, 0.041, 0.13, 2, 0.013));
        this.displayStandGeometry = this.ownGeometry(new RoundedBoxGeometry(0.07, 0.15, 0.034, 2, 0.012));
    }

    /** Applies only value state; collection meshes change only when finished records change. */
    public sync(model: WorkshopReadModel): void
    {
        if (this.disposed)
        {
            return;
        }
        this.stage = model.stage;
        this.mode = model.mode;
        this.paper.visible = model.stage === 'ironing';
        this.iron.visible = model.stage === 'ironing' && model.mode === 'beadwork';
        this.paper.material.opacity = 0.42 - Math.max(0, Math.min(1, model.ironProgress)) * 0.055;

        const firstIndex = Math.max(0, model.finishedArtworks.length - MAXIMUM_DISPLAYED_ARTWORKS);
        const count = model.finishedArtworks.length - firstIndex;
        let needsRebuild = count !== this.displayedArtworks.length;
        for (let index = 0; index < count && !needsRebuild; index += 1)
        {
            needsRebuild = this.displayedArtworks[index] !== model.finishedArtworks[firstIndex + index];
        }
        if (needsRebuild)
        {
            this.rebuildCollection(model, firstIndex);
        }
    }

    /** The tool follows the board cursor; released pointers lift the sole clear of the paper. */
    public update(timeSeconds: number, cursorWorld: Vector3 | null, held: boolean): void
    {
        if (this.disposed)
        {
            return;
        }
        const delta = Math.min(0.1, Math.max(0, timeSeconds - this.lastTime));
        this.lastTime = timeSeconds;
        if (this.stage !== 'ironing' || this.mode !== 'beadwork')
        {
            return;
        }
        const isPressing = held && cursorWorld !== null;
        if (cursorWorld !== null)
        {
            this.iron.position.x = Math.max(-BOARD_SIZE / 2, Math.min(BOARD_SIZE / 2, cursorWorld.x));
            this.iron.position.z = Math.max(-BOARD_SIZE / 2, Math.min(BOARD_SIZE / 2, cursorWorld.z));
        }
        const desiredHeight = PAPER_HEIGHT + (isPressing ? 0.012 : 0.079);
        const smoothing = 1 - Math.exp(-delta * 24);
        this.iron.position.y += (desiredHeight - this.iron.position.y) * smoothing;
        this.iron.rotation.x += ((isPressing ? 0 : -0.10) - this.iron.rotation.x) * smoothing;
        this.iron.rotation.y = -0.20;
        this.indicatorMaterial.emissiveIntensity = isPressing ? 0.65 : 0.08;
    }

    /** Releases only resources owned by this presentation; shared materials keep their owner. */
    public dispose(): void
    {
        if (this.disposed)
        {
            return;
        }
        this.disposed = true;
        this.clearCollection();
        for (const geometry of this.ownedGeometries)
        {
            geometry.dispose();
        }
        for (const material of this.ownedMaterials)
        {
            material.dispose();
        }
        this.root.removeFromParent();
        this.root.clear();
    }

    private rebuildCollection(model: WorkshopReadModel, firstIndex: number): void
    {
        this.clearCollection();
        this.displayedArtworks = model.finishedArtworks.slice(firstIndex);
        const marker = new Object3D();
        const color = new Color();
        for (let artworkIndex = 0; artworkIndex < this.displayedArtworks.length; artworkIndex += 1)
        {
            const artwork = this.displayedArtworks[artworkIndex];
            const pattern = model.patterns.find((entry) => entry.patternId === artwork.patternId);
            if (pattern === undefined)
            {
                continue;
            }
            let beadCount = 0;
            for (const cell of artwork.cells)
            {
                if (cell > 0 && pattern.palette[cell - 1] !== undefined)
                {
                    beadCount += 1;
                }
            }
            if (beadCount === 0)
            {
                continue;
            }
            const piece = new Group();
            piece.name = `FinishedArtwork:${artwork.artworkId}`;
            piece.userData = { artworkId: artwork.artworkId, patternId: artwork.patternId, title: artwork.name };
            const horizontalOffset = (artworkIndex - (this.displayedArtworks.length - 1) / 2) * 0.74;
            piece.position.set(this.displayPosition.x + horizontalOffset,
                this.displayPosition.y - 0.126, this.displayPosition.z);
            this.collection.add(piece);

            const base = new Mesh(this.displayBaseGeometry, this.materials.create('#bd946e', 'wood'));
            base.name = 'SolidBeechArtworkFoot';
            base.castShadow = true;
            base.receiveShadow = true;
            piece.add(base);
            const stand = new Mesh(this.displayStandGeometry, this.materials.create('#ab845e', 'wood'));
            stand.name = 'SmallArtworkRest';
            stand.position.set(0, 0.087, -0.031);
            stand.rotation.x = -0.08;
            stand.castShadow = true;
            piece.add(stand);

            const beads = new InstancedMesh(this.displayBeadGeometry,
                this.materials.create('#ffffff', 'bead'), beadCount);
            beads.name = 'ActualSavedHollowBeads';
            beads.userData.artworkId = artwork.artworkId;
            beads.castShadow = true;
            beads.receiveShadow = true;
            const pitch = BEAD_PITCH;
            let firstColumn = artwork.width;
            let lastColumn = 0;
            let lastRow = 0;
            for (let index = 0; index < artwork.cells.length; index += 1)
            {
                if (artwork.cells[index] > 0)
                {
                    firstColumn = Math.min(firstColumn, index % artwork.width);
                    lastColumn = Math.max(lastColumn, index % artwork.width);
                    lastRow = Math.max(lastRow, Math.floor(index / artwork.width));
                }
            }
            let instance = 0;
            for (let index = 0; index < artwork.cells.length; index += 1)
            {
                const cell = artwork.cells[index];
                const paletteEntry = pattern.palette[cell - 1];
                if (cell <= 0 || paletteEntry === undefined)
                {
                    continue;
                }
                const column = index % artwork.width;
                const row = Math.floor(index / artwork.width);
                marker.position.set((column - (firstColumn + lastColumn) / 2) * pitch,
                    0.037 + (lastRow - row) * pitch, 0.025);
                marker.scale.setScalar(1);
                marker.updateMatrix();
                beads.setMatrixAt(instance, marker.matrix);
                color.set(getBeadColor(paletteEntry.colorId));
                beads.setColorAt(instance, color);
                instance += 1;
            }
            beads.rotation.x = -0.045;
            beads.instanceMatrix.needsUpdate = true;
            if (beads.instanceColor !== null)
            {
                beads.instanceColor.needsUpdate = true;
            }
            beads.computeBoundingSphere();
            piece.add(beads);
        }
    }

    private clearCollection(): void
    {
        this.collection.traverse((object): void =>
        {
            if (object instanceof InstancedMesh)
            {
                object.dispose();
            }
        });
        this.collection.clear();
        this.displayedArtworks = [];
    }

    private ownGeometry<TGeometry extends BufferGeometry>(geometry: TGeometry): TGeometry
    {
        this.ownedGeometries.push(geometry);
        return geometry;
    }

    private ownMaterial(material: MeshStandardMaterial): MeshStandardMaterial
    {
        this.ownedMaterials.push(material);
        return material;
    }
}

function createIronHull(depth: number, bevelSize: number): ExtrudeGeometry
{
    const footprint = new Shape();
    footprint.moveTo(0, 0.158);
    footprint.bezierCurveTo(0.034, 0.141, 0.102, 0.023, 0.100, -0.093);
    footprint.quadraticCurveTo(0.101, -0.145, 0.063, -0.145);
    footprint.lineTo(-0.063, -0.145);
    footprint.quadraticCurveTo(-0.101, -0.145, -0.100, -0.093);
    footprint.bezierCurveTo(-0.102, 0.023, -0.034, 0.141, 0, 0.158);
    footprint.closePath();
    const geometry = new ExtrudeGeometry(footprint, {
        depth,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize,
        bevelThickness: bevelSize,
        curveSegments: 12
    });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}
