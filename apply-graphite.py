#!/usr/bin/env python3
"""Apply the graphite desktop preset to installed Forest Widgets; keep a backup."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the preset; otherwise only check requirements')
    parser.add_argument('--wallpaper', type=Path, help='Optional downloaded wallpaper image')
    args = parser.parse_args()
    import gi
    gi.require_version('Gdk', '3.0')
    from gi.repository import Gio, GLib, Gdk
    home = Path.home()
    spice = home / '.config/cinnamon/spices'
    blur_uuid = 'BlurCinnamon@klangman'
    widget_ids = ['forest-player@local', 'forest-resources@local']
    paths = {uuid: spice / uuid / (uuid + '.json') for uuid in [*widget_ids, blur_uuid]}
    for path in paths.values():
        if not path.is_file():
            raise RuntimeError('First install/enable Forest Widgets and Blur Cinnamon: ' + str(path))
    data = {uuid: json.loads(path.read_text()) for uuid, path in paths.items()}
    if 'liquid-glass-strength' not in data[blur_uuid]:
        raise RuntimeError('Update Blur Cinnamon to 2.7.1 or newer, then enable it once.')
    if args.wallpaper and not args.wallpaper.expanduser().is_file():
        raise RuntimeError('Wallpaper file does not exist')
    if not args.apply:
        print('Ready: Forest Widgets and Liquid Glass settings are available. Use --apply to change the desktop.')
        return
    settings = Gio.Settings.new('org.cinnamon')
    background = Gio.Settings.new('org.cinnamon.desktop.background')
    backup = home / '.local/share/forest-widgets-look-backups' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True)
    for uuid, path in paths.items():
        shutil.copyfile(path, backup / (uuid + '.json'))
    (backup / 'desktop.json').write_text(json.dumps({
        'picture-uri': background.get_string('picture-uri'),
        'picture-options': background.get_string('picture-options'),
        'enabled-desklets': settings.get_strv('enabled-desklets'),
        'enabled-extensions': settings.get_strv('enabled-extensions'),
    }, indent=2))
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    def reload(uuid, kind):
        bus.call_sync('org.Cinnamon', '/org/Cinnamon', 'org.Cinnamon', 'ReloadXlet',
                      GLib.Variant('(ss)', (uuid, kind)), None, Gio.DBusCallFlags.NONE, 5000, None)
    def save(uuid):
        paths[uuid].write_text(json.dumps(data[uuid], ensure_ascii=False, indent=2))
    for uuid in widget_ids:
        data[uuid]['font-family']['value'] = 'manrope'
    data[widget_ids[1]]['glass-panels']['value'] = False
    player = data[widget_ids[0]]
    for key, value in {'appearance': 'radial', 'dock-side': 'right', 'show-album': False, 'compact': False, 'size-percent': 100}.items():
        player[key]['value'] = value
    for uuid in widget_ids:
        save(uuid)
        reload(uuid, 'DESKLET')
    time.sleep(0.3)
    # Reloading a desklet can reset its per-instance extension entry. Configure glass last.
    blur = json.loads(paths[blur_uuid].read_text())
    data[blur_uuid] = blur
    for key, value in {'enable-desklet-effects': True, 'enable-desklets-override': True,
                       'enable-desklets-unique-settings': True, 'desklets-auto': False,
                       'liquid-glass-strength': 0.48, 'liquid-glass-edge-size': 25,
                       'liquid-glass-gloss': 0.5, 'liquid-glass-rgb-fringing': 0,
                       'liquid-glass-shadow': 0.22}.items():
        blur[key]['value'] = value
    active = settings.get_strv('enabled-desklets')
    entries = [e for e in blur['desklets-list']['value'] if e.get('uuid') not in widget_ids]
    for definition in active:
        uuid, instance, *_ = definition.split(':')
        if uuid not in widget_ids:
            continue
        entries.append({'enabled': False, 'name': uuid, 'uuid': uuid,
                        'instance': instance, 'override': True, 'opacity': 20, 'color': 'rgb(24,26,30)',
                        'blurtype': 9, 'radius': 12, 'saturation': 0})
    blur['desklets-list']['value'] = entries
    save(blur_uuid)
    extensions = settings.get_strv('enabled-extensions')
    if blur_uuid not in extensions:
        settings.set_strv('enabled-extensions', extensions + [blur_uuid])
    else:
        reload(blur_uuid, 'EXTENSION')
    display = Gdk.Display.get_default()
    monitor = display.get_primary_monitor() or display.get_monitor(0)
    geom = monitor.get_geometry()
    positions = {'forest-player@local': (geom.x + geom.width - 380, geom.y + max(48, geom.height - 428)),
                 'forest-resources@local': (geom.x + 32, geom.y + max(48, geom.height - 470))}
    adjusted = []
    for definition in active:
        uuid, instance, *_ = definition.split(':')
        if uuid in positions:
            x, y = positions[uuid]
            definition = f'{uuid}:{instance}:{x}:{y}'
        adjusted.append(definition)
    settings.set_strv('enabled-desklets', adjusted)
    if args.wallpaper:
        target = home / '.local/share/backgrounds/forest-graphite-wallpaper' / args.wallpaper.name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.resolve() != args.wallpaper.expanduser().resolve():
            shutil.copyfile(args.wallpaper.expanduser(), target)
        background.set_string('picture-uri', target.as_uri())
        background.set_string('picture-options', 'zoom')
    Gio.Settings.sync()
    print('Applied: right-edge monochrome player and resources without background panels.')
    print('Settings backup: ' + str(backup))


if __name__ == '__main__':
    main()
