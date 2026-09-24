import fs from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function installInventoryDisplay(bot,log=()=>{},enabled=true){
 let show=false;const click=bot.clickWindow.bind(bot),craft=bot.craft.bind(bot),putAway=bot.putAway.bind(bot);let serial=0;
 async function ui(kind){if(!enabled)return;const cmd=Date.now()+'-'+serial+++' '+kind;fs.writeFileSync('native-client/ui-command.txt',cmd);const end=Date.now()+3000;while(Date.now()<end){if(fs.existsSync('native-client/ui-ack.txt')&&fs.readFileSync('native-client/ui-ack.txt','utf8').trim()===cmd)return;await sleep(50);}throw Error('Native inventory display did not acknowledge '+kind);}
 bot.putAway=async(slot)=>{if(show&&slot===0)await sleep(100);return putAway(slot);};
 bot.clickWindow=async(...args)=>{return click(...args);};
 bot.craft=async(...args)=>{show=true;log('inventory_display',{kind:'craft',state:'open'});try{if(!args[2])await ui('inventory');await craft(...args);await sleep(100);}finally{await ui('close');show=false;log('inventory_display',{kind:'craft',state:'close'});}};
 return {async review(ms=400){log('inventory_display',{kind:'inventory',state:'open'});await ui('inventory');await sleep(ms);await ui('close');log('inventory_display',{kind:'inventory',state:'close'});},async chestOpened(){show=true;log('inventory_display',{kind:'chest',state:'open'});await sleep(100);},async chestClosing(){await sleep(100);show=false;log('inventory_display',{kind:'chest',state:'close'});}};
}
