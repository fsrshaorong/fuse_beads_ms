import { BufferGeometry, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { METRES_TO_WORLD } from './BeadDimensions';

/** The actual Blender meshes; consumers clone geometry and retain instancing. */
export interface BeadModelPair
{
    readonly raw: BufferGeometry;
    readonly fused: BufferGeometry;
}

export interface BeadModels extends BeadModelPair
{
    dispose(): void;
}

export async function loadBeadModels(url: string): Promise<BeadModels>
{
    return loadKit(url, 'MiniBead', 'FusedMiniBead');
}

async function loadKit(url: string, rawName: string, fusedName: string): Promise<BeadModelPair & { dispose(): void }>
{
    const asset = await new GLTFLoader().loadAsync(url);
    asset.scene.updateMatrixWorld(true);
    const geometries = new Map<string, BufferGeometry>();
    asset.scene.traverse((object): void =>
    {
        if (!(object instanceof Mesh))
        {
            return;
        }
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
        geometry.scale(METRES_TO_WORLD, METRES_TO_WORLD, METRES_TO_WORLD);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometries.set(object.name, geometry);
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
        {
            material.dispose();
        }
    });
    const raw = geometries.get(rawName);
    const fused = geometries.get(fusedName);
    if (raw === undefined || fused === undefined || raw.getAttribute('color') === undefined
        || fused.getAttribute('color') === undefined)
    {
        for (const geometry of geometries.values())
        {
            geometry.dispose();
        }
        throw new Error('The Blender bead kit must contain both colored hollow bead meshes.');
    }
    return {
        raw,
        fused,
        dispose(): void
        {
            for (const geometry of geometries.values())
            {
                geometry.dispose();
            }
        }
    };
}
