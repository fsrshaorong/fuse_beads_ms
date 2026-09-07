/** Shared physical layout for authoritative movement and the four-seat scene. */
export const WORKSHOP_LAYOUT = Object.freeze({
    halfWidth: 5.9,
    halfDepth: 4.7,
    walkHalfWidth: 5.5,
    walkHalfDepth: 4.2,
    tableHalfWidth: 2.1,
    tableHalfDepth: 1.35,
    spawns: Object.freeze([
        Object.freeze({ x: 0, z: 2.4 }), Object.freeze({ x: 1.05, z: 2.4 }),
        Object.freeze({ x: -1.05, z: 2.4 }), Object.freeze({ x: 0, z: 3.4 })
    ]),
    seats: Object.freeze([
        Object.freeze({ x: 0, z: 1.65 }), Object.freeze({ x: 2.35, z: 0 }),
        Object.freeze({ x: 0, z: -1.65 }), Object.freeze({ x: -2.35, z: 0 })
    ])
});

export function advanceWorkshopPosition(x: number, z: number, dx: number, dz: number, seconds: number): { x: number; z: number }
{
    const length = Math.max(1, Math.hypot(dx, dz));
    const nextX = Math.max(-WORKSHOP_LAYOUT.walkHalfWidth, Math.min(WORKSHOP_LAYOUT.walkHalfWidth, x + dx / length * seconds * 2));
    const nextZ = Math.max(-WORKSHOP_LAYOUT.walkHalfDepth, Math.min(WORKSHOP_LAYOUT.walkHalfDepth, z + dz / length * seconds * 2));
    if (Math.abs(nextX) >= WORKSHOP_LAYOUT.tableHalfWidth || Math.abs(z) >= WORKSHOP_LAYOUT.tableHalfDepth)
    {
        x = nextX;
    }
    if (Math.abs(x) >= WORKSHOP_LAYOUT.tableHalfWidth || Math.abs(nextZ) >= WORKSHOP_LAYOUT.tableHalfDepth)
    {
        z = nextZ;
    }
    return { x, z };
}
