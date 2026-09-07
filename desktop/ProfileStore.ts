import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkshopApplication } from '../src/App/WorkshopApplication';

const SESSION_KEYS = new Set(['fuse-beads.online-session.v1', 'fuse-beads.online-outbox.v1']);

export class ProfileStore
{
    private pending: Promise<void> = Promise.resolve();
    public constructor(private readonly directory: string) {}

    public async readSave(): Promise<string | null>
    {
        const value = await this.read('workshop.json');
        if (value !== null) { validateSave(value); }
        return value;
    }

    public writeSave(value: unknown): Promise<void>
    {
        validateSave(value);
        return this.enqueue(async () =>
        {
            // Never replace an unreadable existing save or its backup with a fresh empty game.
            const previous = await this.readSave();
            if (previous !== null) { await copyFile(join(this.directory, 'workshop.json'), join(this.directory, 'workshop.backup.json')); }
            await this.write('workshop.json', value);
        });
    }

    public async readSession(): Promise<Record<string, string>>
    {
        const value = await this.read('session.json');
        if (value === null) { return {}; }
        return validateSession(JSON.parse(value));
    }

    public writeSession(value: unknown): Promise<void>
    {
        const serialized = JSON.stringify(validateSession(value));
        return this.enqueue(() => this.write('session.json', serialized));
    }

    public flush(): Promise<void> { return this.pending; }

    private enqueue(action: () => Promise<void>): Promise<void>
    {
        this.pending = this.pending.catch(() => {}).then(action);
        return this.pending;
    }

    private async read(name: string): Promise<string | null>
    {
        try { return await readFile(join(this.directory, name), 'utf8'); }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return null; }
            throw error;
        }
    }

    private async write(name: string, value: string): Promise<void>
    {
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `${name}.tmp`);
        const file = await open(temporary, 'w', 0o600);
        try { await file.writeFile(value, 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, join(this.directory, name));
    }
}

function validateSave(value: unknown): asserts value is string
{
    if (typeof value !== 'string' || Buffer.byteLength(value) > 8 * 1024 * 1024
        || !new WorkshopApplication().dispatch({ type: 'restore', serialized: value }).accepted)
    {
        throw new Error('invalid-workshop-save');
    }
}

function validateSession(value: unknown): Record<string, string>
{
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { throw new Error('invalid-session'); }
    for (const [key, entry] of Object.entries(value))
    {
        if (!SESSION_KEYS.has(key) || typeof entry !== 'string' || Buffer.byteLength(entry) > 8 * 1024 * 1024)
        {
            throw new Error('invalid-session');
        }
    }
    return value as Record<string, string>;
}
