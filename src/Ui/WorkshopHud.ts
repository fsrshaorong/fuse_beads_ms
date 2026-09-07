import type { WorkshopCommand, WorkshopReadModel } from '../App/WorkshopApplication';
import { getBeadColor, getBeadColorName } from '../Rendering/BeadPalette';
import { DEFAULT_PAINTERLY_PROFILE } from '../Rendering/PainterlyMaterials';
import type { PainterlyProfile } from '../Rendering/PainterlyMaterials';

interface HudActions
{
    readonly dispatch: (command: WorkshopCommand) => void;
    readonly interrupt: () => void;
    readonly style: (profile: Partial<PainterlyProfile>) => void;
}

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

/** Small paper-like HTML interface; all craft actions dispatch the same application commands as CLI. */
export class WorkshopHud
{
    public readonly canvas: HTMLCanvasElement;
    private readonly root: HTMLElement;
    private readonly palette: HTMLElement;
    private readonly primary: HTMLButtonElement;
    private readonly patternDialog: HTMLDialogElement;
    private readonly settingsDialog: HTMLDialogElement;
    private readonly collectionDialog: HTMLDialogElement;
    private readonly resetDialog: HTMLDialogElement;
    private lastPattern = '';
    private toastTimer = 0;
    private lastModel: WorkshopReadModel | null = null;

    public constructor(container: HTMLElement, private readonly actions: HudActions)
    {
        container.innerHTML = `
            <main class="atelier" data-mode="workshop">
                <canvas class="world-canvas" aria-label="三维拼豆工作室，可使用 WASD 移动，E 坐下" tabindex="0"></canvas>
                <div class="scene-vignette" aria-hidden="true"></div>
                <header class="masthead">
                    <a class="brand" href="#" aria-label="豆间工作室">
                        <span class="bead-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                        <span><strong>豆间</strong><small>A LITTLE BEAD ATELIER</small></span>
                    </a>
                    <div class="header-actions"><span class="save-status"><i></i><span id="save-label">保存在这台设备</span></span>
                        <button class="icon-button" id="collection-button" aria-label="我的作品" title="我的作品"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5h16v15H4zM8 3v4m8-4v4M4 10h16m-12 4h3v3H8z"/></svg></button>
                        <button class="icon-button" id="settings-button" aria-label="美术调色" title="美术调色"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 4v16m7-16v16m7-16v16M2 9h6m1 7h6m1-9h6"/></svg></button>
                    </div>
                </header>
                <nav class="view-levels" aria-label="当前视角"><span data-level="workshop">01 · 工作室</span><i></i><span data-level="tabletop">02 · 手作桌</span><i></i><span data-level="beadwork">03 · 拼豆时光</span></nav>
                <section class="welcome"><span class="eyebrow">留一点时间，给喜欢的小事</span><h1>一颗一颗，<br>拼出好心情。</h1><p>窗边有光，桌上有颜色。<br>今天，做一件只属于你的小小收藏。</p><span class="handwritten">make something little.</span></section>
                <aside class="craft-card" aria-label="当前作品">
                    <div class="card-heading"><span class="eyebrow">TODAY’S LITTLE PROJECT</span><button id="pattern-button" class="text-button">换个图案 ${ARROW}</button></div>
                    <div class="project-row"><canvas id="pattern-preview" width="128" height="128" aria-label="目标图案预览"></canvas><div><h2 id="pattern-title"></h2><p id="pattern-meta"></p><span id="stage-label" class="stage-label">慢慢填满喜欢的颜色</span></div></div>
                    <div class="progress-caption"><span id="progress-caption">制作进度</span><span id="progress-number">0%</span></div>
                    <div class="progress-track"><span id="progress-fill"></span></div>
                    <div class="palette-heading"><span>挑一颗颜色</span><small>数字键快速切换</small></div>
                    <div class="palette" role="group" aria-label="选择拼豆颜色"></div>
                    <p class="craft-note" id="craft-note">对照数字，点击或按住拖动放豆。</p>
                    <button class="iron-button" id="iron-button" hidden>开始熨烫 ${ARROW}</button>
                </aside>
                <div class="tool-dock" aria-label="拼豆工具">
                    <button id="place-button" class="tool-button selected" aria-label="放豆工具"><span>◉</span>放豆<kbd>B</kbd></button>
                    <button id="erase-button" class="tool-button" aria-label="橡皮擦"><span>◇</span>擦除<kbd>X</kbd></button>
                    <i></i><button id="undo-button" class="tool-button" aria-label="撤销"><span>↶</span>撤销</button>
                    <button id="redo-button" class="tool-button" aria-label="重做"><span>↷</span>重做</button>
                    <i></i><button id="reset-button" class="tool-button subtle" aria-label="重新制作">重新来过</button>
                </div>
                <footer class="bottom-bar"><div class="context-hint"><span class="context-dot"></span><div><strong id="context-title">窗边的工作台空着呢</strong><p id="context-instructions">WASD 走动 · 右键拖动观察 · 滚轮调整远近</p></div></div><button class="primary-button" id="primary-button">坐到工作台 <kbd>E</kbd> ${ARROW}</button></footer>
                <div class="toast" role="status" aria-live="polite"></div>
                <div class="loading-screen"><span class="bead-mark"><i></i><i></i><i></i><i></i></span><p>正在整理你的手作桌…</p></div>
                <dialog class="paper-dialog pattern-dialog"><div class="dialog-top"><span class="eyebrow">A SMALL COLLECTION OF IDEAS</span><button data-close aria-label="关闭">×</button></div><h2>今天，想拼点什么？</h2><p>每张图案都会保留自己的制作进度。</p><div id="pattern-grid" class="pattern-grid"></div></dialog>
                <dialog class="paper-dialog settings-dialog"><div class="dialog-top"><span class="eyebrow">LIGHT & COLOR</span><button data-close aria-label="关闭">×</button></div><h2>柔光玩具房 · 静态笔触</h2><p>默认使用参考页面的光影与笔触参数。</p><label>笔触浓度 <input id="brush-control" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>暖光染色 <input id="warmth-control" type="range" min="0" max="1" step="0.01" value="1"></label><label>阴影层次 <input id="shadow-control" type="range" min="0" max="1" step="0.01" value="0.92"></label><button id="restore-style" class="primary-button">恢复参考效果</button><p class="dialog-footnote">模型与笔触均无抖动，镜头与手作操作保持流畅。</p></dialog>
                <dialog class="paper-dialog collection-dialog"><div class="dialog-top"><span class="eyebrow">MADE BY YOU</span><button data-close aria-label="关闭">×</button></div><h2>小小的成品收藏</h2><div id="collection-grid" class="pattern-grid"></div><p id="collection-empty">拼好第一件作品，再轻轻熨烫，把今天的好心情收在这里。</p></dialog>
                <dialog class="paper-dialog reset-dialog"><div class="dialog-top"><span class="eyebrow">A FRESH START</span><button data-close aria-label="关闭">×</button></div><h2>重新制作这张图案？</h2><p>当前图案的拼豆和熨烫进度会清空，已经收藏的成品仍然保留。</p><button id="confirm-reset" class="primary-button">清空并重新制作</button></dialog>
            </main>`;
        this.root = this.require('.atelier');
        this.canvas = this.require<HTMLCanvasElement>('.world-canvas');
        this.palette = this.require('.palette');
        this.primary = this.require<HTMLButtonElement>('#primary-button');
        this.patternDialog = this.require<HTMLDialogElement>('.pattern-dialog');
        this.settingsDialog = this.require<HTMLDialogElement>('.settings-dialog');
        this.collectionDialog = this.require<HTMLDialogElement>('.collection-dialog');
        this.resetDialog = this.require<HTMLDialogElement>('.reset-dialog');
        this.require<HTMLInputElement>('#brush-control').value = String(DEFAULT_PAINTERLY_PROFILE.brushStrength);
        this.require<HTMLInputElement>('#warmth-control').value = String(DEFAULT_PAINTERLY_PROFILE.warmth);
        this.require<HTMLInputElement>('#shadow-control').value = String(DEFAULT_PAINTERLY_PROFILE.shadowStrength);
        this.bind();
    }

    public get modalOpen(): boolean
    {
        return this.patternDialog.open || this.settingsDialog.open || this.collectionDialog.open || this.resetDialog.open;
    }

    /** Projects immutable craft state; avoids rebuilding the palette while a pointer is active. */
    public update(model: WorkshopReadModel, canSit: boolean): void
    {
        this.lastModel = model;
        const mode = model.mode === 'transition' ? model.transition?.to ?? 'workshop' : model.mode;
        this.root.dataset.mode = mode;
        this.root.dataset.transition = String(model.mode === 'transition');
        this.require('.craft-card').inert = mode === 'workshop';
        this.require('.tool-dock').inert = mode !== 'beadwork';

        for (const label of this.root.querySelectorAll<HTMLElement>('[data-level]'))
        {
            label.classList.toggle('active', label.dataset.level === mode);
        }

        if (model.pattern.patternId !== this.lastPattern)
        {
            this.lastPattern = model.pattern.patternId;
            this.text('#pattern-title', model.pattern.name);
            this.text('#pattern-meta', `${model.pattern.width} × ${model.pattern.height} · ${model.pattern.palette.length} 种颜色`);
            this.drawPattern(this.require<HTMLCanvasElement>('#pattern-preview'), model.pattern, model.pattern.targetNumbers);
            this.palette.replaceChildren();

            for (const entry of model.pattern.palette)
            {
                const button = document.createElement('button');
                button.className = 'color-button';
                button.dataset.color = String(entry.number);
                button.setAttribute('aria-label', `${entry.number} ${getBeadColorName(entry.colorId)}`);
                button.style.setProperty('--bead-color', getBeadColor(entry.colorId));
                button.innerHTML = `<span class="color-bead"></span><span class="color-name"></span><span class="color-count"></span><kbd>${entry.number}</kbd>`;
                button.querySelector('.color-name')!.textContent = getBeadColorName(entry.colorId);
                button.addEventListener('click', () => this.actions.dispatch({ type: 'selectColor', colorNumber: entry.number }));
                this.palette.append(button);
            }
        }

        for (const button of this.palette.querySelectorAll<HTMLButtonElement>('[data-color]'))
        {
            const number = Number(button.dataset.color);
            button.classList.toggle('selected', number === model.selectedColor);
            button.setAttribute('aria-pressed', String(number === model.selectedColor));
            button.querySelector('.color-count')!.textContent = `${model.board.remainingCellCounts[number - 1]} 颗待放`;
            button.disabled = model.stage === 'ironing' || model.stage === 'finished' || model.mode === 'transition';
        }

        const ironing = model.stage === 'ironing';
        const ratio = ironing ? model.ironProgress : model.board.progressRatio;
        this.text('#progress-caption', ironing ? '熨烫覆盖' : `${model.board.correctCellCount} / ${model.board.targetCellCount} 颗`);
        this.text('#progress-number', `${Math.round(ratio * 100)}%`);
        this.require('#progress-fill').style.width = `${ratio * 100}%`;
        this.text('#stage-label', model.stage === 'finished' ? '已经收进你的作品集' : '慢慢填满喜欢的颜色');
        this.text('#craft-note', craftNote(model));
        const ironButton = this.require<HTMLButtonElement>('#iron-button');
        ironButton.hidden = model.stage !== 'ready' && model.stage !== 'ironing';
        ironButton.textContent = ironing ? '先放下熨斗' : '开始熨烫 →';
        ironButton.disabled = model.mode !== 'beadwork';
        this.require<HTMLButtonElement>('#undo-button').disabled = !model.canUndo || model.mode !== 'beadwork';
        this.require<HTMLButtonElement>('#redo-button').disabled = !model.canRedo || model.mode !== 'beadwork';
        this.require('#place-button').classList.toggle('selected', model.tool === 'place');
        this.require('#erase-button').classList.toggle('selected', model.tool === 'erase');
        this.primary.disabled = model.mode === 'transition';

        if (mode === 'workshop')
        {
            this.primary.innerHTML = `坐到工作台 <kbd>E</kbd> ${ARROW}`;
            this.primary.disabled ||= !canSit;
            this.text('#context-title', canSit ? '窗边的工作台空着呢' : '走近窗边的工作台');
            this.text('#context-instructions', 'WASD 走动 · 右键拖动观察 · 滚轮调整远近');
        }
        else if (mode === 'tabletop')
        {
            this.primary.innerHTML = `开始拼豆 ${ARROW}`;
            this.text('#context-title', '你的手作时光，从这里开始');
            this.text('#context-instructions', '点击棋盘或向前滚轮进入 · E 起身回工作室');
        }
        else
        {
            this.primary.innerHTML = `回到桌边 <span>↗</span>`;
            let title = '不着急，一颗一颗来';

            if (ironing)
            {
                title = '让每一颗豆子，轻轻连在一起';
            }
            else if (model.stage === 'finished')
            {
                title = '做得真好，收下这一刻';
            }

            this.text('#context-title', title);
            this.text('#context-instructions', '滚轮缩放 · 空格拖动 / WASD 平移 · 拉远回桌边');
        }
    }

    /** Removes the loading veil only after assets and the first rendered frame are ready. */
    public ready(): void
    {
        this.require('.loading-screen').classList.add('loaded');
    }

    /** Gives a recoverable storage or command message without interrupting the drawing surface. */
    public notify(message: string): void
    {
        const toast = this.require('.toast');
        toast.textContent = message;
        toast.classList.add('visible');
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 4200);
    }

    public setSaveStatus(message: string): void
    {
        this.text('#save-label', message);
    }

    public fail(message: string): void
    {
        this.require('.loading-screen p').textContent = message;
    }

    /** Stops transient feedback before the root is replaced during local hot reload. */
    public dispose(): void
    {
        window.clearTimeout(this.toastTimer);

        for (const dialog of this.root.querySelectorAll<HTMLDialogElement>('dialog[open]'))
        {
            dialog.close();
        }
    }

    private bind(): void
    {
        this.primary.addEventListener('click', () =>
        {
            const mode = this.lastModel?.mode;
            if (mode === 'workshop')
            {
                this.actions.dispatch({ type: 'sit' });
            }
            else if (mode === 'tabletop')
            {
                this.actions.dispatch({ type: 'focus' });
            }
            else
            {
                this.actions.dispatch({ type: 'retreat' });
            }
        });
        this.require('#place-button').addEventListener('click', () => this.actions.dispatch({ type: 'selectTool', tool: 'place' }));
        this.require('#erase-button').addEventListener('click', () => this.actions.dispatch({ type: 'selectTool', tool: 'erase' }));
        this.require('#undo-button').addEventListener('click', () => this.actions.dispatch({ type: 'undo' }));
        this.require('#redo-button').addEventListener('click', () => this.actions.dispatch({ type: 'redo' }));
        this.require('#reset-button').addEventListener('click', () => this.open(this.resetDialog));
        this.require('#confirm-reset').addEventListener('click', () =>
        {
            this.actions.dispatch({ type: 'reset' });
            this.resetDialog.close();
        });
        this.require('#iron-button').addEventListener('click', () => this.actions.dispatch({ type: this.lastModel?.stage === 'ironing' ? 'cancelIroning' : 'startIroning' }));
        this.require('#settings-button').addEventListener('click', () => this.open(this.settingsDialog));
        this.require('#collection-button').addEventListener('click', () => this.showCollection());
        this.require('#pattern-button').addEventListener('click', () => this.showPatterns());
        this.require('.brand').addEventListener('click', (event) => event.preventDefault());

        for (const dialog of this.root.querySelectorAll<HTMLDialogElement>('dialog'))
        {
            dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
            dialog.addEventListener('click', (event) =>
            {
                if (event.target === dialog)
                {
                    const bounds = dialog.getBoundingClientRect();

                    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
                    {
                        dialog.close();
                    }
                }
            });
        }

        this.require<HTMLInputElement>('#brush-control').addEventListener('input', (event) =>
        {
            this.actions.style({ brushStrength: Number((event.target as HTMLInputElement).value) });
        });
        this.require<HTMLInputElement>('#warmth-control').addEventListener('input', (event) =>
        {
            this.actions.style({ warmth: Number((event.target as HTMLInputElement).value) });
        });
        this.require<HTMLInputElement>('#shadow-control').addEventListener('input', (event) =>
        {
            this.actions.style({ shadowStrength: Number((event.target as HTMLInputElement).value) });
        });
        this.require<HTMLButtonElement>('#restore-style').addEventListener('click', () =>
        {
            this.actions.style(DEFAULT_PAINTERLY_PROFILE);
            this.require<HTMLInputElement>('#brush-control').value = String(DEFAULT_PAINTERLY_PROFILE.brushStrength);
            this.require<HTMLInputElement>('#warmth-control').value = String(DEFAULT_PAINTERLY_PROFILE.warmth);
            this.require<HTMLInputElement>('#shadow-control').value = String(DEFAULT_PAINTERLY_PROFILE.shadowStrength);
        });
    }

    private showPatterns(): void
    {
        const model = this.lastModel;

        if (model === null)
        {
            return;
        }

        const grid = this.require('#pattern-grid');
        grid.replaceChildren();

        for (const pattern of model.patterns)
        {
            const button = document.createElement('button');
            button.className = 'pattern-option';
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            this.drawPattern(canvas, pattern, pattern.targetNumbers);
            const name = document.createElement('strong');
            name.textContent = pattern.name;
            const count = document.createElement('small');
            count.textContent = `${pattern.width} × ${pattern.height} · ${pattern.palette.length} 色`;
            button.append(canvas, name, count);
            button.addEventListener('click', () =>
            {
                this.actions.dispatch({ type: 'selectPattern', patternId: pattern.patternId });
                this.patternDialog.close();
            });
            grid.append(button);
        }

        this.open(this.patternDialog);
    }

    private showCollection(): void
    {
        const model = this.lastModel;
        const grid = this.require('#collection-grid');
        grid.replaceChildren();

        if (model !== null)
        {
            for (const artwork of model.finishedArtworks)
            {
                const pattern = model.patterns.find((entry) => entry.patternId === artwork.patternId);

                if (pattern === undefined)
                {
                    continue;
                }

                const item = document.createElement('article');
                item.className = 'pattern-option';
                const canvas = document.createElement('canvas');
                canvas.width = 128;
                canvas.height = 128;
                this.drawPattern(canvas, pattern, artwork.cells);
                const title = document.createElement('strong');
                title.textContent = artwork.name;
                item.append(canvas, title);
                grid.append(item);
            }
        }

        this.require('#collection-empty').hidden = (model?.finishedArtworks.length ?? 0) > 0;
        this.open(this.collectionDialog);
    }

    private drawPattern(canvas: HTMLCanvasElement, pattern: WorkshopReadModel['pattern'], cells: readonly number[]): void
    {
        const context = canvas.getContext('2d');

        if (context === null)
        {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        const step = canvas.width / Math.max(pattern.width + 2, pattern.height + 2);
        const offsetX = (canvas.width - pattern.width * step) / 2;
        const offsetY = (canvas.height - pattern.height * step) / 2;

        for (let index = 0; index < cells.length; index += 1)
        {
            const entry = pattern.palette[cells[index] - 1];

            if (entry !== undefined)
            {
                const x = offsetX + (index % pattern.width + 0.5) * step;
                const y = offsetY + (Math.floor(index / pattern.width) + 0.5) * step;
                context.fillStyle = getBeadColor(entry.colorId);
                context.beginPath();
                context.arc(x, y, step * 0.47, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = '#f8f2e6';
                context.beginPath();
                context.arc(x, y, step * 0.16, 0, Math.PI * 2);
                context.fill();
            }
        }
    }

    private open(dialog: HTMLDialogElement): void
    {
        this.actions.interrupt();
        dialog.showModal();
    }

    private text(selector: string, value: string): void
    {
        const element = this.require(selector);

        if (element.textContent !== value)
        {
            element.textContent = value;
        }
    }

    private require<T extends HTMLElement = HTMLElement>(selector: string): T
    {
        const element = document.querySelector<T>(selector);

        if (element === null)
        {
            throw new Error(`[WorkshopHud] Missing ${selector}`);
        }

        return element;
    }
}

function craftNote(model: WorkshopReadModel): string
{
    if (model.stage === 'ironing')
    {
        return '按住拖动熨斗，慢慢覆盖整幅图案。';
    }

    if (model.stage === 'ready')
    {
        return '每一颗都放对了，可以熨烫成品啦。';
    }

    if (model.stage === 'finished')
    {
        return '这份小小的耐心，已经变成收藏。';
    }

    if (model.board.errorCellCount > 0)
    {
        return `有 ${model.board.errorCellCount} 颗颜色不太对，覆盖或擦除就好。`;
    }

    return '对照数字，点击或按住拖动放豆。';
}
