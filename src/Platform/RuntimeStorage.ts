import type { DesktopBridge } from './DesktopBridge';

/** Browser tabs retain their existing storage; desktop profiles persist a separate session file. */
export class RuntimeStorage
{
    private values: Record<string, string> = {};
    private pending: Promise<void> = Promise.resolve();
    public readable = true;
    public constructor(private readonly desktop?: DesktopBridge) {}

    public async initialize(): Promise<void>
    {
        if (this.desktop !== undefined)
        {
            try { this.values = await this.desktop.readSession(); }
            catch { this.readable = false; }
        }
    }

    public getItem(key: string): string | null
    {
        this.requireReadable();
        return this.desktop === undefined ? sessionStorage.getItem(key) : this.values[key] ?? null;
    }

    public setItem(key: string, value: string): void
    {
        this.requireReadable();
        if (this.desktop === undefined) { sessionStorage.setItem(key, value); return; }
        this.values[key] = value;
        this.schedule();
    }

    public removeItem(key: string): void
    {
        this.requireReadable();
        if (this.desktop === undefined) { sessionStorage.removeItem(key); return; }
        delete this.values[key];
        this.schedule();
    }

    public async flush(): Promise<void> { await this.pending; }

    public onError: () => void = () => {};
    private requireReadable(): void
    {
        if (!this.readable) { throw new Error('Existing session file could not be read; it remains untouched'); }
    }
    private schedule(): void
    {
        const values = { ...this.values };
        this.pending = this.pending.catch(() => {}).then(() => this.desktop!.writeSession(values));
        void this.pending.catch(() => this.onError());
    }
}
