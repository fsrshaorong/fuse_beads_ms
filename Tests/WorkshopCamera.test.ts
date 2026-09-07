import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { WorkshopApplication } from '../src/App/WorkshopApplication.ts';
import { WorkshopCamera } from '../src/Scene/WorkshopCamera.ts';

const AVATAR_POSITION = new Vector3(0, 0, 1.8);

test('all four mode transitions meet the settled camera without a final pose or projection jump', () =>
{
    const application = new WorkshopApplication();
    const rig = new WorkshopCamera();
    rig.resize(1280, 720);
    advanceCamera(rig, application, 1);
    rig.orbit(27, -12);
    advanceCamera(rig, application, 0.5);

    for (const type of ['sit', 'focus', 'retreat', 'stand'] as const)
    {
        const initialPosition = rig.camera.position.clone();
        const initialRotation = rig.camera.quaternion.clone();
        assert.equal(application.dispatch({ type }).accepted, true);
        const transition = application.getReadModel().transition;
        assert.ok(transition !== null);
        rig.update(0, application.getReadModel(), AVATAR_POSITION);
        assert.ok(rig.camera.position.distanceTo(initialPosition) < 0.000001, `${type}: captured position`);
        assert.ok(rig.camera.quaternion.angleTo(initialRotation) < 0.000001, `${type}: captured orientation`);

        const epsilon = 0.000001;
        application.dispatch({ type: 'tick', deltaSeconds: transition.durationSeconds - epsilon });
        rig.update(1 / 60, application.getReadModel(), AVATAR_POSITION);
        const finalPosition = rig.camera.position.clone();
        const finalRotation = rig.camera.quaternion.clone();
        const finalProjection = rig.camera.projectionMatrix.clone();
        const finalDetail = rig.detailAmount;

        application.dispatch({ type: 'tick', deltaSeconds: epsilon * 2 });
        rig.update(0, application.getReadModel(), AVATAR_POSITION);
        assert.notEqual(application.getReadModel().mode, 'transition');
        assert.ok(rig.camera.position.distanceTo(finalPosition) < 0.000001, `${type}: settled position`);
        assert.ok(rig.camera.quaternion.angleTo(finalRotation) < 0.000001, `${type}: settled orientation`);
        assert.ok(Math.abs(rig.detailAmount - finalDetail) < 0.000001, `${type}: settled labels`);

        for (let index = 0; index < finalProjection.elements.length; index += 1)
        {
            assert.ok(Math.abs(rig.camera.projectionMatrix.elements[index]
                - finalProjection.elements[index]) < 0.000001, `${type}: settled projection`);
        }

        if (type === 'focus')
        {
            // Returning to the table must also capture an actual user-adjusted close-up.
            for (let notch = 0; notch < 20; notch += 1)
            {
                rig.wheel(-120, application.getReadModel());
            }
            advanceCamera(rig, application, 2);
            rig.pan(100, -80);
            rig.update(0, application.getReadModel(), AVATAR_POSITION);
        }
    }
});

test('the full physical board fits between the desktop HUD and the color panel', () =>
{
    for (const [width, height] of [[1280, 720], [1920, 1080]])
    {
        const rig = new WorkshopCamera();
        rig.resize(width, height);
        enterBoard(rig);

        // These are the actual board envelope and the reserved UI clearances,
        // independent of the camera's lens, position or fitting algorithm.
        for (const horizontal of [-0.81, 0.81])
        {
            for (const depth of [-0.81, 0.81])
            {
                for (const elevation of [1.18, 1.3])
                {
                    const point = new Vector3(horizontal, elevation, depth).project(rig.camera);
                    const screenX = (point.x + 1) * width / 2;
                    const screenY = (1 - point.y) * height / 2;
                    assert.ok(screenX >= 48 && screenX <= width - 300,
                        `${width} × ${height}: corner clears the left margin and color panel`);
                    assert.ok(screenY >= 120 && screenY <= height - 180,
                        `${width} × ${height}: corner clears the header and tool dock`);
                }
            }
        }
    }
});

test('zooming fully out requires a fresh wheel gesture after the exit protection interval', () =>
{
    const rig = new WorkshopCamera();
    const application = enterBoard(rig);
    const model = application.getReadModel();

    for (let notch = 0; notch < 20; notch += 1)
    {
        assert.equal(rig.wheel(-120, model), null);
    }
    advanceCamera(rig, application, 2);
    assert.equal(rig.zoom, 1);

    for (let notch = 0; notch < 20; notch += 1)
    {
        assert.equal(rig.wheel(120, model), null);
    }
    for (let frame = 0; frame < 180 && rig.zoom > 0; frame += 1)
    {
        rig.update(1 / 60, model, AVATAR_POSITION);
    }
    assert.equal(rig.zoom, 0);
    assert.equal(rig.wheel(120, model), null, 'reaching the full board does not itself retreat');
    advanceCamera(rig, application, 0.1);
    assert.equal(rig.wheel(120, model), null, 'wheel inertia inside 120 ms cannot retreat');
    advanceCamera(rig, application, 0.15);
    assert.equal(rig.wheel(120, model), 'retreat', 'a deliberate later gesture returns to the table');
});

function enterBoard(rig: WorkshopCamera): WorkshopApplication
{
    const application = new WorkshopApplication();

    for (const type of ['sit', 'focus'] as const)
    {
        assert.equal(application.dispatch({ type }).accepted, true);
        rig.update(0, application.getReadModel(), AVATAR_POSITION);
        application.dispatch({ type: 'tick', deltaSeconds: 1 });
        rig.update(0, application.getReadModel(), AVATAR_POSITION);
    }

    assert.equal(application.getReadModel().mode, 'beadwork');
    return application;
}

function advanceCamera(rig: WorkshopCamera, application: WorkshopApplication, seconds: number): void
{
    for (let frame = 0; frame < Math.ceil(seconds * 60); frame += 1)
    {
        rig.update(1 / 60, application.getReadModel(), AVATAR_POSITION);
    }
}
