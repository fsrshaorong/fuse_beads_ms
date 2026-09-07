export interface DesktopInfo
{
    version: string;
    multiplayerUrl: string;
    renderer: { sandboxed: boolean; contextIsolated: boolean };
    steam: { state: 'disabled' | 'ready' | 'unavailable'; appId: number | null; overlayRequested: boolean };
}

export interface DesktopBridge
{
    info(): Promise<DesktopInfo>;
    readSave(): Promise<string | null>;
    writeSave(serialized: string): Promise<void>;
    readSession(): Promise<Record<string, string>>;
    writeSession(values: Record<string, string>): Promise<void>;
    openGuest(roomId: string): Promise<void>;
    onBeforeClose(handler: () => Promise<void>): () => void;
}

declare global
{
    interface Window { atelierDesktop?: DesktopBridge }
}
