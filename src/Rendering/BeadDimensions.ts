/** Physical craft dimensions. See docs/BEAD_MODELS.md for sources and estimates. */
export const BEAD_DIMENSIONS = Object.freeze({
    diameterMm: 4.77,
    heightMm: 5.07,
    holeDiameterMm: 2.5,
    pitchMm: 5,
    fusedHeightMm: 3.7,
    boardSizeMm: 145,
    boardThicknessMm: 2.5,
    pegHeightMm: 3.1,
    pegDiameterMm: 1.6,
    gridSize: 29
});

// Art direction scale: a 145 mm board spans 23% of the 3.8-unit workbench.
// This changes the craft's world size, never the size of an individual bead per pattern.
export const MILLIMETRES_TO_WORLD = 0.006;
export const METRES_TO_WORLD = MILLIMETRES_TO_WORLD * 1000;
export const BEAD_PITCH = BEAD_DIMENSIONS.pitchMm * MILLIMETRES_TO_WORLD;
export const BEAD_HEIGHT = BEAD_DIMENSIONS.heightMm * MILLIMETRES_TO_WORLD;
export const BOARD_SIZE = BEAD_DIMENSIONS.boardSizeMm * MILLIMETRES_TO_WORLD;
export const BOARD_THICKNESS = BEAD_DIMENSIONS.boardThicknessMm * MILLIMETRES_TO_WORLD;
export const BOARD_SURFACE_Y = 1.14 + BOARD_THICKNESS;
export const BEAD_TOP_Y = BOARD_SURFACE_Y + BEAD_HEIGHT;
export const PEG_HEIGHT = BEAD_DIMENSIONS.pegHeightMm * MILLIMETRES_TO_WORLD;

/** Center smaller patterns on actual pegs, including even patterns on the odd grid. */
export function patternGridOffset(size: number): number
{
    return Math.floor((BEAD_DIMENSIONS.gridSize - size) / 2) - (BEAD_DIMENSIONS.gridSize - 1) / 2;
}
