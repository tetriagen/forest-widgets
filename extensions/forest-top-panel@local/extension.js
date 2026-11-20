const Main=imports.ui.main;
const Mainloop=imports.mainloop;
let styled=[],signals=[],idle=0;
let clocks=[],watched=[];
function styleClocks(actor){
    if(actor._applet && actor._applet._uuid === "calendar@cinnamon.org"){
        actor.add_style_class_name("forest-desktop-clock");
        if(!clocks.includes(actor))clocks.push(actor);
    }
    if(actor.get_children)for(const child of actor.get_children())styleClocks(child);
}
function schedule(){if(!idle)idle=Mainloop.idle_add(()=>{idle=0;attach();return false;});}
function attach(){
    for(const panel of Main.getPanels()){
        if(!panel||panel.panelId!==1)continue;
        if(!styled.includes(panel.actor)){
            styled.push(panel.actor);
            signals.push([panel.actor,panel.actor.connect('style-changed',()=>{
                if(!panel.actor.has_style_class_name('forest-top-panel'))schedule();
            })]);
        }
        if(!panel.actor.has_style_class_name('forest-top-panel'))panel.actor.add_style_class_name('forest-top-panel');
        panel.actor.set_style('background: #111216; background-color: #111216; border-bottom: 1px solid #33353a; color: #eeeeee; font-family: "Ndot"; font-size: 14px;');
        styleClocks(panel.actor);
        for(const box of [panel._leftBox,panel._centerBox,panel._rightBox]){
            if(box && !watched.includes(box)){watched.push(box);signals.push([box,box.connect('actor-added',schedule)]);}
        }
    }
}
function init(){}
function enable(){attach();signals.push([global.settings,global.settings.connect('changed::panels-enabled',schedule)]);}
function disable(){
    for(const [obj,id]of signals)try{obj.disconnect(id);}catch(_){}signals=[];
    if(idle)Mainloop.source_remove(idle);idle=0;
    for(const actor of styled)try{actor.remove_style_class_name('forest-top-panel');}catch(_){}
    styled=[];
    for(const actor of clocks)try{actor.remove_style_class_name("forest-desktop-clock");}catch(_){}
    clocks=[];watched=[];
}
