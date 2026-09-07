import { CanvasTexture, Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3 } from 'three';
import type { RoomSnapshot } from '../../shared/MultiplayerProtocol';
import type { PainterlyMaterials } from '../Rendering/PainterlyMaterials';
import type { BeadBoardView } from '../Rendering/BeadBoardView';

const COLORS = ['#b88270', '#789b8e', '#b29bcb', '#c5a65d'];
interface Partner { root: Group; label: Sprite; cursor: Mesh<TorusGeometry, MeshBasicMaterial>; previous: Vector3 }

export class PartnerView
{
    public readonly root = new Group();
    private readonly partners = new Map<string, Partner>();
    private readonly point = new Vector3();
    public constructor(private readonly prototype: Group, private readonly materials: PainterlyMaterials) {}

    public update(snapshot: RoomSnapshot | null, self: string | undefined, board: BeadBoardView, delta: number, time: number, detail: boolean): void
    {
        const players = snapshot?.players.filter((player) => player.playerId !== self) ?? [];
        for (const [id, partner] of this.partners)
        {
            if (!players.some((player) => player.playerId === id)) { this.remove(id, partner); }
        }
        for (const player of players)
        {
            let partner = this.partners.get(player.playerId);
            if (partner === undefined)
            {
                const color = COLORS[snapshot!.players.findIndex((entry) => entry.playerId === player.playerId) % 4];
                const root = this.prototype.clone(true);
                root.name = `Partner:${player.playerId}`;
                root.traverse((object) =>
                {
                    if (object instanceof Mesh && ['TerracottaApron', 'SageBeret', 'BeretStalk'].includes(object.name))
                    {
                        object.material = this.materials.create(color, 'fabric');
                    }
                });
                const canvas = document.createElement('canvas');
                canvas.width = 256; canvas.height = 64;
                const ctx = canvas.getContext('2d')!;
                ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(4, 4, 248, 56, 18); ctx.fill();
                ctx.fillStyle = '#533f48'; ctx.font = '30px Microsoft YaHei'; ctx.textAlign = 'center';
                ctx.fillText(player.nickname, 128, 43, 220);
                const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
                const label = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false }));
                label.scale.set(1.4, 0.35, 1); label.position.y = 1.95; label.renderOrder = 101;
                root.add(label);
                const cursor = new Mesh(new TorusGeometry(0.012, 0.001, 5, 20), new MeshBasicMaterial({ color, depthTest: false }));
                cursor.rotation.x = -Math.PI / 2; cursor.renderOrder = 100;
                this.root.add(root, cursor);
                root.position.set(player.x, 0, player.z);
                partner = { root, label, cursor, previous: root.position.clone() };
                this.partners.set(player.playerId, partner);
            }
            this.point.set(player.x, player.seat === null ? 0 : -0.03, player.z);
            partner.root.position.lerp(this.point, 1 - Math.exp(-delta * 15));
            partner.root.rotation.y = player.yaw;
            const moving = partner.previous.distanceToSquared(partner.root.position) > 0.00001;
            const stride = moving && player.seat === null ? Math.sin(time * 9.5) * 0.42 : 0;
            ['Left', 'Right'].forEach((side, index) =>
            {
                partner!.root.getObjectByName(`Avatar${side}Leg`)!.rotation.x = player.seat !== null ? -1.25 : stride * (index === 0 ? 1 : -1);
                partner!.root.getObjectByName(`Avatar${side}Knee`)!.rotation.x = player.seat !== null ? 1.28 : 0;
                partner!.root.getObjectByName(`Avatar${side}Arm`)!.rotation.x = player.seat !== null ? -0.65 : stride * (index === 0 ? -0.8 : 0.8);
            });
            partner.previous.copy(partner.root.position);
            partner.label.visible = !detail;
            partner.label.material.opacity = player.connected ? 1 : 0.45;
            partner.cursor.visible = detail && player.connected && player.cursor !== null;
            if (partner.cursor.visible)
            {
                board.cellWorld(player.cursor! % snapshot!.pattern.width, Math.floor(player.cursor! / snapshot!.pattern.width), partner.cursor.position);
                partner.cursor.position.y += 0.006;
            }
        }
    }

    public dispose(): void
    {
        for (const [id, partner] of this.partners) { this.remove(id, partner); }
        this.root.removeFromParent();
    }
    private remove(id: string, partner: Partner): void
    {
        partner.root.removeFromParent(); partner.cursor.removeFromParent();
        partner.label.material.map?.dispose(); partner.label.material.dispose();
        partner.cursor.geometry.dispose(); partner.cursor.material.dispose();
        this.partners.delete(id);
    }
}
