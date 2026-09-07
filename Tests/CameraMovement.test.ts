import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { WorkshopApplication } from '../src/App/WorkshopApplication.ts';
import { WorkshopCamera } from '../src/Scene/WorkshopCamera.ts';

test('WASD follows screen directions from all four sides and the avatar faces its travel', () =>
{
    const viewpoints = [
        { position: [0, 6, 10], forward: [0, 0, -1], right: [1, 0, 0] },
        { position: [10, 6, 0], forward: [-1, 0, 0], right: [0, 0, -1] },
        { position: [0, 6, -10], forward: [0, 0, 1], right: [-1, 0, 0] },
        { position: [-10, 6, 0], forward: [1, 0, 0], right: [0, 0, 1] }
    ];
    for (const view of viewpoints)
    {
        const rig = new WorkshopCamera();
        rig.camera.position.fromArray(view.position);
        rig.camera.lookAt(0, 0, 0);
        rig.camera.updateMatrixWorld(true);
        for (const [right, forward] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1]])
        {
            const expected = new Vector3().fromArray(view.forward).multiplyScalar(forward)
                .addScaledVector(new Vector3().fromArray(view.right), right).normalize();
            const direction = rig.getWalkDirection(right, forward, new Vector3());
            assert.ok(direction.distanceTo(expected) < 0.000001);
            assert.equal(direction.y, 0);
            const projectedOrigin = new Vector3().project(rig.camera);
            const projectedEnd = direction.clone().multiplyScalar(0.2).project(rig.camera);
            if (right !== 0)
            {
                assert.ok((projectedEnd.x - projectedOrigin.x) * right > 0, 'A/D move to the matching screen side');
            }
            if (forward !== 0)
            {
                assert.ok((projectedEnd.y - projectedOrigin.y) * forward > 0, 'W/S move forward/backward on screen');
            }
            const app = new WorkshopApplication();
            const before = app.getReadModel().avatar;
            app.dispatch({ type: 'move', x: direction.x, z: direction.z, deltaSeconds: 0.1 });
            const after = app.getReadModel().avatar;
            assert.ok(Math.abs(Math.hypot(after.x - before.x, after.z - before.z) - 0.2) < 0.000001,
                'diagonal and cardinal travel keep the same ground speed');
            assert.ok(new Vector3(Math.sin(after.yaw), 0, Math.cos(after.yaw)).distanceTo(expected) < 0.000001);
            assert.ok(rig.getWalkDirection(right, forward, new Vector3()).distanceTo(direction) < 0.000001,
                'turning the avatar does not redefine the next input direction');
        }
    }
});

test('movement follows the visible camera during a damped orbit rather than the future orbit target', () =>
{
    const rig = new WorkshopCamera();
    const app = new WorkshopApplication();
    const avatar = new Vector3(0, 0, 2.4);
    rig.initializeWorldView(avatar);
    const before = rig.getWalkDirection(0, 1, new Vector3());
    rig.orbit(250, 20);
    assert.ok(rig.getWalkDirection(0, 1, new Vector3()).distanceTo(before) < 0.000001);
    rig.update(1 / 60, app.getReadModel(), avatar);
    const during = rig.getWalkDirection(0, 1, new Vector3());
    assert.ok(during.angleTo(before) > 0.01 && during.angleTo(before) < 0.3);
    const rendered = rig.camera.getWorldDirection(new Vector3());
    rendered.y = 0;
    assert.ok(during.distanceTo(rendered.normalize()) < 0.000001);
    for (let frame = 0; frame < 120; frame += 1)
    {
        rig.update(1 / 60, app.getReadModel(), avatar);
    }
    assert.ok(rig.getWalkDirection(0, 1, new Vector3()).angleTo(before) > 0.8);
});

test('overhead and zero input remain horizontal and non-workshop movement stays rejected', () =>
{
    const rig = new WorkshopCamera();
    rig.camera.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    assert.ok(rig.getWalkDirection(0, 1, new Vector3()).distanceTo(new Vector3(0, 0, -1)) < 0.000001);
    assert.equal(rig.getWalkDirection(0, 0, new Vector3()).length(), 0);
    const app = new WorkshopApplication();
    app.dispatch({ type: 'sit' });
    for (const step of ['transition', 'tabletop', 'beadwork'])
    {
        if (step === 'tabletop')
        {
            app.dispatch({ type: 'tick', deltaSeconds: 1 });
        }
        if (step === 'beadwork')
        {
            app.dispatch({ type: 'focus' });
            app.dispatch({ type: 'tick', deltaSeconds: 1 });
        }
        const before = app.getReadModel().avatar;
        const direction = rig.getWalkDirection(1, 1, new Vector3());
        assert.equal(app.dispatch({ type: 'move', x: direction.x, z: direction.z, deltaSeconds: 0.1 }).accepted, false);
        assert.deepEqual(app.getReadModel().avatar, before);
    }
});
