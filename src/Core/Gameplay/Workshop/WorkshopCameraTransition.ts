import type { WorkshopTransitionKind } from './WorkshopInteractionFlow';

const MINIMUM_QUATERNION_LENGTH_SQUARED = 0.000001;

/** Required transition timings from the Workshop camera interaction spec. */
export const WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS: Readonly<
Record<WorkshopTransitionKind, number>
> = Object.freeze({
    sit: 0.6,
    'focus-board': 0.4,
    'unfocus-board': 0.35,
    stand: 0.6
});

/** Serializable three-dimensional camera position. */
export interface WorkshopCameraPosition
{
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Serializable normalized camera rotation. */
export interface WorkshopCameraRotation
{
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

/** Engine-independent camera pose shared by transition rules and tests. */
export interface WorkshopCameraPose
{
    readonly position: WorkshopCameraPosition;
    readonly rotation: WorkshopCameraRotation;
    readonly verticalFieldOfViewDegrees: number;
}

/** Retained camera pose target used by allocation-free presentation sampling. */
export interface MutableWorkshopCameraPose
{
    readonly position: {
        x: number;
        y: number;
        z: number;
    };
    readonly rotation: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
    verticalFieldOfViewDegrees: number;
}

/** Immutable camera transition sampled by the Cocos presentation adapter. */
export interface WorkshopCameraTransition
{
    readonly kind: WorkshopTransitionKind;
    readonly start: WorkshopCameraPose;
    readonly end: WorkshopCameraPose;
    readonly durationSeconds: number;
    readonly reducedMotion: boolean;
}

/** One deterministic transition sample including completion state. */
export interface WorkshopCameraTransitionSample
{
    readonly pose: WorkshopCameraPose;
    readonly progress: number;
    readonly easedProgress: number;
    readonly complete: boolean;
}

/** Creates a validated camera transition without retaining caller-owned values. */
export function createWorkshopCameraTransition(
    kind: WorkshopTransitionKind,
    start: WorkshopCameraPose,
    end: WorkshopCameraPose,
    reducedMotion: boolean
): WorkshopCameraTransition
{
    const startPose = copyAndValidatePose(start);
    const endPose = copyAndValidatePose(end);

    return Object.freeze({
        kind,
        start: startPose,
        end: endPose,
        durationSeconds: WORKSHOP_CAMERA_TRANSITION_DURATIONS_SECONDS[kind],
        reducedMotion
    });
}

/** Samples position, shortest-path rotation and vertical field of view with smoothstep easing. */
export function sampleWorkshopCameraTransition(
    transition: WorkshopCameraTransition,
    elapsedSeconds: number
): WorkshopCameraTransitionSample
{
    if (!Number.isFinite(elapsedSeconds))
    {
        throw new RangeError('Workshop camera transition time must be finite.');
    }

    const progress = clamp01(elapsedSeconds / transition.durationSeconds);

    if (progress <= 0)
    {
        return createSample(transition.start, 0, 0, false);
    }

    if (progress >= 1)
    {
        return createSample(transition.end, 1, 1, true);
    }

    const easedProgress = transition.reducedMotion
        ? progress
        : progress * progress * (3 - 2 * progress);
    const pose: WorkshopCameraPose = Object.freeze({
        position: Object.freeze({
            x: interpolate(
                transition.start.position.x,
                transition.end.position.x,
                easedProgress
            ),
            y: interpolate(
                transition.start.position.y,
                transition.end.position.y,
                easedProgress
            ),
            z: interpolate(
                transition.start.position.z,
                transition.end.position.z,
                easedProgress
            )
        }),
        rotation: interpolateRotation(
            transition.start.rotation,
            transition.end.rotation,
            easedProgress
        ),
        verticalFieldOfViewDegrees: interpolate(
            transition.start.verticalFieldOfViewDegrees,
            transition.end.verticalFieldOfViewDegrees,
            easedProgress
        )
    });

    return createSample(pose, progress, easedProgress, false);
}

/** Samples one transition into a retained pose and returns whether it completed. */
export function sampleWorkshopCameraTransitionInto(
    transition: WorkshopCameraTransition,
    elapsedSeconds: number,
    output: MutableWorkshopCameraPose
): boolean
{
    if (!Number.isFinite(elapsedSeconds))
    {
        throw new RangeError('Workshop camera transition time must be finite.');
    }

    const progress = clamp01(elapsedSeconds / transition.durationSeconds);
    const easedProgress = transition.reducedMotion
        ? progress
        : progress * progress * (3 - 2 * progress);
    output.position.x = interpolate(
        transition.start.position.x,
        transition.end.position.x,
        easedProgress
    );
    output.position.y = interpolate(
        transition.start.position.y,
        transition.end.position.y,
        easedProgress
    );
    output.position.z = interpolate(
        transition.start.position.z,
        transition.end.position.z,
        easedProgress
    );
    writeInterpolatedRotation(
        transition.start.rotation,
        transition.end.rotation,
        easedProgress,
        output.rotation
    );
    output.verticalFieldOfViewDegrees = interpolate(
        transition.start.verticalFieldOfViewDegrees,
        transition.end.verticalFieldOfViewDegrees,
        easedProgress
    );

    return progress >= 1;
}

function copyAndValidatePose(pose: WorkshopCameraPose): WorkshopCameraPose
{
    const values = [
        pose.position.x,
        pose.position.y,
        pose.position.z,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
        pose.verticalFieldOfViewDegrees
    ];

    if (!values.every(Number.isFinite)
        || pose.verticalFieldOfViewDegrees <= 1
        || pose.verticalFieldOfViewDegrees >= 179)
    {
        throw new RangeError('Workshop camera pose must contain finite usable values.');
    }

    const rotationLengthSquared = getRotationLengthSquared(pose.rotation);

    if (rotationLengthSquared < MINIMUM_QUATERNION_LENGTH_SQUARED)
    {
        throw new RangeError('Workshop camera rotation must be non-zero.');
    }

    const rotationScale = 1 / Math.sqrt(rotationLengthSquared);

    return Object.freeze({
        position: Object.freeze({
            x: pose.position.x,
            y: pose.position.y,
            z: pose.position.z
        }),
        rotation: Object.freeze({
            x: pose.rotation.x * rotationScale,
            y: pose.rotation.y * rotationScale,
            z: pose.rotation.z * rotationScale,
            w: pose.rotation.w * rotationScale
        }),
        verticalFieldOfViewDegrees: pose.verticalFieldOfViewDegrees
    });
}

function interpolateRotation(
    start: WorkshopCameraRotation,
    end: WorkshopCameraRotation,
    progress: number
): WorkshopCameraRotation
{
    const dot = start.x * end.x
        + start.y * end.y
        + start.z * end.z
        + start.w * end.w;
    const endScale = dot < 0 ? -1 : 1;
    const rotation = {
        x: interpolate(start.x, end.x * endScale, progress),
        y: interpolate(start.y, end.y * endScale, progress),
        z: interpolate(start.z, end.z * endScale, progress),
        w: interpolate(start.w, end.w * endScale, progress)
    };
    const lengthSquared = getRotationLengthSquared(rotation);
    const scale = lengthSquared < MINIMUM_QUATERNION_LENGTH_SQUARED
        ? 1
        : 1 / Math.sqrt(lengthSquared);

    return Object.freeze({
        x: rotation.x * scale,
        y: rotation.y * scale,
        z: rotation.z * scale,
        w: rotation.w * scale
    });
}

function writeInterpolatedRotation(
    start: WorkshopCameraRotation,
    end: WorkshopCameraRotation,
    progress: number,
    output: { x: number; y: number; z: number; w: number }
): void
{
    const dot = start.x * end.x
        + start.y * end.y
        + start.z * end.z
        + start.w * end.w;
    const endScale = dot < 0 ? -1 : 1;
    output.x = interpolate(start.x, end.x * endScale, progress);
    output.y = interpolate(start.y, end.y * endScale, progress);
    output.z = interpolate(start.z, end.z * endScale, progress);
    output.w = interpolate(start.w, end.w * endScale, progress);
    const lengthSquared = getRotationLengthSquared(output);
    const scale = lengthSquared < MINIMUM_QUATERNION_LENGTH_SQUARED
        ? 1
        : 1 / Math.sqrt(lengthSquared);
    output.x *= scale;
    output.y *= scale;
    output.z *= scale;
    output.w *= scale;
}

function getRotationLengthSquared(rotation: WorkshopCameraRotation): number
{
    return rotation.x * rotation.x
        + rotation.y * rotation.y
        + rotation.z * rotation.z
        + rotation.w * rotation.w;
}

function createSample(
    pose: WorkshopCameraPose,
    progress: number,
    easedProgress: number,
    complete: boolean
): WorkshopCameraTransitionSample
{
    return Object.freeze({
        pose,
        progress,
        easedProgress,
        complete
    });
}

function interpolate(start: number, end: number, progress: number): number
{
    return start + (end - start) * progress;
}

function clamp01(value: number): number
{
    return Math.max(0, Math.min(1, value));
}
