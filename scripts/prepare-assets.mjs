import { access } from 'node:fs/promises';

const targetRoot = new URL('../public/textures/painterly/', import.meta.url);
const textures = [
    'brush-strokes.png',
    'brush-strokes-02.png',
    'brush-strokes-03.png',
    'noise-comparison.png',
    'shadow-light-pair.png',
    'shadow-texture.png'
];

for (const name of textures)
{
    await access(new URL(name, targetRoot));
}

await access(new URL('../public/models/bead-kit.glb', import.meta.url));
await access(new URL('../public/models/mini-bead-kit.glb', import.meta.url));
