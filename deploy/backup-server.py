#!/usr/bin/env python3
import datetime
import pathlib
import sqlite3

root = pathlib.Path('/var/lib/fuse-beads-ms')
database = root / 'multiplayer.sqlite'
if database.exists():
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    target = root / 'backups' / f'multiplayer-{timestamp}.sqlite'
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as source:
        with sqlite3.connect(target) as backup:
            source.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    for old in sorted(target.parent.glob('multiplayer-*.sqlite'), reverse=True)[48:]:
        old.unlink()
    print(f'Backup verified: {target.name}')
