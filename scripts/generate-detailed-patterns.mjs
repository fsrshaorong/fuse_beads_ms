import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Original pixel compositions authored directly on the final grid, not scaled starter art.
const size = 50;
const definitions = [];
let cells;
function start() { cells = new Array(size * size).fill(0); }
function paint(color, inside)
{
    for (let y = 0; y < size; y += 1)
    {
        for (let x = 0; x < size; x += 1)
        {
            if (inside(x + 0.5, y + 0.5)) cells[y * size + x] = color;
        }
    }
}
function ellipse(x, y, rx, ry, color, angle = 0)
{
    const c = Math.cos(angle), s = Math.sin(angle);
    paint(color, (px, py) => (((px - x) * c + (py - y) * s) / rx) ** 2
        + ((-(px - x) * s + (py - y) * c) / ry) ** 2 <= 1);
}
function rect(x, y, width, height, color)
{
    paint(color, (px, py) => px >= x && px < x + width && py >= y && py < y + height);
}
function polygon(points, color)
{
    paint(color, (x, y) =>
    {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++)
        {
            const [xi, yi] = points[i], [xj, yj] = points[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    });
}
function line(x1, y1, x2, y2, width, color)
{
    const dx = x2 - x1, dy = y2 - y1;
    paint(color, (x, y) =>
    {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
        return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= (width / 2) ** 2;
    });
}
function finish(slug, name, colorIds, description, difficulty = 'standard')
{
    const used = [...new Set(cells)].filter(Boolean).sort((a, b) => a - b);
    const numbers = new Map(used.map((color, index) => [color, index + 1]));
    const occupied = cells.flatMap((value, index) => value > 0 ? [index] : []);
    const seen = new Set([occupied[0]]), queue = [occupied[0]];
    for (let head = 0; head < queue.length; head += 1)
    {
        const index = queue[head], x = index % size, y = Math.floor(index / size);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]])
        {
            const next = ny * size + nx;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size && cells[next] > 0 && !seen.has(next))
            {
                seen.add(next); queue.push(next);
            }
        }
    }
    assert.equal(seen.size, occupied.length, `${slug}: all beads must belong to one four-connected piece`);
    assert.ok(occupied.length >= 600 && used.length <= 9, `${slug}: detail and palette budget`);
    assert.ok(occupied.every((i) => i % size >= 2 && i % size < 48 && Math.floor(i / size) >= 2 && Math.floor(i / size) < 48));
    definitions.push({ patternId: `atelier-${slug}-50-v1`, name, difficulty,
        difficultyDescription: description, estimatedMinutes: Math.round(occupied.length / 35),
        colorIds: used.map((color) => `detail-${colorIds[color - 1]}`),
        rows: Array.from({ length: size }, (_, y) => cells.slice(y * size, (y + 1) * size).map((n) => numbers.get(n) ?? 0).join('')) });
    process.stdout.write(`${name}: ${occupied.length} beads, ${used.length} colors, 50 × 50\n`);
}

// Duck: separate head, bill, curled wing, tail, cream highlights and pond ripples.
start();
ellipse(25, 41, 22, 5, 7); ellipse(24, 40, 21, 4, 6);
line(8, 42, 17, 42, 1, 3); line(31, 43, 40, 43, 1, 3);
polygon([[15, 28], [4, 21], [6, 34], [18, 38]], 1);
polygon([[14, 29], [7, 25], [9, 33], [17, 35]], 2);
ellipse(24, 30, 18, 12, 1); ellipse(23, 28.5, 17, 10.5, 2);
ellipse(25, 33, 12, 6, 3);
ellipse(31, 17, 10, 11, 1); ellipse(30, 16, 9, 10, 2);
polygon([[25, 9], [25, 4], [29, 8], [29, 3], [33, 8]], 2);
ellipse(27, 13, 4, 5, 3, 0.4);
polygon([[38, 19], [47, 21], [45, 25], [37, 24]], 1);
polygon([[39, 20], [46, 21], [44, 23], [38, 23]], 5);
ellipse(20, 28, 9, 6, 1, 0.2); ellipse(19, 26.5, 7.5, 4, 2, 0.2);
line(15, 27, 21, 29, 1.5, 3);
ellipse(35, 16.5, 2, 2.5, 4); rect(34, 15, 1, 1, 3);
ellipse(35, 21, 2, 1.5, 5);
finish('pond-duck', '池塘小鸭', ['amber', 'gold', 'cream', 'ink', 'peach', 'sky', 'sky-dark'], '细致 · 翅膀卷线、脸颊与水波');

// Cat: tapered ears, tabby markings, muzzle, two-tone irises and whiskers.
start();
polygon([[5, 25], [6, 3], [24, 15], [42, 3], [45, 26]], 1);
polygon([[7, 24], [8, 7], [23, 17], [40, 7], [43, 24]], 2);
polygon([[10, 19], [10, 10], [20, 18]], 4);
polygon([[30, 18], [38, 10], [39, 21]], 4);
ellipse(25, 28, 21, 17, 1); ellipse(25, 27.5, 19.5, 15.5, 2);
ellipse(25, 35, 12, 8, 3); ellipse(13, 30, 5, 5, 3); ellipse(37, 30, 5, 5, 3);
polygon([[20, 13], [23, 13], [24, 22], [21, 20]], 5);
polygon([[26, 13], [29, 13], [28, 20], [25, 22]], 5);
polygon([[6, 24], [13, 26], [12, 28], [6, 27]], 5);
polygon([[44, 24], [38, 26], [38, 28], [44, 27]], 5);
ellipse(17, 27, 3, 4, 1); ellipse(33, 27, 3, 4, 1);
rect(16, 26, 1, 4, 6); rect(32, 26, 1, 4, 6);
rect(17, 24, 1, 2, 3); rect(33, 24, 1, 2, 3);
ellipse(12, 33, 3, 1.5, 4); ellipse(38, 33, 3, 1.5, 4);
polygon([[22, 32], [28, 32], [25, 35]], 7);
line(25, 35, 25, 37, 1, 1); line(25, 37, 22, 38, 1, 1); line(25, 37, 28, 38, 1, 1);
line(7, 31, 14, 32, 1, 1); line(7, 35, 14, 34, 1, 1);
line(36, 32, 43, 31, 1, 1); line(36, 34, 43, 35, 1, 1);
finish('tabby-cat', '奶油虎斑猫', ['ink', 'peach', 'cream', 'rose-light', 'amber', 'leaf', 'rose'], '细致 · 耳廓、虎斑、眼神与胡须');

// Plant: branches connect every leaf and flower to a shaded terracotta pot.
start();
line(25, 35, 25, 10, 3, 4); line(25, 28, 12, 18, 2, 4); line(25, 25, 37, 18, 2, 4);
line(25, 19, 16, 11, 2, 4); line(25, 16, 34, 9, 2, 4);
ellipse(13, 20, 10, 5, 4, 0.55); ellipse(12, 18.5, 8, 3.5, 5, 0.55);
ellipse(35, 23, 10, 5, 4, -0.5); ellipse(35, 21.5, 8, 3.5, 5, -0.5);
ellipse(15, 11, 8, 4, 4, 0.65); ellipse(14, 10, 6, 2.5, 5, 0.65);
ellipse(35, 10, 8, 4, 4, -0.65); ellipse(35, 9, 6, 2.5, 5, -0.65);
line(7, 16, 21, 24, 1, 3); line(30, 26, 41, 19, 1, 3);
line(25, 15, 26, 8, 2, 4);
for (let i = 0; i < 5; i += 1)
{
    const a = i * Math.PI * 2 / 5;
    ellipse(26 + Math.sin(a) * 3.5, 8 + Math.cos(a) * 3.5, 3, 3, 2);
}
ellipse(26, 8, 2, 2, 6);
polygon([[11, 33], [40, 33], [37, 46], [15, 46]], 1);
polygon([[14, 35], [37, 35], [34, 44], [17, 44]], 2);
polygon([[15, 35], [20, 35], [21, 44], [17, 44]], 8);
ellipse(25, 33, 15, 4, 7); ellipse(25, 32.5, 12, 2, 1);
rect(11, 33, 29, 4, 8); rect(14, 34, 22, 1, 3);
finish('flower-pot', '窗边花叶', ['brick', 'rose', 'cream', 'leaf-dark', 'leaf', 'gold', 'ink', 'peach'], '细致 · 叶脉、花心与陶盆明暗');

// Balloon: curved fabric gores narrow into a neck, with real connecting ropes and basket.
start();
line(18, 33, 20, 43, 2, 1); line(32, 33, 30, 43, 2, 1);
const balloon = (x, y) => ((x - 25) / 18) ** 2 + ((y - 20) / 17) ** 2 <= 1 || y >= 28 && y <= 38 && Math.abs(x - 25) <= (42 - y) * 0.7;
paint(1, balloon);
paint(2, (x, y) => balloon(x, y) && ((x - 25) / 16.5) ** 2 + ((y - 19) / 15.5) ** 2 < 1);
paint(3, (x, y) => balloon(x, y) && Math.abs(x - 25) < 10 * Math.sqrt(Math.max(0, 1 - ((y - 20) / 17) ** 2)) && y < 35);
paint(4, (x, y) => balloon(x, y) && Math.abs(x - 25) < 4 * Math.sqrt(Math.max(0, 1 - ((y - 20) / 17) ** 2)) && y < 35);
ellipse(16, 12, 2, 5, 4, 0.5);
rect(21, 35, 8, 3, 5); rect(19, 41, 12, 6, 1); rect(20, 42, 10, 4, 6);
line(20, 42, 30, 42, 1, 3);
for (const x of [22, 25, 28]) line(x, 43, x, 45, 1, 4);
finish('patchwork-balloon', '拼布热气球', ['ink', 'rose', 'gold', 'cream', 'rose-light', 'wood'], '进阶 · 弧形布片、收口、绳索与吊篮', 'advanced');

// House: roof tiles, dormer, crossbar window, glazed door and connected flower border.
start();
rect(34, 8, 6, 14, 1); rect(35, 9, 4, 9, 2); rect(33, 7, 8, 3, 1);
rect(8, 23, 34, 22, 1); rect(10, 24, 30, 19, 4); rect(37, 25, 3, 18, 9);
polygon([[3, 25], [25, 4], [47, 25]], 1);
polygon([[7, 23], [25, 8], [43, 23]], 2);
for (const [y, half] of [[15, 7], [19, 12], [22, 16]]) line(25 - half, y, 25 + half, y, 1, 3);
for (const [x, y] of [[23, 12], [28, 16], [20, 16], [15, 20], [24, 20], [34, 20]]) rect(x, y, 1, 2, 3);
rect(22, 17, 6, 7, 1); rect(23, 18, 4, 5, 6); line(25, 18, 25, 23, 1, 4);
rect(13, 28, 10, 10, 9); rect(14, 29, 8, 8, 5);
rect(14, 30, 3, 2, 4); line(18, 29, 18, 37, 1, 4); line(14, 33, 22, 33, 1, 4);
rect(26, 29, 10, 15, 9); rect(28, 31, 6, 12, 2); rect(29, 32, 4, 5, 5); rect(32, 39, 1, 1, 6);
rect(25, 43, 12, 2, 1);
ellipse(25, 45, 23, 2.5, 7); line(4, 43, 46, 43, 2, 8);
for (const x of [5, 44])
{
    line(x, 43, x, 36, 1.5, 7); ellipse(x, 35, 3, 3, 3); rect(x - 1, 34, 2, 2, 6);
}
finish('garden-house', '花园小屋', ['ink', 'brick', 'rose-light', 'cream', 'sky', 'gold', 'leaf-dark', 'leaf', 'wood'], '进阶 · 瓦片、阁楼窗、门窗与花圃', 'advanced');

// Rainbow: six concentric bands join both cloud banks; open center is deliberate.
start();
paint(8, (x, y) => y <= 33 && Math.hypot(x - 25, y - 31) <= 23 && Math.hypot(x - 25, y - 31) >= 7);
for (let band = 0; band < 6; band += 1)
{
    paint(band + 1, (x, y) => y <= 32 && Math.hypot(x - 25, y - 31) <= 22 - band * 2.3
        && Math.hypot(x - 25, y - 31) > 22 - (band + 1) * 2.3);
}
for (const cx of [12, 38])
{
    const cloud = (x, y) => ((x - cx) / 10) ** 2 + ((y - 37) / 6) ** 2 <= 1
        || ((x - cx + 3) / 6) ** 2 + ((y - 33) / 6) ** 2 <= 1
        || ((x - cx - 4) / 5) ** 2 + ((y - 34) / 5) ** 2 <= 1;
    paint(8, cloud);
    paint(7, (x, y) => cloud(x - 1, y) && cloud(x + 1, y) && cloud(x, y - 1) && cloud(x, y + 1));
    line(cx - 5, 39, cx + 4, 39, 1.5, 9);
}
finish('rainbow-clouds', '云端彩虹', ['rose', 'peach', 'gold', 'leaf', 'sky', 'lavender', 'cream', 'sky-dark', 'rose-light'], '进阶 · 六层弧线与连接的蓬松云层', 'advanced');

// A circular night scene keeps stars, crescent and island part of a single physical piece.
start();
ellipse(25, 25, 23, 23, 2); ellipse(25, 24, 21.5, 21.5, 1);
paint(3, (x, y) => y >= 30 && Math.hypot(x - 25, y - 25) <= 21.5);
ellipse(35, 13, 6, 6, 4); ellipse(38, 10, 5.5, 5.5, 1);
for (const [x, y] of [[13, 14], [21, 8], [9, 24], [41, 24]])
{
    line(x - 1.5, y, x + 1.5, y, 1, 5); line(x, y - 1.5, x, y + 1.5, 1, 5);
}
ellipse(25, 37, 14, 5, 8); ellipse(25, 35, 12, 3, 6);
polygon([[22, 36], [24, 19], [26, 19], [28, 36]], 2);
line(25, 29, 19, 23, 2, 2); line(25, 27, 32, 22, 2, 2);
ellipse(25, 18, 7, 7, 6); ellipse(19, 24, 7, 6, 6); ellipse(31, 24, 7, 6, 6);
ellipse(24, 16, 5, 4, 7); ellipse(17, 22, 4, 3, 7); ellipse(30, 22, 5, 3, 7);
line(21, 40, 29, 40, 1, 4); line(15, 43, 21, 43, 1, 9); line(29, 44, 35, 44, 1, 9);
line(7, 33, 12, 33, 1, 9); line(37, 34, 42, 34, 1, 9);
finish('moonlit-island', '月光小岛', ['night', 'lavender', 'sky-dark', 'cream', 'gold', 'leaf-dark', 'leaf', 'sand', 'sky'], '进阶 · 月牙、星点、树冠与水面倒影', 'advanced');

const output = new URL('../src/Core/Gameplay/Board/DetailedPatternData.ts', import.meta.url);
const code = '// Generated by scripts/generate-detailed-patterns.mjs. Edit the authored shapes, then regenerate.\n'
    + 'export const DETAILED_PATTERN_DATA = ' + JSON.stringify(definitions, null, 4) + ' as const;\n';
await writeFile(output, code, 'utf8');
