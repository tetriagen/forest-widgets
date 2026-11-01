#!/usr/bin/env python3
"""Install, disable, or restore Forest Widgets in a Cinnamon desktop session."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
UUIDS = ('forest-resources@local', 'forest-player@local')
HOME = Path.home()
DEST = HOME / '.local/share/cinnamon/desklets'
STATE = HOME / '.local/share/forest-widgets-installer/backups'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--check', action='store_true', help='Check dependencies without changing anything')
    actions.add_argument('--disable', action='store_true', help='Disable both widgets; keep files and settings')
    actions.add_argument('--restore', type=Path, metavar='BACKUP', help='Restore a backup folder printed during installation')
    parser.add_argument('--no-font', action='store_true', help='Skip installing the bundled Monocraft font')
    args = parser.parse_args()
    if 'cinnamon' not in os.environ.get('XDG_CURRENT_DESKTOP', '').lower():
        raise RuntimeError('Run this command in a terminal inside your Cinnamon desktop session.')
    import gi
    gi.require_version('Gdk', '3.0')
    gi.require_version('Soup', '3.0')
    gi.require_version('GdkPixbuf', '2.0')
    from gi.repository import Gdk, Gio, GLib, GdkPixbuf, Soup  # noqa: F401
    settings = Gio.Settings.new('org.cinnamon')
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    for key in ('enabled-desklets', 'next-desklet-id'):
        if not settings.is_writable(key):
            raise RuntimeError('This desktop setting is locked: ' + key)
    display = Gdk.Display.get_default()
    if display is None:
        raise RuntimeError('No graphical session is available.')
    if args.check:
        for uuid in UUIDS:
            for name in ('desklet.js', 'metadata.json', 'settings-schema.json', 'stylesheet.css'):
                if not (ROOT / 'desklets' / uuid / name).is_file():
                    raise RuntimeError('Missing project file: ' + uuid + '/' + name)
        print('Cinnamon session, GTK/GdkPixbuf, Soup 3 and widget files: OK')
        print('Optional NVIDIA sensor: ' + ('available' if shutil.which('nvidia-smi') else 'not installed'))
        return

    def reload_widget(uuid):
        bus.call_sync('org.Cinnamon', '/org/Cinnamon', 'org.Cinnamon', 'ReloadXlet',
                      GLib.Variant('(ss)', (uuid, 'DESKLET')), None, Gio.DBusCallFlags.NONE, 5000, None)

    if args.disable:
        settings.set_strv('enabled-desklets', [x for x in settings.get_strv('enabled-desklets') if x.split(':')[0] not in UUIDS])
        Gio.Settings.sync()
        print('Widgets disabled. Source files, preferences and fonts were kept.')
        return
    if args.restore:
        backup = args.restore.expanduser().resolve()
        saved = json.loads((backup / 'state.json').read_text())
        active = [x for x in settings.get_strv('enabled-desklets') if x.split(':')[0] not in UUIDS]
        for uuid in UUIDS:
            target = DEST / uuid
            old = backup / uuid
            if old.is_dir():
                if target.exists():
                    displaced = backup / (uuid + '.displaced')
                    if displaced.exists():
                        raise RuntimeError('Restore was already used: ' + str(displaced))
                    shutil.move(target, displaced)
                shutil.copytree(old, target)
            active.extend(x for x in saved['enabled-desklets'] if x.startswith(uuid + ':'))
        settings.set_strv('enabled-desklets', active)
        Gio.Settings.sync()
        for uuid in UUIDS:
            if any(x.startswith(uuid + ':') for x in active):
                reload_widget(uuid)
        print('Saved widget files and positions restored. Unrelated desklets were preserved.')
        return

    existing = settings.get_strv('enabled-desklets')
    backup = STATE / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    (backup / 'state.json').write_text(json.dumps({'enabled-desklets': existing}, indent=2))
    for uuid in UUIDS:
        target = DEST / uuid
        if target.exists():
            shutil.copytree(target, backup / uuid)
        target.mkdir(parents=True, exist_ok=True)
        for source in (ROOT / 'desklets' / uuid).iterdir():
            if source.is_file():
                shutil.copyfile(source, target / source.name)
    if not args.no_font:
        fonts = HOME / '.local/share/fonts'
        fonts.mkdir(parents=True, exist_ok=True)
        target_font = fonts / 'Monocraft-Forest.ttf'
        if not target_font.exists():
            shutil.copyfile(ROOT / 'fonts/Monocraft.ttf', target_font)
        if shutil.which('fc-cache'):
            subprocess.run(['fc-cache', str(fonts)], check=True)
    monitor = display.get_primary_monitor() or display.get_monitor(0)
    geometry = monitor.get_geometry()
    positions = ((geometry.x + max(16, geometry.width - 320), geometry.y + 60),
                 (geometry.x + max(16, geometry.width - 620), geometry.y + 60))
    next_id = settings.get_int('next-desklet-id')
    definitions = existing[:]
    for uuid, (x, y) in zip(UUIDS, positions):
        if any(entry.startswith(uuid + ':') for entry in existing):
            reload_widget(uuid)
        else:
            definitions.append(f'{uuid}:{next_id}:{x}:{y}')
            next_id += 1
    settings.set_int('next-desklet-id', next_id)
    settings.set_strv('enabled-desklets', definitions)
    Gio.Settings.sync()
    print('Forest Widgets installed. Right-click a widget → Configure.')
    print('Backup: ' + str(backup))
    print('Restore: python3 ' + str(ROOT / 'install.py') + ' --restore ' + str(backup))
    print('If Monocraft is missing on first use, log out and back in to refresh the desktop font cache.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.exit('Error: ' + str(exc))
