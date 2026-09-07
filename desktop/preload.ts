import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/Platform/DesktopBridge';

let closeHandler: (() => Promise<void>) | undefined;
ipcRenderer.on('desktop:before-close', () =>
{
    void Promise.resolve().then(() => closeHandler?.()).then(() => ipcRenderer.send('desktop:close-ready'))
        .catch(() => ipcRenderer.send('desktop:close-failed'));
});

const bridge: DesktopBridge = {
    info: async () => ({ ...await ipcRenderer.invoke('desktop:info'),
        renderer: { sandboxed: process.sandboxed === true, contextIsolated: process.contextIsolated } }),
    readSave: () => ipcRenderer.invoke('desktop:read-save'),
    writeSave: (value) => ipcRenderer.invoke('desktop:write-save', value),
    readSession: () => ipcRenderer.invoke('desktop:read-session'),
    writeSession: (value) => ipcRenderer.invoke('desktop:write-session', value),
    openGuest: (roomId) => ipcRenderer.invoke('desktop:open-guest', roomId),
    onBeforeClose: (handler) =>
    {
        closeHandler = handler;
        return () => { if (closeHandler === handler) { closeHandler = undefined; } };
    }
};
contextBridge.exposeInMainWorld('atelierDesktop', bridge);
