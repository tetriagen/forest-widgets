const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gdk = imports.gi.Gdk;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;
const Tooltips = imports.ui.tooltips;
imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const Slider=imports.ui.slider;
const Settings=imports.ui.settings;
const PopupMenu=imports.ui.popupMenu;
const {AudioMonitor} = require('./spectrum');
const Cairo = imports.cairo;
const {fractionAt} = require('./arc-seek');
const MPRIS = 'org.mpris.MediaPlayer2.Player';
function read(path) {
    try { const [ok, bytes] = GLib.file_get_contents(path); return ok ? ByteArray.toString(bytes) : ''; }
    catch (_) { return ''; }
}
// A desklet is draggable too: never bubble slider presses to its DND handler.
class PlayerSlider extends Slider.Slider {
    _startDragging(actor,event) {
        if(event.get_button()!==1)return Clutter.EVENT_PROPAGATE;
        this.dragDevice=event.get_device();
        super._startDragging(actor,event);
        return Clutter.EVENT_STOP;
    }
    _endDragging(actor,event) {
        const result=super._endDragging(actor,event);
        this.dragDevice=null;
        return result;
    }
    cancelDrag() {
        if(!this._dragging)return;
        this.actor.disconnect(this._releaseId);
        this.actor.disconnect(this._motionId);
        if(this.dragDevice)this.dragDevice.ungrab();
        this.dragDevice=null;
        this._dragging=false;
    }
}
class ForestPlayer extends Desklet.Desklet {
    constructor(metadata,id){
        super(metadata,id);this.dead=false;this.signals=[];this.subscriptions=[];this.tips=[];
        this.player=null;this.playing=false;this.length=0;this.position=0;this.positionTick=0;this.volume=0.5;this.loop='None';
        this.cancel=new Gio.Cancellable();this.http=new Soup.Session({timeout:8});
        this.clearBackdrop();this.root=new St.BoxLayout({vertical:true,style_class:'fw-root'});
        this.music=new St.BoxLayout({vertical:true,style_class:'fw-music'});
        this.card=this.music;
        this.details=new St.BoxLayout({vertical:true,style_class:'fw-details',y_align:Clutter.ActorAlign.CENTER});
        const header=new St.BoxLayout({style_class:'fw-header'});
        this.source=new St.Button({label:'NOW PLAYING',style_class:'fw-source',x_expand:true,x_align:Clutter.ActorAlign.START});
        this.source.connect('clicked',()=>this.raisePlayer());header.add_child(this.source);
        const gear=new St.Button({label:'⚙',style_class:'fw-gear'});this.gear=gear;gear.connect('clicked',()=>this.configureDesklet());header.add_child(gear);this.details.add_child(header);
        const discBox=new St.Widget({style_class:'fw-disc-box',layout_manager:new Clutter.FixedLayout(),clip_to_allocation:true,reactive:true,can_focus:true,accessible_name:'Перемотка по дуге обложки',x_align:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.CENTER});
        this.disc=new Clutter.Actor({width:190,height:190,opacity:225});
        this.disc.set_pivot_point(0.5,0.5);
        this.canvas=new Clutter.Canvas(); this.canvas.set_size(190,190);
        this.canvas.connect('draw',(_,cr,w,h)=>this.drawRecord(cr,w,h));
        this.disc.set_content(this.canvas); this.canvas.invalidate();
        discBox.connect('button-press-event',(_,event)=>this.arcPress(event));
        discBox.connect('key-press-event',(_,event)=>{
            const key=event.get_key_symbol();
            if(this.appearance!=='radial'||![Clutter.KEY_Left,Clutter.KEY_Right].includes(key))return Clutter.EVENT_PROPAGATE;
            this.seekFraction((this.progress._value||0)+(key===Clutter.KEY_Right?0.05:-0.05));return Clutter.EVENT_STOP;
        });
        this.discBox=discBox;discBox.add_child(this.disc); this.music.add_child(discBox);
        this.title=new St.Label({text:'Музыка на паузе',style_class:'fw-title'});
        this.artist=new St.Label({text:'Открой Spotify или другой плеер',style_class:'fw-artist'});
        for (const label of [this.title,this.artist]) { label.clutter_text.ellipsize=Pango.EllipsizeMode.END; label.clutter_text.set_single_line_mode(true); this.details.add_child(label); }
        this.album=new St.Label({text:'',style_class:'fw-album'});this.album.clutter_text.ellipsize=Pango.EllipsizeMode.END;this.details.add_child(this.album);
        this.progress=new PlayerSlider(0);this.progress.actor.add_style_class_name('fw-slider');
        this.progress.connect('drag-end',()=>this.seekFraction(this.progress._value));
        this.details.add_child(this.progress.actor);
        const times=new St.BoxLayout();this.times=times;this.elapsed=new St.Label({text:'0:00',style_class:'fw-time',x_expand:true});this.durationLabel=new St.Label({text:'0:00',style_class:'fw-time'});
        times.add_child(this.elapsed);times.add_child(this.durationLabel);this.details.add_child(times);
        const controls=new St.BoxLayout({style_class:'fw-controls',x_align:Clutter.ActorAlign.CENTER});
        this.shuffleButton=new St.Button({style_class:'fw-control',accessible_name:'Случайный порядок'});this.icon(this.shuffleButton,'media-playlist-shuffle-symbolic');this.shuffleButton.connect('clicked',()=>this.setProperty('Shuffle',new GLib.Variant('b',!this.shuffle)));controls.add_child(this.shuffleButton);
        for (const [label,method] of [['‹','Previous'],['▶','PlayPause'],['›','Next']]) {
            const button=new St.Button({label,style_class:method==='PlayPause'?'fw-play':'fw-control'});
            this.icon(button,{Previous:'media-skip-backward-symbolic',PlayPause:'media-playback-start-symbolic',Next:'media-skip-forward-symbolic'}[method]);
            button.connect('clicked',()=>this.control(method)); controls.add_child(button);
            if (method==='PlayPause') this.playButton=button;
            if (method==='Previous')this.previousButton=button;if(method==='Next')this.nextButton=button;
        }
        this.repeatButton=new St.Button({style_class:'fw-control',accessible_name:'Режим повтора'});this.icon(this.repeatButton,'media-playlist-repeat-symbolic');this.repeatButton.connect('clicked',()=>{
            const next={None:'Playlist',Playlist:'Track',Track:'None'}[this.loop]||'None';this.setProperty('LoopStatus',new GLib.Variant('s',next));
        });controls.add_child(this.repeatButton);
        this.details.add_child(controls);
        this.music.add_child(this.details);
        this.root.add_child(this.music);
        for(const [button,text]of [[this.shuffleButton,'Случайный порядок'],[this.repeatButton,'Повтор: выключен / плейлист / трек'],[this.playButton,'Пауза / продолжить'],[this.previousButton,'Предыдущий трек'],[this.nextButton,'Следующий трек'],[this.source,'Открыть плеер'],[gear,'Настройки виджета']])this.tips.push(new Tooltips.Tooltip(button,text));
        const sliderStyle='-slider-height: 3px; -slider-background-color: #223c2c; -slider-active-background-color: #94c7a4; -slider-border-color: transparent; -slider-active-border-color: transparent; -slider-border-width: 0px; -slider-handle-radius: 4px; color: #bed9c7;';
        this.progress.actor.set_style(sliderStyle);
        this.progress.connect('value-changed',()=>{if(!this.progress._dragging)this.seekFraction(this.progress._value);else this.updateProgress();});
        this.musicTip=new Tooltips.Tooltip(this.title,'');
        this.orbit=new St.Widget({layout_manager:new Clutter.FixedLayout(),style_class:'fw-orbit'});
        this.orbitActors=[this.discBox,this.source,this.gear,this.title,this.artist,this.album,this.elapsed,this.durationLabel,
            this.shuffleButton,this.previousButton,this.playButton,this.nextButton,this.repeatButton];
        this.homeActors=this.orbitActors.map(actor=>({actor,parent:actor.get_parent(),index:actor.get_parent().get_children().indexOf(actor)}));
        this.music.add_child(this.orbit);this.orbit.hide();
        this.setContent(this.root);this.setHeader('Forest Player');this.setupSettings();
        for(const [key,prop]of [['spin-enabled','spinEnabled'],['spin-seconds','spinSeconds'],['compact','compact'],['show-album','showAlbum'],['appearance','appearance'],['dock-side','dockSide'],['spectrum-enabled','spectrumEnabled']])
            this.settings.bind(key,prop,()=>this.applySettings());
        this.applySettings();
        this.spectrumTip=new Tooltips.Tooltip(this.discBox,'Перемотка: потяни белую дугу. Стрелки ← →: 5%.');
        this.monitor=new AudioMonitor(levels=>{
            this.spectrumLevels=levels;
            if(!this.dead)this.canvas.invalidate();
        },status=>{if(!this.dead)this.spectrumTip.set_text(status+'\nПеремотка: потяни белую дугу. Стрелки ← →: 5%.');});
        this.bus=Gio.DBus.session;
        this.subscriptions.push(this.bus.signal_subscribe('org.freedesktop.DBus','org.freedesktop.DBus','NameOwnerChanged','/org/freedesktop/DBus',null,Gio.DBusSignalFlags.NONE,
            (_,s,p,i,n,v)=>{if(v.deep_unpack()[0].startsWith('org.mpris.MediaPlayer2.'))this.findPlayers();}));
        this.subscriptions.push(this.bus.signal_subscribe(null,'org.freedesktop.DBus.Properties','PropertiesChanged','/org/mpris/MediaPlayer2',MPRIS,Gio.DBusSignalFlags.NONE,()=>this.findPlayers()));
        this.subscriptions.push(this.bus.signal_subscribe(null,MPRIS,'Seeked','/org/mpris/MediaPlayer2',null,Gio.DBusSignalFlags.NONE,()=>this.refreshPosition()));
        for(const [obj,name]of [[global.display,'notify::focus-window'],[global.window_manager,'switch-workspace'],[this.actor,'notify::mapped']])
            this.signals.push([obj,obj.connect(name,()=>this.updateRotation())]);
        for(const name of ['size-change','minimize','unminimize','map','destroy'])this.signals.push([global.window_manager,global.window_manager.connect(name,()=>{
            if(this.visibilityTimer)Mainloop.source_remove(this.visibilityTimer);
            this.visibilityTimer=Mainloop.timeout_add(300,()=>{this.visibilityTimer=0;this.updateRotation();return false;});
        })]);
        this.positionTimer=Mainloop.timeout_add_seconds(1,()=>{
            if(this.dead)return false;
            this.updateRotation();
            if(this.playing && this.actor.mapped && !this.covered){this.updateProgress();if((this.positionTick++%10)===0)this.refreshPosition();}
            return true;
        });
        const playerMenu=new PopupMenu.PopupSubMenuMenuItem('Выбрать плеер');this._menu.addMenuItem(playerMenu);
        playerMenu.menu.connect('open-state-changed',(_,open)=>{if(!open)return;playerMenu.menu.removeAll();
            for(const name of this.players||[]){const item=new PopupMenu.PopupMenuItem(name.replace('org.mpris.MediaPlayer2.',''));item.connect('activate',()=>{this.preferredName=name;this.findPlayers();});playerMenu.menu.addMenuItem(item);}
        });
        for(const signal of ['notify::width','notify::height','notify::mapped'])
            this.signals.push([this.actor,this.actor.connect(signal,()=>this.scheduleClamp())]);
        this.signals.push([this._draggable,this._draggable.connect('drag-end',()=>this.scheduleClamp())]);
        this.findPlayers();
    }
    setupSettings() {
        this.settings=new Settings.DeskletSettings(this,this.metadata.uuid,this.instance_id);
        this.settings.bind('font-family','fontFamily',()=>this.applySettings());
        this.settings.bind('opacity','cardOpacity',()=>this.applySettings());
        this.settings.bind('size-percent','sizePercent',()=>this.applySettings());
    }
    clearBackdrop() {
        const clear='background-color: transparent; background-gradient-start: transparent; background-gradient-end: transparent; border-image: none; border: none; box-shadow: none; padding: 0;';
        this.actor.set_style(clear); this.content.set_style(clear);
        this.content.set_style_class_name('forest-transparent');this._header.hide();
    }
    resizeContent(scale){
        const pixels=Math.round((this.appearance==='radial'?340:190)*scale*(global.ui_scale||1));
        this.disc.set_size(pixels,pixels);this.canvas.set_size(pixels,pixels);this.canvas.invalidate();
        const dock=this.appearance==='radial';
        this.discBox.set_size(dock?Math.round(pixels/2):pixels,pixels);
        this.disc.set_position(dock&&this.dockSide!=='right'?-Math.round(pixels/2):0,0);
        const walk=actor=>{if(actor instanceof St.Icon)actor.icon_size=Math.round(16*scale);for(const child of actor.get_children())walk(child);};
        walk(this.root);
        const px=n=>Math.max(1,Math.round(n*scale));
        this.progress.actor.set_style('-slider-height: '+px(3)+'px; -slider-background-color: #223c2c; -slider-active-background-color: #94c7a4; -slider-border-color: transparent; -slider-active-border-color: transparent; -slider-border-width: 0px; -slider-handle-radius: '+px(4)+'px; color: #bed9c7;');
    }
    glassStyle(){
        const a=(this.cardOpacity||55)/100;
        if(this.appearance==='radial')return 'background-color: transparent; background-gradient-direction: none; border: none; box-shadow: none;';
        return 'background-color: rgba(13,34,22,'+a+'); background-gradient-direction: vertical; background-gradient-start: rgba(66,96,76,'+(a*0.8)+'); background-gradient-end: rgba(7,23,14,'+a+'); border-color: rgba(189,228,201,0.3);';
    }
    scheduleClamp(){
        if(this.clampTimer)Mainloop.source_remove(this.clampTimer);
        this.clampTimer=Mainloop.timeout_add(150,()=>{this.clampTimer=0;this.clampPosition();return false;});
    }
    clampPosition(){
        if(this.dead||!this.actor.mapped||this._dragging)return;
        let index=0;
        for(let i=0;i<global.display.get_n_monitors();i++){const m=global.display.get_monitor_geometry(i);if(this.actor.x>=m.x&&this.actor.x<m.x+m.width&&this.actor.y>=m.y&&this.actor.y<m.y+m.height){index=i;break;}}
        const m=global.display.get_monitor_geometry(index),s=1;
        const x=this.appearance==='radial'
            ?(this.dockSide==='right'?m.x+m.width-this.actor.width:m.x)
            :Math.max(m.x+12,Math.min(this.actor.x,m.x+m.width-this.actor.width*s-12));
        const y=Math.max(m.y+48,Math.min(this.actor.y,m.y+m.height-this.actor.height*s-48));
        if(this.actor.x!==Math.round(x)||this.actor.y!==Math.round(y))this.actor.set_position(Math.round(x),Math.round(y));
    }
    applySettings() {
        if(!this.root)return;
        this.cancelArcDrag();
        const percent=Math.max(75,Math.min(160,Math.round((this.sizePercent||100)/5)*5));
        const scale=percent/100;this.actor.set_scale(1,1);
        this.music.vertical=this.appearance!=='radial';
        if(this.appearance==='radial')this.root.add_style_class_name('fw-radial');
        else this.root.remove_style_class_name('fw-radial');
        if(this.sizeClass)this.root.remove_style_class_name(this.sizeClass);
        this.sizeClass='forest-size-'+percent;this.root.add_style_class_name(this.sizeClass);

        this.details.rotation_angle_z=0;
        this.progress.actor.visible=this.appearance!=='radial'||this.compact;
        this.resizeContent(scale);
        this.scheduleClamp();
        const families={'manrope':'Manrope','system':'Sans','mono':'JetBrainsMono Nerd Font','monocraft':'Monocraft','tiny5':'Tiny5','press':'Press Start 2P'};
        this.root.set_style('font-family: "'+(families[this.fontFamily]||'Sans')+'";');
        if(this.card)this.card.set_style(this.glassStyle());
        if(this.discBox)this.discBox.visible=!this.compact;
        if(this.album)this.album.visible=this.showAlbum;
        if(this.rotation){this.disc.remove_transition('forest-spin');this.rotation=null;}
        if(this.appearance==='radial'){
            const px=n=>Math.max(1,Math.round(n*scale));
            this.progress.actor.set_style('-slider-height: '+px(2)+'px; -slider-background-color: rgba(255,255,255,0.15); -slider-active-background-color: #e6e8ed; -slider-border-width: 0px; -slider-handle-radius: '+px(3)+'px; color: #f4f5f7;');
        }
        this.layoutOrbit(scale);
        if(this.disc){this.disc.rotation_angle_z=0;this.updateRotation();}
    }
    layoutOrbit(scale){
        const active=this.appearance==='radial'&&!this.compact;
        if(!this.orbit)return;
        if(active){
            for(const actor of this.orbitActors){
                if(actor.get_parent()!==this.orbit){actor.get_parent().remove_child(actor);this.orbit.add_child(actor);}
            }
            this.details.hide();this.orbit.show();this.music.vertical=true;
            const unit=scale*(global.ui_scale||1),W=380,H=380,cx=380,cy=190;
            const right=this.dockSide==='right';
            this.orbit.set_size(W*unit,H*unit);
            this.root.set_style(this.root.get_style()+'width: '+(W*scale)+'px;');
            this.music.set_style(this.glassStyle()+'width: '+(W*scale)+'px; padding: 0; spacing: 0;');
            const place=(actor,x,y,w,h,angle=0)=>{
                actor.set_pivot_point(0.5,0.5);actor.rotation_angle_z=right?angle:-angle;
                actor.set_size(w*unit,h*unit);actor.set_position((right?x:W-x-w)*unit,y*unit);
            };
            // Circle centre is exactly on the screen edge. Text rows have independent radial angles.
            place(this.discBox,210,20,170,340);
            const label=(actor,angle,radius,width,height,font,weight,tilt)=>{
                const a=angle*Math.PI/180;
                const x=cx+Math.cos(a)*radius-width,y=cy+Math.sin(a)*radius-height/2;
                place(actor,x,y,width,height,tilt);
                // Keep the text edge anchored to its own point on the circle.
                actor.set_pivot_point(right?1:0,0.5);
                actor.set_style('width: '+width*scale+'px; font-size: '+font*scale+'px; font-weight: '+weight+'; text-align: '+(right?'right':'left')+';');
            };
            label(this.title,-145,158,220,30,17,'bold',12);
            label(this.artist,-163,164,185,24,12,'normal',6);
            label(this.album,-179,166,180,20,10,'normal',0);
            this.album.visible=this.showAlbum;
            place(this.source,238,22,105,22,-32);place(this.gear,333,64,24,24,-22);
            const buttons=[this.shuffleButton,this.previousButton,this.playButton,this.nextButton,this.repeatButton];
            const angles=[174,157,140,123,106];
            buttons.forEach((button,i)=>{
                const a=angles[i]*Math.PI/180,sz=i===2?42:32;
                place(button,cx+Math.cos(a)*176-sz/2,cy+Math.sin(a)*176-sz/2,sz,sz,angles[i]-180);
            });
            this.elapsed.hide();this.durationLabel.hide();
        }else{
            this.music.set_style(this.glassStyle());
            for(const home of this.homeActors){
                const actor=home.actor;
                if(actor.get_parent()!==home.parent){actor.get_parent().remove_child(actor);home.parent.insert_child_at_index(actor,home.index);}
                actor.rotation_angle_z=0;actor.set_position(0,0);
                if(actor!==this.discBox){actor.set_size(-1,-1);actor.set_style(null);}
            }
            this.orbit.hide();this.details.show();this.elapsed.show();this.durationLabel.show();this.resizeContent(scale);
        }
    }
    call(name, iface, method, args, done) {
        this.bus.call(name, '/org/mpris/MediaPlayer2', iface, method, args, null,
            Gio.DBusCallFlags.NO_AUTO_START, 1500, this.cancel, (bus, result) => {
                try { const value = bus.call_finish(result).deep_unpack(); if (!this.dead) done(value); }
                catch (_) { if (!this.dead) done(null); }
            });
    }
    findPlayers() {
        if (this.dead) return;
        const generation = (this.generation || 0)+1; this.generation = generation;
        this.bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, 1500, this.cancel, (bus, result) => {
                let names;
                try { names = bus.call_finish(result).deep_unpack()[0].filter(n => n.startsWith('org.mpris.MediaPlayer2.')).sort(); }
                catch (_) { return; }
                if (this.dead || generation !== this.generation) return;
                if (!names.length) { this.player = null; this.noPlayer(); return; }
                let pending = names.length, candidates = [];
                for (const name of names) this.call(name, 'org.freedesktop.DBus.Properties', 'GetAll',
                    new GLib.Variant('(s)', [MPRIS]), value => {
                        if (generation !== this.generation) return;
                        if (value) candidates.push({name, props:value[0]});
                        if (--pending) return;
                        const unpack = v => v && typeof v.deep_unpack === 'function' ? v.deep_unpack() : v;
                        candidates.sort((a,b) => {
                            const score=c=>Number(c.name===this.preferredName)*10+Number(unpack(c.props.PlaybackStatus)==='Playing');
                            return score(b)-score(a);
                        });
                        this.players=candidates.map(c=>c.name);
                        if (!candidates.length) { this.player=null; this.noPlayer(); return; }
                        const selected = candidates[0]; this.player = selected.name;
                        const meta = unpack(selected.props.Metadata) || {};
                        const title = String(unpack(meta['xesam:title']) || 'Плеер');
                        const artist = unpack(meta['xesam:artist']) || [];
                        const playing = unpack(selected.props.PlaybackStatus) === 'Playing';
                        const chars = Array.from(title), short = chars.slice(0,19).join('')+(chars.length>19?'…':'');
                        this.title.set_text(title);
                        this.artist.set_text(Array.isArray(artist)?artist.join(', '):String(artist));
                        this.icon(this.playButton,playing?'media-playback-pause-symbolic':'media-playback-start-symbolic');
                        this.playing = playing;
                        this.loadArt(String(unpack(meta['mpris:artUrl']) || ''));
                        this.applyPlayerState(selected.props,meta);
                        this.updateRotation();
                        this.musicTip.set_text(`${title}\n${Array.isArray(artist)?artist.join(', '):artist}`);

                    });
            });
    }
    control(method) { if (this.player) this.call(this.player, MPRIS, method, null, () => {}); }
    noPlayer() {
        this.player=null; this.playing=false; this.title.set_text('Тишина в лесу');
        this.artist.set_text('Открой музыкальный плеер');this.source.set_label('NOW PLAYING');this.album.set_text(''); this.icon(this.playButton,'media-playback-start-symbolic');
        this.cancelArcDrag();this.progress.cancelDrag();this.length=0;this.position=0;this.trackId=null;this.progress.actor.reactive=false;this.updateProgress();
        this.updateRotation(); this.loadArt('');
    }
    updateRotation() {
        if (this.dead) return;
        const ws=global.workspace_manager.get_active_workspace();
        const covered=global.get_window_actors().some(a=>{
            const w=a.meta_window;
            return w && !w.minimized && w.showing_on_its_workspace() && w.located_on_workspace(ws) &&
                ((w.maximized_horizontally && w.maximized_vertically) || w.is_fullscreen());
        });
        this.covered=covered;
        this.updateAudioMonitor();
        const run=this.appearance!=='radial' && this.spinEnabled && !this.compact && this.playing && this.actor.mapped && !covered;
        if (run && !this.rotation) {
            const transition=new Clutter.PropertyTransition({property_name:'rotation-angle-z',duration:this.spinSeconds*1000,repeat_count:-1,progress_mode:Clutter.AnimationMode.LINEAR});
            transition.set_from(0); transition.set_to(360);
            this.disc.add_transition('forest-spin',transition); this.rotation=transition;
        } else if (this.rotation) {
            if (run && !this.rotation.is_playing()) this.rotation.start();
            else if (!run && this.rotation.is_playing()) this.rotation.pause();
        }
    }
    updateAudioMonitor() {
        if(!this.monitor)return;
        const visible=!this.dead && this.appearance==='radial' && this.spectrumEnabled && !this.compact && this.actor.mapped && !this.covered;
        if(visible && this.playing)this.monitor.start();
        else if(this.monitor.proc || (!visible && this.monitor.fadeTimer))this.monitor.stop(visible && !this.playing);
    }
    arcPoint(event){
        const [sx,sy]=event.get_coords();
        const [ok,x,y]=this.discBox.transform_stage_point(sx,sy);
        if(!ok)return null;
        const scale=this.disc.width/340;
        return {x:x/scale-(this.dockSide==='right'?170:0),y:y/scale-170};
    }
    arcPress(event){
        if(this.appearance!=='radial'||event.get_button()!==1||!this.canSeek||!this.length)return Clutter.EVENT_PROPAGATE;
        const p=this.arcPoint(event);if(!p||Math.abs(Math.hypot(p.x,p.y)-98)>12)return Clutter.EVENT_PROPAGATE;
        this.cancelArcDrag();this.arcDragging=true;this.arcFraction=fractionAt(p.x,p.y,this.dockSide);
        this.arcDevice=event.get_device();this.arcDevice.grab(this.discBox);
        this.arcMotionId=this.discBox.connect('motion-event',(_,e)=>{
            const point=this.arcPoint(e);if(point)this.arcFraction=fractionAt(point.x,point.y,this.dockSide);
            this.updateProgress();return Clutter.EVENT_STOP;
        });
        this.arcReleaseId=this.discBox.connect('button-release-event',()=>{
            const fraction=this.arcFraction;this.cancelArcDrag();this.seekFraction(fraction);return Clutter.EVENT_STOP;
        });
        this.updateProgress();return Clutter.EVENT_STOP;
    }
    cancelArcDrag(){
        if(this.arcDevice)this.arcDevice.ungrab();this.arcDevice=null;
        if(this.arcMotionId)this.discBox.disconnect(this.arcMotionId);
        if(this.arcReleaseId)this.discBox.disconnect(this.arcReleaseId);
        this.arcMotionId=0;this.arcReleaseId=0;this.arcDragging=false;
    }
    loadArt(uri) {
        if (uri===this.artUri) return;
        this.artUri=uri;
        if (this.artCancel) this.artCancel.cancel();
        this.artCancel=new Gio.Cancellable();
        this.pixbuf=null;this.greyPixbuf=null; this.canvas.invalidate();
        if (!uri) return;
        const finish=bytes=>{
            if(this.dead || this.artUri!==uri || bytes.length>8*1024*1024)return;
            try { const loader=new GdkPixbuf.PixbufLoader(); loader.set_size(640,640); loader.write(bytes); loader.close(); this.pixbuf=loader.get_pixbuf();this.greyPixbuf=this.pixbuf.copy();this.pixbuf.saturate_and_pixelate(this.greyPixbuf,0,false); this.canvas.invalidate(); }
            catch(e){ global.log('Forest Widgets: album art unavailable'); }
        };
        try {
            if (uri.startsWith('file://')) {
                Gio.File.new_for_uri(uri).load_contents_async(this.artCancel,(file,result)=>{
                    try {const [ok,data]=file.load_contents_finish(result);if(ok)finish(data);}catch(_){}
                });
            } else if (uri.startsWith('https://')) {
                const message=Soup.Message.new('GET',uri);
                this.http.send_and_read_async(message,GLib.PRIORITY_DEFAULT,this.artCancel,(session,result)=>{
                    try {const bytes=session.send_and_read_finish(result);if(message.status_code===200)finish(bytes.get_data());}catch(_){}
                });
            }
        } catch(_){}
    }
    drawRadial(cr,w,h) {
        cr.setOperator(Cairo.Operator.CLEAR);cr.paint();cr.setOperator(Cairo.Operator.OVER);
        cr.scale(w/340,h/340);
        const c=170,r=94,levels=this.spectrumLevels||[];
        const energy=levels.length?levels.reduce((a,b)=>a+b,0)/levels.length:0;
        const glow=new Cairo.RadialGradient(c,c,80,c,c,164);
        glow.addColorStopRGBA(0,0.82,0.85,0.90,0.10+energy*0.12);
        glow.addColorStopRGBA(0.45,0.90,0.93,1,0.04+energy*0.06);
        glow.addColorStopRGBA(1,1,1,1,0);
        cr.setSource(glow);cr.arc(c,c,164,0,Math.PI*2);cr.fill();
        // Mirror 48 real frequency bands around the cover: 96 radial bars.
        cr.setLineWidth(2);cr.setLineCap(Cairo.LineCap.ROUND);
        for(let i=0;i<96;i++){
            const band=i<48?i:95-i,level=levels[band]||0;
            if(level<=0.001)continue;
            const angle=i/96*Math.PI*2-Math.PI/2;
            const inner=r+17,outer=inner+level*45,alpha=Math.min(1,level*10);
            cr.setLineWidth(5);cr.setSourceRGBA(0.9,0.94,1,alpha*(0.08+level*0.12));
            cr.moveTo(c+Math.cos(angle)*inner,c+Math.sin(angle)*inner);
            cr.lineTo(c+Math.cos(angle)*outer,c+Math.sin(angle)*outer);cr.stroke();
            cr.setLineWidth(1.8);cr.setSourceRGBA(0.96,0.97,1,alpha*(0.68+level*0.32));
            cr.moveTo(c+Math.cos(angle)*inner,c+Math.sin(angle)*inner);
            cr.lineTo(c+Math.cos(angle)*outer,c+Math.sin(angle)*outer);cr.stroke();
        }
        cr.setSourceRGBA(0.055,0.06,0.065,1);cr.arc(c,c,r,0,Math.PI*2);cr.fill();
        if(this.pixbuf){
            cr.save();cr.arc(c,c,r,0,Math.PI*2);cr.clip();
            const pw=this.pixbuf.get_width(),ph=this.pixbuf.get_height(),scale=Math.max(2*r/pw,2*r/ph);
            cr.translate(c-pw*scale/2,c-ph*scale/2);cr.scale(scale,scale);
            Gdk.cairo_set_source_pixbuf(cr,this.greyPixbuf||this.pixbuf,0,0);cr.paint();cr.restore();
        }else{
            const face=new Cairo.RadialGradient(c-30,c-35,0,c,c,r);
            face.addColorStopRGBA(0,0.23,0.24,0.26,1);face.addColorStopRGBA(1,0.075,0.08,0.09,1);
            cr.setSource(face);cr.arc(c,c,r,0,Math.PI*2);cr.fill();
            cr.setSourceRGBA(0.9,0.92,0.96,0.75);cr.setLineWidth(3);
            cr.moveTo(c+9,c+12);cr.lineTo(c+9,c-22);cr.lineTo(c+28,c-27);cr.lineTo(c+28,c+7);cr.stroke();
            cr.save();cr.translate(c,c+14);cr.scale(1,0.65);cr.arc(0,0,10,0,Math.PI*2);cr.fill();cr.restore();
            cr.save();cr.translate(c+19,c+9);cr.scale(1,0.65);cr.arc(0,0,10,0,Math.PI*2);cr.fill();cr.restore();
        }
        cr.setLineWidth(1);cr.setSourceRGBA(1,1,1,0.16);cr.arc(c,c,r+1,0,Math.PI*2);cr.stroke();
        const start=-Math.PI/2,sign=this.dockSide==='right'?-1:1;
        const fraction=this.arcDragging?this.arcFraction:(this.progress?this.progress._value:0);
        const arc=(end)=>{if(sign<0)cr.arcNegative(c,c,98,start,end);else cr.arc(c,c,98,start,end);};
        cr.setLineWidth(2);cr.setSourceRGBA(1,1,1,0.18);arc(start+sign*Math.PI);cr.stroke();
        if(fraction>0){cr.setSourceRGBA(1,1,1,0.95);arc(start+sign*Math.PI*fraction);cr.stroke();}
        const head=start+sign*Math.PI*fraction;
        cr.setSourceRGBA(1,1,1,1);cr.arc(c+Math.cos(head)*98,c+Math.sin(head)*98,3,0,Math.PI*2);cr.fill();
        cr.$dispose();return true;
    }
    drawRecord(cr,w,h) {
        if(this.appearance==='radial')return this.drawRadial(cr,w,h);
        cr.scale(w/190,h/190);w=190;h=190;
        const r=w/2;
        cr.setOperator(imports.cairo.Operator.CLEAR); cr.paint(); cr.setOperator(imports.cairo.Operator.OVER);
        cr.setSourceRGBA(0.015,0.027,0.025,0.96); cr.arc(r,r,r-1,0,2*Math.PI); cr.fill();
        if (this.pixbuf) {
            cr.save(); cr.arc(r,r,r-7,0,2*Math.PI); cr.clip();
            const pw=this.pixbuf.get_width(),ph=this.pixbuf.get_height(),s=Math.max(w/pw,h/ph);
            cr.translate((w-pw*s)/2,(h-ph*s)/2); cr.scale(s,s);
            Gdk.cairo_set_source_pixbuf(cr,this.pixbuf,0,0); cr.paintWithAlpha(0.78); cr.restore();
        }
        for(let radius=30;radius<r-5;radius+=5){cr.setSourceRGBA(0.65,0.85,0.74,0.10);cr.setLineWidth(0.7);cr.arc(r,r,radius,0,2*Math.PI);cr.stroke();}
        cr.setSourceRGBA(0.06,0.16,0.12,0.88);cr.arc(r,r,25,0,2*Math.PI);cr.fill();
        cr.setSourceRGBA(0.62,0.81,0.70,0.8);cr.arc(r,r,5,0,2*Math.PI);cr.fill();
        cr.setSourceRGBA(0.7,0.9,0.78,0.25);cr.setLineWidth(1);cr.arc(r,r,r-2,0,2*Math.PI);cr.stroke();
        cr.$dispose(); return true;
    }
    icon(button,name){button.set_child(new St.Icon({icon_name:name,icon_size:Math.round(16*(this.sizePercent||100)/100),icon_type:St.IconType.SYMBOLIC}));}
    applyPlayerState(props,meta){
        const unpack=v=>v&&typeof v.deep_unpack==='function'?v.deep_unpack():v;
        const previousTrack=this.trackId,previousPlayer=this.statePlayer;
        this.statePlayer=this.player;this.trackId=unpack(meta['mpris:trackid']);
        this.length=Number(unpack(meta['mpris:length'])||0)/1000000;
        this.album.set_text(String(unpack(meta['xesam:album'])||''));
        this.shuffle=Boolean(unpack(props.Shuffle));this.loop=unpack(props.LoopStatus)||'None';
        this.shuffleButton.set_style_class_name('fw-control'+(this.shuffle?' fw-active':''));
        this.repeatButton.set_style_class_name('fw-control'+(this.loop!=='None'?' fw-active':''));
        this.icon(this.repeatButton,this.loop==='Track'?'media-playlist-repeat-song-symbolic':'media-playlist-repeat-symbolic');
        const controllable=unpack(props.CanControl)!==false;
        for(const [button,enabled]of [[this.previousButton,controllable&&unpack(props.CanGoPrevious)!==false],[this.nextButton,controllable&&unpack(props.CanGoNext)!==false],[this.shuffleButton,controllable&&props.Shuffle!==undefined],[this.repeatButton,controllable&&props.LoopStatus!==undefined]]){button.reactive=enabled;button.opacity=enabled?255:90;}
        this.canSeek=Boolean(unpack(props.CanSeek));
        if(!this.canSeek||!this.length){this.progress.cancelDrag();this.cancelArcDrag();}
        this.progress.actor.reactive=this.canSeek&&this.length>0;
        this.source.set_label(this.player.replace('org.mpris.MediaPlayer2.','').split('.')[0].toUpperCase()+' ↗');
        const position=(this.seekingUntil||0)>GLib.get_monotonic_time()?undefined:unpack(props.Position);
        if(previousTrack!==this.trackId||previousPlayer!==this.player){this.cancelArcDrag();this.seekingUntil=0;this.seekEpoch=(this.seekEpoch||0)+1;}
        if(position!==undefined){this.position=Number(position)/1000000;this.positionAt=GLib.get_monotonic_time();}
        else if(previousTrack!==this.trackId||previousPlayer!==this.player){this.position=0;this.positionAt=GLib.get_monotonic_time();this.refreshPosition();}
        this.positionTick=0;this.updateProgress();
    }
    refreshPosition(){
        if(!this.player||this.arcDragging||this.progress._dragging||(this.seekingUntil||0)>GLib.get_monotonic_time())return;
        const player=this.player,track=this.trackId,epoch=this.seekEpoch||0;
        this.call(player,'org.freedesktop.DBus.Properties','Get',new GLib.Variant('(ss)',[MPRIS,'Position']),value=>{
            if(!value||this.player!==player||this.trackId!==track||(this.seekEpoch||0)!==epoch||this.progress._dragging)return;
            const v=value[0];this.position=Number(v&&v.deep_unpack?v.deep_unpack():v)/1000000;this.positionAt=GLib.get_monotonic_time();this.updateProgress();
        });
    }
    updateProgress(){
        if(!this.progress)return;
        const time=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
        if(this.arcDragging){this.elapsed.set_text(time(this.arcFraction*(this.length||0)));this.canvas.invalidate();return;}
        if(this.progress._dragging){this.elapsed.set_text(time(this.progress._value*(this.length||0)));return;}
        const delta=this.playing&&this.positionAt?(GLib.get_monotonic_time()-this.positionAt)/1000000:0;
        const pos=Math.max(0,Math.min(this.length||0,(this.position||0)+delta));
        this.progress.setValue(this.length?pos/this.length:0);
        this.elapsed.set_text(time(pos));this.durationLabel.set_text(time(this.length||0));
        if(this.appearance==='radial')this.canvas.invalidate();
    }
    seekFraction(fraction){
        if(!this.player||!this.canSeek||!this.trackId||!this.length)return;
        const player=this.player,track=this.trackId,target=Math.round(Math.max(0,Math.min(1,fraction))*Math.max(0,this.length-0.1)*1000000);
        const epoch=(this.seekEpoch||0)+1;this.seekEpoch=epoch;
        const now=GLib.get_monotonic_time();this.position=target/1000000;this.positionAt=now;this.seekingUntil=now+1500000;this.updateProgress();
        if(this.seekTimer)Mainloop.source_remove(this.seekTimer);
        this.call(player,MPRIS,'SetPosition',new GLib.Variant('(ox)',[track,target]),result=>{
            if(this.player!==player||this.trackId!==track||this.seekEpoch!==epoch)return;
            const verify=()=>{
                this.seekTimer=0;
                this.call(player,'org.freedesktop.DBus.Properties','Get',new GLib.Variant('(ss)',[MPRIS,'Position']),value=>{
                    if(!value||this.player!==player||this.trackId!==track||this.seekEpoch!==epoch)return;
                    const v=value[0],actual=Number(v&&v.deep_unpack?v.deep_unpack():v);
                    // Some Spotify builds acknowledge SetPosition but ignore it. Use Seek once if needed.
                    if(Math.abs(actual-target)>3000000&&player.includes('spotify')){
                        this.call(player,MPRIS,'Seek',new GLib.Variant('(x)',[target-actual]),()=>{
                            if(this.seekEpoch!==epoch)return;
                            this.seekTimer=Mainloop.timeout_add(700,()=>{this.seekTimer=0;this.seekingUntil=0;this.refreshPosition();return false;});
                        });
                    }else{this.seekingUntil=0;this.position=actual/1000000;this.positionAt=GLib.get_monotonic_time();this.updateProgress();}
                });
                return false;
            };
            this.seekTimer=Mainloop.timeout_add(result===null?50:700,verify);
        });
    }
    setProperty(name,value){
        if(!this.player)return;
        this.call(this.player,'org.freedesktop.DBus.Properties','Set',new GLib.Variant('(ssv)',[MPRIS,name,value]),()=>this.findPlayers());
    }
    raisePlayer(){if(this.player)this.call(this.player,'org.mpris.MediaPlayer2','Raise',null,()=>{});}
    on_desklet_removed(){
        this.dead=true;this.cancelArcDrag();if(this.monitor)this.monitor.stop();if(this.spectrumTip)this.spectrumTip.destroy();this.progress.cancelDrag();this.cancel.cancel();if(this.artCancel)this.artCancel.cancel();this.http.abort();
        if(this.positionTimer)Mainloop.source_remove(this.positionTimer);if(this.seekTimer)Mainloop.source_remove(this.seekTimer);if(this.visibilityTimer)Mainloop.source_remove(this.visibilityTimer);
        this.disc.remove_all_transitions();for(const [obj,id]of this.signals)obj.disconnect(id);
        for(const id of this.subscriptions)this.bus.signal_unsubscribe(id);if(this.clampTimer)Mainloop.source_remove(this.clampTimer);this.musicTip.destroy();for(const tip of this.tips)tip.destroy();this.settings.finalize();
    }
}
function main(metadata,id){return new ForestPlayer(metadata,id);}
