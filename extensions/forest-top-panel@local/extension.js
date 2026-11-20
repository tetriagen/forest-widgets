const Main=imports.ui.main;
const Mainloop=imports.mainloop;
let styled=[],signals=[],idle=0;
let clocks=[],watched=[],keyboardLabels=[];
function styleClocks(actor){
    if(actor._applet && actor._applet._uuid === "keyboard@cinnamon.org"){
        const box=actor._applet._panel_icon_box;
        if(box){
            const label=box.get_child();
            if(label && label.get_text){
                if(!keyboardLabels.some(item=>item.actor===label)){keyboardLabels.push({actor:label,style:label.get_style(),text:label.get_text()});label.connect("destroy",()=>{keyboardLabels=keyboardLabels.filter(item=>item.actor!==label);});}
                label.set_style('font-family: Manrope; font-size: 14px; font-weight: bold; letter-spacing: 0; color: #eeeeee; min-width: 28px; text-align: center;');
                const name=label.get_text().toUpperCase();label.set_text(name==='US'?'EN':name);
            }
            if(!watched.includes(box)){watched.push(box);signals.push([box,box.connect('actor-added',schedule)]);}
        }
    }
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
        panel.actor.set_style('background: #111216; background-color: #111216; border-bottom: 1px solid #33353a; color: #eeeeee; font-family: "Manrope"; font-size: 14px;');
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
    for(const item of keyboardLabels)try{item.actor.set_style(item.style);item.actor.set_text(item.text);}catch(_){}
    keyboardLabels=[];clocks=[];watched=[];
}
