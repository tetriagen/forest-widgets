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
const MPRIS = 'org.mpris.MediaPlayer2.Player';
function read(path) {
    try { const [ok, bytes] = GLib.file_get_contents(path); return ok ? ByteArray.toString(bytes) : ''; }
    catch (_) { return ''; }
}
class ForestPlayer extends Desklet.Desklet {
    constructor(metadata,id){
        super(metadata,id);this.dead=false;this.signals=[];this.subscriptions=[];this.tips=[];
        this.player=null;this.playing=false;this.length=0;this.position=0;this.positionTick=0;this.volume=0.5;this.loop='None';
        this.cancel=new Gio.Cancellable();this.http=new Soup.Session({timeout:8});
        this.clearBackdrop();this.root=new St.BoxLayout({vertical:true,style_class:'fw-root'});
        this.music=new St.BoxLayout({vertical:true,style_class:'fw-music'});
        this.card=this.music;
        const header=new St.BoxLayout({style_class:'fw-header'});
        this.source=new St.Button({label:'NOW PLAYING',style_class:'fw-source',x_expand:true,x_align:Clutter.ActorAlign.START});
        this.source.connect('clicked',()=>this.raisePlayer());header.add_child(this.source);
        const gear=new St.Button({label:'⚙',style_class:'fw-gear'});gear.connect('clicked',()=>this.configureDesklet());header.add_child(gear);this.music.add_child(header);
        const discBox=new St.Bin({style_class:'fw-disc-box',x_align:St.Align.MIDDLE,y_align:St.Align.MIDDLE});
        this.disc=new Clutter.Actor({width:190,height:190,opacity:225});
        this.disc.set_pivot_point(0.5,0.5);
        this.canvas=new Clutter.Canvas(); this.canvas.set_size(190,190);
        this.canvas.connect('draw',(_,cr,w,h)=>this.drawRecord(cr,w,h));
        this.disc.set_content(this.canvas); this.canvas.invalidate();
        this.discBox=discBox;discBox.set_child(this.disc); this.music.add_child(discBox);
        this.title=new St.Label({text:'Музыка на паузе',style_class:'fw-title'});
        this.artist=new St.Label({text:'Открой Spotify или другой плеер',style_class:'fw-artist'});
        for (const label of [this.title,this.artist]) { label.clutter_text.ellipsize=Pango.EllipsizeMode.END; label.clutter_text.set_single_line_mode(true); this.music.add_child(label); }
        this.album=new St.Label({text:'',style_class:'fw-album'});this.album.clutter_text.ellipsize=Pango.EllipsizeMode.END;this.music.add_child(this.album);
        this.progress=new Slider.Slider(0);this.progress.actor.add_style_class_name('fw-slider');
        this.progress.connect('drag-end',()=>this.seekFraction(this.progress._value));
        this.music.add_child(this.progress.actor);
        const times=new St.BoxLayout();this.elapsed=new St.Label({text:'0:00',style_class:'fw-time',x_expand:true});this.durationLabel=new St.Label({text:'0:00',style_class:'fw-time'});
        times.add_child(this.elapsed);times.add_child(this.durationLabel);this.music.add_child(times);
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
        this.music.add_child(controls);
        this.root.add_child(this.music);
        for(const [button,text]of [[this.shuffleButton,'Случайный порядок'],[this.repeatButton,'Повтор: выключен / плейлист / трек'],[this.playButton,'Пауза / продолжить'],[this.previousButton,'Предыдущий трек'],[this.nextButton,'Следующий трек'],[this.source,'Открыть плеер'],[gear,'Настройки виджета']])this.tips.push(new Tooltips.Tooltip(button,text));
        const sliderStyle='-slider-height: 3px; -slider-background-color: #223c2c; -slider-active-background-color: #94c7a4; -slider-border-color: transparent; -slider-active-border-color: transparent; -slider-border-width: 0px; -slider-handle-radius: 4px; color: #bed9c7;';
        this.progress.actor.set_style(sliderStyle);
        this.progress.connect('value-changed',()=>{if(!this.progress._dragging)this.seekFraction(this.progress._value);else this.updateProgress();});
        this.musicTip=new Tooltips.Tooltip(this.title,'');
        this.setContent(this.root);this.setHeader('Forest Vinyl');this.setupSettings();
        for(const [key,prop]of [['spin-enabled','spinEnabled'],['spin-seconds','spinSeconds'],['compact','compact'],['show-album','showAlbum']])
            this.settings.bind(key,prop,()=>this.applySettings());
        this.applySettings();
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
            if(this.playing && this.actor.mapped && !this.covered){this.updateProgress();if((this.positionTick++%10)===0)this.refreshPosition();}
            return true;
        });
        const playerMenu=new PopupMenu.PopupSubMenuMenuItem('Выбрать плеер');this._menu.addMenuItem(playerMenu);
        playerMenu.menu.connect('open-state-changed',(_,open)=>{if(!open)return;playerMenu.menu.removeAll();
            for(const name of this.players||[]){const item=new PopupMenu.PopupMenuItem(name.replace('org.mpris.MediaPlayer2.',''));item.connect('activate',()=>{this.preferredName=name;this.findPlayers();});playerMenu.menu.addMenuItem(item);}
        });
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
        const pixels=Math.round(190*scale*(global.ui_scale||1));
        this.disc.set_size(pixels,pixels);this.canvas.set_size(pixels,pixels);this.canvas.invalidate();
        const walk=actor=>{if(actor instanceof St.Icon)actor.icon_size=Math.round(16*scale);for(const child of actor.get_children())walk(child);};
        walk(this.root);
        const px=n=>Math.max(1,Math.round(n*scale));
        this.progress.actor.set_style('-slider-height: '+px(3)+'px; -slider-background-color: #223c2c; -slider-active-background-color: #94c7a4; -slider-border-color: transparent; -slider-active-border-color: transparent; -slider-border-width: 0px; -slider-handle-radius: '+px(4)+'px; color: #bed9c7;');
    }
    glassStyle(){
        const a=(this.cardOpacity||55)/100;
        return 'background-color: rgba(13,34,22,'+a+'); background-gradient-direction: vertical; background-gradient-start: rgba(66,96,76,'+(a*0.8)+'); background-gradient-end: rgba(7,23,14,'+a+'); border-color: rgba(189,228,201,0.3);';
    }
    clampPosition(){
        if(this.dead||!this.actor.mapped)return;
        let index=0;
        for(let i=0;i<global.display.get_n_monitors();i++){const m=global.display.get_monitor_geometry(i);if(this.actor.x>=m.x&&this.actor.x<m.x+m.width&&this.actor.y>=m.y&&this.actor.y<m.y+m.height){index=i;break;}}
        const m=global.display.get_monitor_geometry(index),s=1;
        const x=Math.max(m.x+12,Math.min(this.actor.x,m.x+m.width-this.actor.width*s-12));
        const y=Math.max(m.y+48,Math.min(this.actor.y,m.y+m.height-this.actor.height*s-12));
        if(this.actor.x!==Math.round(x)||this.actor.y!==Math.round(y))this.actor.set_position(Math.round(x),Math.round(y));
    }
    applySettings() {
        if(!this.root)return;
        const percent=Math.max(75,Math.min(160,Math.round((this.sizePercent||100)/5)*5));
        const scale=percent/100;this.actor.set_scale(1,1);
        if(this.sizeClass)this.root.remove_style_class_name(this.sizeClass);
        this.sizeClass='forest-size-'+percent;this.root.add_style_class_name(this.sizeClass);
        this.resizeContent(scale);
        if(this.clampTimer)Mainloop.source_remove(this.clampTimer);
        this.clampTimer=Mainloop.timeout_add(100,()=>{this.clampTimer=0;this.clampPosition();return false;});
        const families={'system':'Sans','mono':'JetBrainsMono Nerd Font','monocraft':'Monocraft','tiny5':'Tiny5','press':'Press Start 2P'};
        this.root.set_style('font-family: "'+(families[this.fontFamily]||'Sans')+'";');
        if(this.card)this.card.set_style(this.glassStyle());
        if(this.discBox)this.discBox.visible=!this.compact;
        if(this.album)this.album.visible=this.showAlbum;
        if(this.rotation){this.disc.remove_transition('forest-spin');this.rotation=null;}
        if(this.disc)this.updateRotation();
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
        this.artist.set_text('Открой музыкальный плеер'); this.icon(this.playButton,'media-playback-start-symbolic');
        this.length=0;this.position=0;this.trackId=null;this.progress.actor.reactive=false;this.updateProgress();
        this.updateRotation(); this.loadArt('');
    }
    updateRotation() {
        if (this.dead) return;
        const ws=global.workspace_manager.get_active_workspace();
        const covered=global.get_window_actors().some(a=>{
            const w=a.meta_window;
            return w && !w.minimized && w.located_on_workspace(ws) &&
                ((w.maximized_horizontally && w.maximized_vertically) || w.is_fullscreen());
        });
        this.covered=covered;
        const run=this.spinEnabled && !this.compact && this.playing && this.actor.mapped && !covered;
        if (run && !this.rotation) {
            const transition=new Clutter.PropertyTransition({property_name:'rotation-angle-z',duration:this.spinSeconds*1000,repeat_count:-1,progress_mode:Clutter.AnimationMode.LINEAR});
            transition.set_from(0); transition.set_to(360);
            this.disc.add_transition('forest-spin',transition); this.rotation=transition;
        } else if (this.rotation) {
            if (run && !this.rotation.is_playing()) this.rotation.start();
            else if (!run && this.rotation.is_playing()) this.rotation.pause();
        }
    }
    loadArt(uri) {
        if (uri===this.artUri) return;
        this.artUri=uri;
        if (this.artCancel) this.artCancel.cancel();
        this.artCancel=new Gio.Cancellable();
        this.pixbuf=null; this.canvas.invalidate();
        if (!uri) return;
        const finish=bytes=>{
            if(this.dead || this.artUri!==uri || bytes.length>8*1024*1024)return;
            try { const loader=new GdkPixbuf.PixbufLoader(); loader.set_size(640,640); loader.write(bytes); loader.close(); this.pixbuf=loader.get_pixbuf(); this.canvas.invalidate(); }
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
    drawRecord(cr,w,h) {
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
        this.canSeek=Boolean(unpack(props.CanSeek));this.progress.actor.reactive=this.canSeek&&this.length>0;
        this.source.set_label(this.player.replace('org.mpris.MediaPlayer2.','').split('.')[0].toUpperCase()+' ↗');
        const position=(this.seekingUntil||0)>GLib.get_monotonic_time()?undefined:unpack(props.Position);
        if(previousTrack!==this.trackId||previousPlayer!==this.player){this.seekingUntil=0;this.seekEpoch=(this.seekEpoch||0)+1;}
        if(position!==undefined){this.position=Number(position)/1000000;this.positionAt=GLib.get_monotonic_time();}
        else if(previousTrack!==this.trackId||previousPlayer!==this.player){this.position=0;this.positionAt=GLib.get_monotonic_time();this.refreshPosition();}
        this.positionTick=0;this.updateProgress();
    }
    refreshPosition(){
        if(!this.player||this.progress._dragging||(this.seekingUntil||0)>GLib.get_monotonic_time())return;
        const player=this.player,track=this.trackId,epoch=this.seekEpoch||0;
        this.call(player,'org.freedesktop.DBus.Properties','Get',new GLib.Variant('(ss)',[MPRIS,'Position']),value=>{
            if(!value||this.player!==player||this.trackId!==track||(this.seekEpoch||0)!==epoch||this.progress._dragging)return;
            const v=value[0];this.position=Number(v&&v.deep_unpack?v.deep_unpack():v)/1000000;this.positionAt=GLib.get_monotonic_time();this.updateProgress();
        });
    }
    updateProgress(){
        if(!this.progress)return;
        const time=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
        if(this.progress._dragging){this.elapsed.set_text(time(this.progress._value*(this.length||0)));return;}
        const delta=this.playing&&this.positionAt?(GLib.get_monotonic_time()-this.positionAt)/1000000:0;
        const pos=Math.max(0,Math.min(this.length||0,(this.position||0)+delta));
        this.progress.setValue(this.length?pos/this.length:0);
        this.elapsed.set_text(time(pos));this.durationLabel.set_text(time(this.length||0));
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
        this.dead=true;this.cancel.cancel();if(this.artCancel)this.artCancel.cancel();this.http.abort();
        if(this.positionTimer)Mainloop.source_remove(this.positionTimer);if(this.seekTimer)Mainloop.source_remove(this.seekTimer);if(this.visibilityTimer)Mainloop.source_remove(this.visibilityTimer);
        this.disc.remove_all_transitions();for(const [obj,id]of this.signals)obj.disconnect(id);
        for(const id of this.subscriptions)this.bus.signal_unsubscribe(id);if(this.clampTimer)Mainloop.source_remove(this.clampTimer);this.musicTip.destroy();for(const tip of this.tips)tip.destroy();this.settings.finalize();
    }
}
function main(metadata,id){return new ForestPlayer(metadata,id);}
