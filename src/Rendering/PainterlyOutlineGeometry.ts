import { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three';

interface GeometryEntry
{
    readonly geometry: BufferGeometry;
    readonly signature: string;
    readonly onSourceDispose: () => void;
    lastFrame: number;
}

/** Owns smoothed outline copies while retaining every original surface normal and buffer. */
export class PainterlyOutlineGeometry
{
    private readonly entries = new Map<BufferGeometry, GeometryEntry>();

    /** Rebuilds when source attributes change; instance transforms remain on the original mesh. */
    public get(source: BufferGeometry, frame: number): BufferGeometry
    {
        const signature = geometrySignature(source);
        let entry = this.entries.get(source);
        if (entry !== undefined && entry.signature !== signature)
        {
            this.release(source, entry);
            entry = undefined;
        }
        if (entry === undefined)
        {
            const geometry = source.clone();
            smoothOutlineNormals(geometry);
            const onSourceDispose = (): void =>
            {
                const current = this.entries.get(source);
                if (current !== undefined)
                {
                    this.release(source, current);
                }
            };
            entry = { geometry, signature, onSourceDispose, lastFrame: frame };
            source.addEventListener('dispose', onSourceDispose);
            this.entries.set(source, entry);
        }
        entry.lastFrame = frame;
        return entry.geometry;
    }

    /** Bounds resources for removed objects whose callers retain their source geometry. */
    public prune(frame: number): void
    {
        for (const [source, entry] of this.entries)
        {
            if (frame - entry.lastFrame > 120)
            {
                this.release(source, entry);
            }
        }
    }

    /** Detaches source listeners and disposes only geometries created by this cache. */
    public dispose(): void
    {
        for (const [source, entry] of this.entries)
        {
            this.release(source, entry);
        }
    }

    private release(source: BufferGeometry, entry: GeometryEntry): void
    {
        source.removeEventListener('dispose', entry.onSourceDispose);
        entry.geometry.dispose();
        this.entries.delete(source);
    }
}

function geometrySignature(geometry: BufferGeometry): string
{
    const values: string[] = [];
    for (const [name, attribute] of Object.entries(geometry.attributes))
    {
        values.push(`${name}:${attributeSignature(attribute)}`);
    }
    for (const [name, attributes] of Object.entries(geometry.morphAttributes))
    {
        values.push(`morph:${name}:${attributes.map(attributeSignature).join(',')}`);
    }
    if (geometry.index !== null)
    {
        values.push(`index:${attributeSignature(geometry.index)}`);
    }
    values.push(`draw:${geometry.drawRange.start}:${geometry.drawRange.count}`);
    values.push(`groups:${geometry.groups.map((group) => `${group.start},${group.count},${group.materialIndex}`).join(';')}`);
    return values.join('|');
}

function attributeSignature(attribute: BufferAttribute | InterleavedBufferAttribute): string
{
    const buffer = attribute instanceof InterleavedBufferAttribute ? attribute.data : attribute;
    const identity = attribute instanceof InterleavedBufferAttribute
        ? `${attribute.data.uuid}:${attribute.offset}:${attribute.data.stride}`
        : attribute.id;
    return `${identity}:${buffer.version}:${attribute.count}:${attribute.itemSize}`;
}

/** Welding only coincident positions lets hard-edged boxes extrude around their full silhouette. */
function smoothOutlineNormals(geometry: BufferGeometry): void
{
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const sums = new Map<string, [number, number, number]>();
    const keys: string[] = [];
    for (let index = 0; index < positions.count; index += 1)
    {
        const key = `${Math.round(positions.getX(index) * 1000000)},${Math.round(positions.getY(index) * 1000000)},${Math.round(positions.getZ(index) * 1000000)}`;
        keys.push(key);
        const sum = sums.get(key) ?? [0, 0, 0];
        sum[0] += normals.getX(index);
        sum[1] += normals.getY(index);
        sum[2] += normals.getZ(index);
        sums.set(key, sum);
    }
    const result = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1)
    {
        const sum = sums.get(keys[index]);
        if (sum === undefined)
        {
            throw new Error('An outline vertex has no welded normal.');
        }
        const length = Math.hypot(sum[0], sum[1], sum[2]);
        if (length > 0.00000001)
        {
            result.set([sum[0] / length, sum[1] / length, sum[2] / length], index * 3);
        }
        else
        {
            result.set([normals.getX(index), normals.getY(index), normals.getZ(index)], index * 3);
        }
    }
    geometry.setAttribute('normal', new BufferAttribute(result, 3));
}
