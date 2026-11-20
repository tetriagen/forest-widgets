const Applet=imports.ui.applet;
const Mainloop=imports.mainloop;
class Memory extends Applet.TextApplet {
 constructor(o,h,id){super(o,h,id);this.actor.add_style_class_name('forest-memory');this.actor.set_style('font-family: Manrope; font-size: 14px; color: #eeeeee;');this.set_applet_tooltip('Использование RAM и VRAM');this.update();this.timer=Mainloop.timeout_add_seconds(5,()=>{this.update();return true;});}
 update(){const item=imports.ui.deskletManager.definitions.find(x=>x.uuid==='forest-resources@local');const v=item&&item.desklet&&item.desklet.values;const label='RAM '+(v?v.ram.get_text():'—')+'   VRAM '+(v?v.vram.get_text():'—');if(label!==this.lastLabel){this.lastLabel=label;this.set_applet_label(label);}}
 on_applet_removed_from_panel(){if(this.timer)Mainloop.source_remove(this.timer);this.timer=0;}
}
function main(m,o,h,id){return new Memory(o,h,id);}
