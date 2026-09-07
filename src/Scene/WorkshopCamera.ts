import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

import {
    advanceWorkshopBeadworkZoom,
    applyWorkshopBeadworkWheel,
    createWorkshopBeadworkZoomState
} from '../Core/Gameplay/Workshop/WorkshopBeadworkZoom';
import type {
    WorkshopActivityMode,
    WorkshopTransitionKind
} from '../Core/Gameplay/Workshop/WorkshopInteractionFlow';
import type { WorkshopReadModel } from '../App/WorkshopApplication';
import {
    BEAD_TOP_Y, BOARD_SIZE, BOARD_SURFACE_Y, BOARD_THICKNESS
} from '../Rendering/BeadDimensions';

interface CameraPose
{
    readonly position: Vector3;
    readonly rotation: Quaternion;
    fieldOfView: number;
    horizontalShift: number;
    verticalShift: number;
    detail: number;
}

const BOARD_HALF_EXTENT = BOARD_SIZE * 0.5;
const BOARD_CENTER = new Vector3(0, BOARD_SURFACE_Y, 0);
const UP = new Vector3(0, 1, 0);
const FULL_DIRECTION = new Vector3(0, 1, 0.2).normalize();
// Keep the established framing independent of bead diameter or pattern resolution.
const CLOSE_OFFSET = new Vector3(0, 0.405, 0.18);
const FULL_BOARD_FIELD_OF_VIEW = 42;
const WORLD_DISTANCE = Math.sqrt(7 * 7 + 5.8 * 5.8 + 9 * 9);

/**
 * Projects the three Application camera modes onto one PerspectiveCamera.
 * Wheel mode changes are returned as intents; this class never sits or stands.
 */
export class WorkshopCamera
{
    public readonly camera = new PerspectiveCamera(35, 16 / 9, 0.025, 80);

    private readonly projectionCamera = new PerspectiveCamera(42, 16 / 9, 0.025, 80);
    private readonly pose = createPose();
    private readonly transitionStart = createPose();
    private readonly transitionEnd = createPose();
    private readonly target = new Vector3();
    private readonly orientation = new Matrix4();
    private readonly projected = new Vector3();
    private readonly lastAvatarPosition = new Vector3();
    private zoomState = createWorkshopBeadworkZoomState();
    private mode: WorkshopReadModel['mode'] = 'workshop';
    private activeTransition: WorkshopTransitionKind | null = null;
    private transitionDestination: WorkshopActivityMode = 'workshop';
    private transitionStartProgress = 0;
    private transitionProgress = 0;
    private viewportWidth = 1920;
    private viewportHeight = 1080;
    private fullBoardDistance = BOARD_SIZE * 2;
    private worldYaw = Math.atan2(7, 9);
    private worldElevation = Math.asin(5.8 / WORLD_DISTANCE);
    // Keep the raised room clear of the welcome copy and footer at desktop sizes.
    private worldDistance = WORLD_DISTANCE * 1.48;
    private horizontalShift = 0;
    private verticalShift = 0;
    private panX = 0;
    private panZ = 0;
    private currentDetail = 0;

    /** Starts with the complete workshop visible in a long-lens perspective. */
    public constructor()
    {
        this.resize(this.viewportWidth, this.viewportHeight);
        this.writeStablePose('workshop', this.pose);
        this.applyPose(this.pose);
    }

    /** Continuous retained close-up amount, from zero/full board to one/detail. */
    public get zoom(): number
    {
        return this.zoomState.currentZoom;
    }

    /** Label opacity includes mode transitions; the full editable board is legible. */
    public get detailAmount(): number
    {
        return this.currentDetail;
    }

    /** Places the first frame at the saved avatar instead of damping from the origin. */
    public initializeWorldView(avatarPosition: Vector3): void
    {
        this.lastAvatarPosition.copy(avatarPosition);
        this.writeStablePose('workshop', this.pose);
        this.applyPose(this.pose);
    }

    /** Fits the same physical board around the top/bottom HUD and right panel. */
    public resize(width: number, height: number): void
    {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
        {
            return;
        }
        this.viewportWidth = Math.max(1, width);
        this.viewportHeight = Math.max(1, height);
        this.camera.aspect = width / height;
        this.projectionCamera.aspect = width / height;
        this.fullBoardDistance = this.fitFullBoardDistance();
        this.setProjection(this.camera, this.horizontalShift, this.verticalShift);

        if (this.activeTransition !== null)
        {
            this.capturePose(this.transitionStart);
            this.transitionStartProgress = this.transitionProgress;
            this.writeStablePose(this.transitionDestination, this.transitionEnd);
        }
    }

    /** Samples Application progress, then advances only mode-owned camera motion. */
    public update(deltaSeconds: number, model: WorkshopReadModel, avatarPosition: Vector3): void
    {
        const delta = Number.isFinite(deltaSeconds) ? MathUtils.clamp(deltaSeconds, 0, 0.1) : 0;
        this.lastAvatarPosition.copy(avatarPosition);

        if (model.mode === 'transition' && model.transition !== null)
        {
            const transition = model.transition;
            if (this.activeTransition !== transition.kind)
            {
                this.capturePose(this.transitionStart);
                this.activeTransition = transition.kind;
                this.transitionDestination = transition.to;
                this.transitionStartProgress = 0;
                if (transition.to === 'beadwork')
                {
                    this.resetBoardView();
                }
                this.writeStablePose(transition.to, this.transitionEnd);
            }
            this.mode = 'transition';
            this.transitionProgress = MathUtils.clamp(transition.progress, 0, 1);
            const progress = (this.transitionProgress - this.transitionStartProgress)
                / Math.max(0.00001, 1 - this.transitionStartProgress);
            this.sampleTransition(MathUtils.smoothstep(progress, 0, 1));
            return;
        }

        if (model.mode === 'transition')
        {
            return;
        }
        if (this.activeTransition !== null)
        {
            // The stable target uses the same pose builder as the transition.
            // Complete an omitted final animation sample before normal updates.
            this.applyPose(this.transitionEnd);
            this.activeTransition = null;
        }
        else if (model.mode === 'beadwork' && this.mode !== 'beadwork')
        {
            this.resetBoardView();
        }
        this.mode = model.mode;
        if (model.mode === 'beadwork')
        {
            this.zoomState = advanceWorkshopBeadworkZoom(this.zoomState, delta);
            this.clampPan();
        }
        this.writeStablePose(model.mode, this.pose);

        if (model.mode === 'workshop')
        {
            const response = 1 - Math.exp(-7 * delta);
            this.camera.position.lerp(this.pose.position, response);
            this.camera.quaternion.slerp(this.pose.rotation, response);
            this.camera.fov = this.pose.fieldOfView;
            this.currentDetail = 0;
            this.setProjection(this.camera, this.pose.horizontalShift, this.pose.verticalShift);
            this.camera.updateMatrixWorld();
        }
        else
        {
            this.applyPose(this.pose);
        }
    }

    /** DOM negative deltaY moves closer; Shared owns continuous zoom and exit guard. */
    public wheel(deltaY: number, model: WorkshopReadModel): 'focus' | 'retreat' | null
    {
        if (!Number.isFinite(deltaY) || deltaY === 0 || model.mode === 'transition')
        {
            return null;
        }
        if (model.mode === 'workshop')
        {
            this.worldDistance = MathUtils.clamp(
                this.worldDistance * Math.exp(MathUtils.clamp(deltaY, -600, 600) * 0.001),
                10.5, 22);
            return null;
        }
        if (model.mode === 'tabletop')
        {
            return deltaY < 0 ? 'focus' : null;
        }

        const result = applyWorkshopBeadworkWheel(this.zoomState, -deltaY);
        this.zoomState = result.state;
        return result.exitRequested ? 'retreat' : null;
    }

    /** Right drag rotates only the settled workshop camera, never the board. */
    public orbit(deltaX: number, deltaY: number): void
    {
        if (this.mode !== 'workshop' || !Number.isFinite(deltaX) || !Number.isFinite(deltaY))
        {
            return;
        }
        this.worldYaw -= MathUtils.clamp(deltaX, -300, 300) * 0.004;
        this.worldElevation = MathUtils.clamp(
            this.worldElevation + MathUtils.clamp(deltaY, -300, 300) * 0.003,
            Math.PI * 0.14, Math.PI * 0.32);
    }

    /** Screen-space drag pans a close-up within the physical board's footprint. */
    public pan(deltaX: number, deltaY: number): void
    {
        if (this.mode !== 'beadwork' || this.zoom < 0.08
            || !Number.isFinite(deltaX) || !Number.isFinite(deltaY))
        {
            return;
        }
        const visibleHeight = this.boardViewHeight();
        this.panX -= deltaX * visibleHeight / this.viewportHeight;
        this.panZ -= deltaY * visibleHeight / this.viewportHeight;
        this.clampPan();
    }

    private writeStablePose(mode: WorkshopActivityMode, output: CameraPose): void
    {
        output.horizontalShift = mode === 'workshop' ? -0.09 : 0.07;
        output.verticalShift = mode === 'workshop' ? 0.02 : 5 / this.viewportHeight;
        output.fieldOfView = mode === 'workshop' ? 35 : FULL_BOARD_FIELD_OF_VIEW;
        output.detail = 0;

        if (mode === 'workshop')
        {
            this.target.set(
                MathUtils.clamp(this.lastAvatarPosition.x * 0.055, -0.23, 0.23),
                0.7,
                MathUtils.clamp(this.lastAvatarPosition.z * 0.055, -0.2, 0.2));
            const horizontal = Math.cos(this.worldElevation) * this.worldDistance;
            output.position.set(
                Math.sin(this.worldYaw) * horizontal,
                Math.sin(this.worldElevation) * this.worldDistance,
                Math.cos(this.worldYaw) * horizontal).add(this.target);
        }
        else if (mode === 'tabletop')
        {
            this.target.copy(BOARD_CENTER);
            output.position.set(0, 3.4, 3.9);
        }
        else
        {
            const zoom = this.zoomState.currentZoom;
            output.verticalShift = 20 / this.viewportHeight;
            this.target.copy(BOARD_CENTER).add(this.projected.set(this.panX, 0, this.panZ));
            output.position.copy(FULL_DIRECTION).multiplyScalar(this.fullBoardDistance);
            output.position.lerp(CLOSE_OFFSET, zoom).add(this.target);
            output.detail = 0.78 + zoom * 0.22;
        }
        this.orientation.lookAt(output.position, this.target, UP);
        output.rotation.setFromRotationMatrix(this.orientation);
    }

    private resetBoardView(): void
    {
        this.zoomState = { ...createWorkshopBeadworkZoomState(), fullBoardIdleSeconds: 0 };
        this.panX = 0;
        this.panZ = 0;
    }

    private capturePose(output: CameraPose): void
    {
        output.position.copy(this.camera.position);
        output.rotation.copy(this.camera.quaternion);
        output.fieldOfView = this.camera.fov;
        output.horizontalShift = this.horizontalShift;
        output.verticalShift = this.verticalShift;
        output.detail = this.currentDetail;
    }

    private sampleTransition(progress: number): void
    {
        const start = this.transitionStart;
        const end = this.transitionEnd;
        this.pose.position.lerpVectors(start.position, end.position, progress);
        this.pose.rotation.slerpQuaternions(start.rotation, end.rotation, progress);
        this.pose.fieldOfView = MathUtils.lerp(start.fieldOfView, end.fieldOfView, progress);
        this.pose.horizontalShift = MathUtils.lerp(start.horizontalShift, end.horizontalShift, progress);
        this.pose.verticalShift = MathUtils.lerp(start.verticalShift, end.verticalShift, progress);
        this.pose.detail = MathUtils.lerp(start.detail, end.detail, progress);
        this.applyPose(this.pose);
    }

    private applyPose(pose: CameraPose): void
    {
        this.camera.position.copy(pose.position);
        this.camera.quaternion.copy(pose.rotation);
        this.camera.fov = pose.fieldOfView;
        this.currentDetail = pose.detail;
        this.setProjection(this.camera, pose.horizontalShift, pose.verticalShift);
        this.camera.updateMatrixWorld();
    }

    private setProjection(camera: PerspectiveCamera, horizontal: number, vertical: number): void
    {
        camera.setViewOffset(this.viewportWidth, this.viewportHeight,
            this.viewportWidth * horizontal, this.viewportHeight * vertical,
            this.viewportWidth, this.viewportHeight);
        if (camera === this.camera)
        {
            this.horizontalShift = horizontal;
            this.verticalShift = vertical;
        }
    }

    private fitFullBoardDistance(): number
    {
        const camera = this.projectionCamera;
        camera.fov = FULL_BOARD_FIELD_OF_VIEW;
        this.setProjection(camera, 0.07, 20 / this.viewportHeight);
        let distance = BOARD_HALF_EXTENT / Math.tan(MathUtils.degToRad(FULL_BOARD_FIELD_OF_VIEW * 0.5));
        for (let attempt = 0; attempt < 120; attempt += 1)
        {
            camera.position.copy(FULL_DIRECTION).multiplyScalar(distance).add(BOARD_CENTER);
            camera.lookAt(BOARD_CENTER);
            camera.updateMatrixWorld();
            if (this.boardCornersFit(camera))
            {
                return distance;
            }
            distance *= 1.025;
        }
        return distance;
    }

    private boardCornersFit(camera: PerspectiveCamera): boolean
    {
        const top = Math.min(120, this.viewportHeight * 0.22);
        const bottom = this.viewportHeight - Math.min(180, this.viewportHeight * 0.26);
        const left = Math.min(48, this.viewportWidth * 0.06);
        const right = this.viewportWidth - Math.min(300, this.viewportWidth * 0.28);
        for (const x of [-BOARD_HALF_EXTENT, BOARD_HALF_EXTENT])
        {
            for (const z of [-BOARD_HALF_EXTENT, BOARD_HALF_EXTENT])
            {
                for (const y of [BOARD_SURFACE_Y - BOARD_THICKNESS, BEAD_TOP_Y])
                {
                    this.projected.set(x, y, z).project(camera);
                    const screenX = (this.projected.x + 1) * this.viewportWidth * 0.5;
                    const screenY = (1 - this.projected.y) * this.viewportHeight * 0.5;
                    if (screenX < left || screenX > right || screenY < top || screenY > bottom)
                    {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    private boardViewHeight(): number
    {
        const distance = this.projected.copy(FULL_DIRECTION)
            .multiplyScalar(this.fullBoardDistance).lerp(CLOSE_OFFSET, this.zoom).length();
        return 2 * distance * Math.tan(MathUtils.degToRad(FULL_BOARD_FIELD_OF_VIEW * 0.5));
    }

    private clampPan(): void
    {
        if (this.zoom < 0.08)
        {
            this.panX = 0;
            this.panZ = 0;
            return;
        }
        const visibleHeight = this.boardViewHeight();
        const usableHeight = Math.max(0.3, (this.viewportHeight - 300) / this.viewportHeight);
        const usableWidth = Math.max(0.3, (this.viewportWidth - 348) / this.viewportWidth);
        const halfWidth = visibleHeight * this.camera.aspect * usableWidth * 0.5;
        const halfHeight = visibleHeight * usableHeight * 0.5;
        const horizontalLimit = Math.max(0, BOARD_HALF_EXTENT - halfWidth) * this.zoom;
        const verticalLimit = Math.max(0, BOARD_HALF_EXTENT - halfHeight) * this.zoom;
        this.panX = MathUtils.clamp(this.panX, -horizontalLimit, horizontalLimit);
        this.panZ = MathUtils.clamp(this.panZ, -verticalLimit, verticalLimit);
    }
}

function createPose(): CameraPose
{
    return {
        position: new Vector3(),
        rotation: new Quaternion(),
        fieldOfView: 35,
        horizontalShift: 0,
        verticalShift: 0,
        detail: 0
    };
}
