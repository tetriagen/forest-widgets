// Optional per-tile wallpaper refraction using the separately installed Blur Cinnamon shader.
// No shared background actor is placed behind the entire resources desklet.
const St=imports.gi.St;
const Clutter=imports.gi.Clutter;
const Meta=imports.gi.Meta;
const GLib=imports.gi.GLib;
const FileUtils=imports.misc.fileUtils;
class TileGlass {
    constructor(owner) {
        this.owner=owner;this.items=[];this.Refraction=null;
        try {
            const dir=GLib.get_user_data_dir()+'/cinnamon/extensions/BlurCinnamon@klangman/6.0';
            if(!Meta.is_wayland_compositor()&&GLib.file_test(dir+'/refraction.js',GLib.FileTest.EXISTS))
                this.Refraction=FileUtils.requireModule(dir+'/refraction.js',dir,{},'extension').RefractionEffect;
        }catch(e){global.log('Forest Widgets: per-tile glass unavailable; using transparency.');}
        this.background=global.window_group.get_children().find(actor=>actor instanceof Meta.X11BackgroundActor);
        if(!this.background)this.Refraction=null;
        this.positionId=owner.connect('notify::allocation',()=>this.sync());
    }
    wrap(tile) {
        if(!this.Refraction)return tile;
        const wrapper=new St.Widget({layout_manager:new Clutter.BinLayout()});
        const viewport=new Clutter.Actor({width:1,height:1,clip_to_allocation:true,reactive:false,visible:false});
        const wallpaper=new Clutter.Clone({source:this.background,reactive:false});
        viewport.add_child(wallpaper);
        const effect=new this.Refraction({strength:0.78,blur_radius:18,edge_size:24,corner_radius:24,
            rim_width:2.2,gloss:0.85,rgb_fringing:0.015,tint:0.08,tint_color:[0.92,0.95,1,1],shadow:0.08,backdrop_zoom:1.04});
        viewport.add_effect_with_name('forest-tile-glass',effect);
        wrapper.add_child(viewport);wrapper.add_child(tile);
        const item={tile,wrapper,viewport,wallpaper,effect};
        item.id=tile.connect('notify::allocation',()=>this.syncItem(item));
        this.items.push(item);return wrapper;
    }
    setEnabled(enabled){
        this.enabled=enabled;
        for(const item of this.items)item.viewport.visible=enabled;
        if(enabled)this.sync();
    }
    syncItem(item) {
        if(!this.enabled)return;
        const {tile,viewport,wallpaper,effect}=item;
        if(tile.width<2||tile.height<2)return;
        const [x,y]=tile.get_transformed_position();
        if(viewport.width!==tile.width||viewport.height!==tile.height)viewport.set_size(tile.width,tile.height);
        wallpaper.set_position(-Math.round(x),-Math.round(y));
        effect.corner_radius=tile.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        effect.clip=[0,0,tile.width,tile.height];
    }
    sync(){for(const item of this.items)this.syncItem(item);}
    destroy(){
        this.owner.disconnect(this.positionId);
        for(const item of this.items){item.tile.disconnect(item.id);item.viewport.remove_effect(item.effect);item.viewport.destroy();}
        this.items=[];
    }
}
module.exports={TileGlass};
