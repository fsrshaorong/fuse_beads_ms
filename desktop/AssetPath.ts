import { isAbsolute, relative, resolve } from 'node:path';

export function assetPath(root: string, requestUrl: string): string
{
    const url = new URL(requestUrl);
    if (url.protocol !== 'atelier:' || url.hostname !== 'game') { throw new Error('invalid-origin'); }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const child = relative(root, file);
    if (child.startsWith('..') || isAbsolute(child) || pathname.includes('\0')) { throw new Error('invalid-asset-path'); }
    return file;
}
