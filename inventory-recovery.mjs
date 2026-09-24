import itemFactory from 'prismarine-item';
// Java 1.16 sends carried-item corrections in a special window -1 packet.
// Mineflayer's normal slot handler ignores that packet because no window has id -1.
export function installCursorSync(bot,log=()=>{}){const Item=itemFactory(bot.version);bot._client.on('set_slot',packet=>{if(packet.windowId!==-1||packet.slot!==-1)return;const w=bot.currentWindow||bot.inventory;if(!w)return;w.selectedItem=Item.fromNotch(packet.item);log('cursor_sync',{windowId:w.id,item:w.selectedItem?.name||null,count:w.selectedItem?.count||0});});}
export async function recoverCursor(bot){await new Promise(r=>setTimeout(r,150));const w=bot.currentWindow||bot.inventory;if(w.selectedItem)await bot.putSelectedItemRange(w.inventoryStart,w.inventoryEnd,w);}
