const AppletManager=imports.ui.appletManager;
const St=imports.gi.St;
const GLib=imports.gi.GLib;
const Mainloop=imports.mainloop;
let area=null,menu=null,original=null,timer=0,retry=0,destroyId=0,frames=[],active=false;
const SIZE=24,COUNT=360,FPS=15;
function makeFrames(){
    const vertices=[];for(let z of [-1,1])for(let y of [-1,1])for(let x of [-1,1])vertices.push([x,y,z]);
    const edges=[];for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if(vertices[i].filter((v,k)=>v!==vertices[j][k]).length===1)edges.push([i,j]);
    return Array.from({length:COUNT},(_,frame)=>{
        const t=frame/COUNT*Math.PI*2,ax=t+.45,ay=2*t+.6,az=3*t+.15;
        const points=vertices.map(([x,y,z])=>{
            [y,z]=[y*Math.cos(ax)-z*Math.sin(ax),y*Math.sin(ax)+z*Math.cos(ax)];
            [x,z]=[x*Math.cos(ay)+z*Math.sin(ay),-x*Math.sin(ay)+z*Math.cos(ay)];
            [x,y]=[x*Math.cos(az)-y*Math.sin(az),x*Math.sin(az)+y*Math.cos(az)];
            return [Math.round(11.5+x*5.5),Math.round(11.5+y*5.5),z];
        });
        const pixels=new Uint8Array(SIZE*SIZE);
        for(const [a,b]of edges){
            let [x,y]=points[a];const [tx,ty]=points[b];
            const shade=Math.round(115+140*Math.max(0,Math.min(1,((points[a][2]+points[b][2])/2+1.74)/3.48)));
            const dx=Math.abs(tx-x),dy=-Math.abs(ty-y),sx=x<tx?1:-1,sy=y<ty?1:-1;let error=dx+dy;
            while(true){if(x>=0&&x<SIZE&&y>=0&&y<SIZE)pixels[y*SIZE+x]=Math.max(pixels[y*SIZE+x],shade);if(x===tx&&y===ty)break;const e=2*error;if(e>=dy){error+=dy;x+=sx;}if(e<=dx){error+=dx;y+=sy;}}
        }
        return pixels;
    });
}
function sync(){
    if(timer){Mainloop.source_remove(timer);timer=0;}
    if(!active||!area||!area.mapped)return;
    area.queue_repaint();
    timer=Mainloop.timeout_add(Math.round(1000/FPS),()=>{
        if(!active||!area||!area.mapped){timer=0;return false;}
        area.queue_repaint();return true;
    });
}
function attach(){
    retry=0;if(!active)return false;
    const target=AppletManager.get_object_for_uuid('menu@cinnamon.org','menu@cinnamon.org');
    if(!target){retry=Mainloop.timeout_add_seconds(2,attach);return false;}
    menu=target;original=menu._applet_icon_box.get_child();
    area=new St.DrawingArea({width:SIZE,height:SIZE,reactive:false});
    area.connect('repaint',()=>{
        const cr=area.get_context(),[w,h]=area.get_surface_size();
        const data=frames[Math.floor(GLib.get_monotonic_time()/1000000*FPS)%COUNT];
        cr.scale(w/SIZE,h/SIZE);
        for(let i=0;i<data.length;i++)if(data[i]){const v=data[i]/255;cr.setSourceRGBA(v*.92,v*.95,v,1);cr.rectangle(i%SIZE,Math.floor(i/SIZE),1,1);cr.fill();}
        cr.$dispose();
    });
    area.connect('notify::mapped',sync);
    area.connect('destroy',()=>{if(timer){Mainloop.source_remove(timer);timer=0;}area=null;});
    menu._applet_icon_box.set_child(area);
    destroyId=menu.actor.connect('destroy',()=>{menu=null;original=null;destroyId=0;if(active&&!retry)retry=Mainloop.timeout_add_seconds(2,attach);});
    sync();return false;
}
function init(){}
function enable(){active=true;frames=makeFrames();attach();}
function disable(){
    active=false;if(timer)Mainloop.source_remove(timer);timer=0;if(retry)Mainloop.source_remove(retry);retry=0;
    if(menu){if(destroyId)menu.actor.disconnect(destroyId);if(area)menu._applet_icon_box.set_child(original);if(area)area.destroy();menu._updateIconAndLabel();}
    area=null;menu=null;original=null;destroyId=0;frames=[];
}
