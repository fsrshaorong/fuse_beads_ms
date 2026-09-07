import { createRequire } from 'node:module';
import type { DesktopInfo } from '../src/Platform/DesktopBridge';

export function initializeSteam(appId: number | null, overlayRequested: boolean)
{
    const status: DesktopInfo['steam'] = { state: 'disabled', appId, overlayRequested };
    let profile: string | null = null;
    if (appId === null) { return { status, profile }; }
    try
    {
        const steamworks = createRequire(import.meta.url)('steamworks.js') as typeof import('steamworks.js');
        if (overlayRequested) { steamworks.electronEnableSteamOverlay(true); }
        const client = steamworks.init(appId);
        profile = `steam-${String(client.localplayer.getSteamId().steamId64)}`;
        status.state = 'ready';
    }
    catch { status.state = 'unavailable'; }
    return { status, profile };
}
