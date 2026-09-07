import type { OnlineWorkshopApplication } from '../App/OnlineWorkshopApplication';

interface RoomActions
{
    create(nickname: string, name: string): Promise<void>;
    join(nickname: string, roomId: string): Promise<void>;
    leave(): Promise<void>;
    interrupt(): void;
    notify(message: string): void;
}

/** Compact room controls using the same paper treatment as the craft HUD. */
export class RoomPanel
{
    public readonly dialog: HTMLDialogElement;
    private readonly strip: HTMLElement;
    private readonly button: HTMLButtonElement;
    private online: OnlineWorkshopApplication | null = null;
    private signature = '';

    public constructor(root: HTMLElement, private readonly actions: RoomActions)
    {
        this.button = document.createElement('button');
        this.button.className = 'room-open-button';
        this.button.id = 'room-button';
        this.button.textContent = '一起拼豆';
        root.querySelector('.header-actions')!.prepend(this.button);
        this.strip = document.createElement('aside');
        this.strip.className = 'room-strip';
        this.strip.hidden = true;
        this.strip.setAttribute('aria-label', '联机房间');
        this.strip.innerHTML = '<strong class="room-caption"></strong><div class="room-players"></div><div class="room-proposal" hidden><p></p><button id="vote-yes">一起开始</button><button id="vote-no">先保留当前作品</button></div>';
        root.querySelector('.atelier')!.append(this.strip);
        this.dialog = document.createElement('dialog');
        this.dialog.className = 'paper-dialog room-dialog';
        this.dialog.innerHTML = `<div class="dialog-top"><span class="eyebrow">A TABLE FOR FRIENDS</span><button data-room-close aria-label="关闭">×</button></div>
            <h2>留个座位，一起拼。</h2><p>邀请三位朋友，围坐在同一张手作桌。</p>
            <div id="room-offline-fields"><label>你的名字<input id="room-nickname" maxlength="24" value="手作朋友" autocomplete="nickname"></label>
            <label>小店名字<input id="room-name" maxlength="40" value="我们的手作小店"></label>
            <button id="create-room" class="primary-button">开一间小店</button>
            <div class="room-divider">或加入朋友的小店</div><label>邀请链接或房间编号<input id="room-code" placeholder="粘贴朋友的邀请链接" autocomplete="off"></label>
            <button id="join-room" class="primary-button">去朋友的小店</button></div>
            <div id="room-online-fields" hidden><label>邀请朋友<input id="room-invite" readonly></label>
            <div class="room-dialog-actions"><button id="copy-room" class="primary-button">复制邀请链接</button><button id="guest-room" class="text-button">新玩家打开测试</button></div>
            <p id="room-connection" role="status"></p><button id="show-room-drafts" class="text-button">找回之前的房间草稿</button><div id="room-drafts"></div>
            <button id="leave-room" class="primary-button">离开小店，回到单机</button></div><p id="room-error" role="alert"></p>`;
        root.querySelector('.atelier')!.append(this.dialog);
        this.button.addEventListener('click', () => this.open());
        this.dialog.querySelector('[data-room-close]')!.addEventListener('click', () => this.dialog.close());
        this.bind('create-room', async () => { await actions.create(this.value('room-nickname'), this.value('room-name')); this.dialog.close(); });
        this.bind('join-room', async () =>
        {
            let id = this.value('room-code');
            try { id = new URL(id).searchParams.get('room') ?? id; } catch { /* Plain room ID. */ }
            if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { throw new Error('请粘贴有效的邀请链接或房间编号。'); }
            await actions.join(this.value('room-nickname'), id);
            this.dialog.close();
        });
        this.bind('leave-room', async () => { await actions.leave(); this.dialog.close(); });
        this.bind('copy-room', async () =>
        {
            await navigator.clipboard.writeText(this.value('room-invite'));
            actions.notify('邀请链接已复制，发给朋友就可以一起拼豆。');
        });
        this.bind('guest-room', async () =>
        {
            const url = new URL(this.value('room-invite'));
            url.searchParams.set('guest', 'new');
            window.open(url, '_blank', 'noopener');
        });
        this.bind('show-room-drafts', async () =>
        {
            if (this.online === null) { return; }
            const drafts = await this.online.client.drafts();
            const list = this.dialog.querySelector('#room-drafts')!;
            list.replaceChildren();
            if (drafts.length === 0) { list.textContent = '还没有历史草稿。'; }
            for (const draft of drafts)
            {
                const button = document.createElement('button');
                button.className = 'text-button';
                button.textContent = `${draft.name} · ${draft.placedCells} 颗 · 恢复`;
                button.addEventListener('click', () => { this.online?.resumeDraft(draft); this.dialog.close(); });
                list.append(button);
            }
        });
        this.strip.querySelector('#vote-yes')!.addEventListener('click', () => this.online?.vote(true));
        this.strip.querySelector('#vote-no')!.addEventListener('click', () => this.online?.vote(false));
    }

    public open(roomId?: string): void
    {
        this.actions.interrupt();
        if (roomId !== undefined) { this.dialog.querySelector<HTMLInputElement>('#room-code')!.value = roomId; }
        this.dialog.showModal();
    }

    public update(online: OnlineWorkshopApplication | null): void
    {
        this.online = online;
        this.strip.hidden = online === null;
        this.dialog.querySelector<HTMLElement>('#room-offline-fields')!.hidden = online !== null;
        this.dialog.querySelector<HTMLElement>('#room-online-fields')!.hidden = online === null;
        this.button.textContent = online === null ? '一起拼豆' : '我的小店';
        if (online === null) { this.signature = ''; return; }
        const room = online.room;
        const status = !online.client.ready ? '连接中断，正在重连…' : online.pendingCount > 0 ? `正在同步 ${online.pendingCount} 个操作…` : '伙伴在线，作品已保存';
        this.dialog.querySelector('#room-connection')!.textContent = status;
        this.strip.querySelector('.room-caption')!.textContent = `${room.name} · ${room.players.filter((p) => p.connected).length}/4 人`;
        const signature = JSON.stringify([room.players.map((p) => [p.playerId, p.nickname, p.connected, p.seat]), room.hostId, room.proposal, online.client.ready]);
        if (signature === this.signature) { return; }
        this.signature = signature;
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', room.roomId);
        this.dialog.querySelector<HTMLInputElement>('#room-invite')!.value = url.href;
        const players = this.strip.querySelector('.room-players')!;
        players.replaceChildren();
        room.players.forEach((player, index) =>
        {
            const badge = document.createElement('span');
            badge.style.setProperty('--player-color', ['#b88270', '#789b8e', '#b29bcb', '#c5a65d'][index % 4]);
            badge.textContent = `${player.nickname}${player.playerId === online.client.session?.playerId ? '（我）' : ''}${!player.connected ? ' · 暂离' : player.seat === null ? ' · 走动中' : ' · 制作中'}`;
            players.append(badge);
        });
        const proposal = this.strip.querySelector<HTMLElement>('.room-proposal')!;
        proposal.hidden = room.proposal === null;
        if (room.proposal !== null)
        {
            proposal.querySelector('p')!.textContent = `房主邀请大家${room.proposal.draftId ? '恢复草稿' : '开始新作品'} · ${room.proposal.approvals.length}/${room.proposal.voters.length} 已同意`;
            (proposal.querySelector('#vote-yes') as HTMLButtonElement).disabled = room.proposal.approvals.includes(online.client.session!.playerId);
        }
    }

    public dispose(): void { this.dialog.close(); this.dialog.remove(); this.strip.remove(); this.button.remove(); }
    private value(id: string): string { return this.dialog.querySelector<HTMLInputElement>(`#${id}`)!.value.trim(); }
    private bind(id: string, action: () => Promise<void>): void
    {
        this.dialog.querySelector(`#${id}`)!.addEventListener('click', () =>
        {
            const buttons = [...this.dialog.querySelectorAll<HTMLButtonElement>('button')];
            buttons.forEach((button) => { button.disabled = true; });
            this.dialog.querySelector('#room-error')!.textContent = '';
            void action().catch((error: Error) =>
            {
                const messages: Record<string, string> = { 'websocket error': '没有连上联机服务，请先启动本地后端。',
                    'room-full': '这间小店已经坐满四位朋友了。', 'room-not-found': '没有找到这间小店，请检查邀请链接。',
                    'pending-operations': '还有操作尚未确认，请等待重连后再离开。', 'ack-timeout': '连接暂时没有回应，请重试。' };
                this.dialog.querySelector('#room-error')!.textContent = messages[error.message] ?? error.message;
            }).finally(() => buttons.forEach((button) => { button.disabled = false; }));
        });
    }
}
