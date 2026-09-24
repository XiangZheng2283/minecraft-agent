import mineflayer from 'mineflayer';
const b=mineflayer.createBot({host:'127.0.0.1',port:25576,username:'JevAstra',version:'1.16.5'});
b.on('error',console.error);b.on('kicked',console.log);
b.once('spawn',async()=>{await b.waitForChunksToLoad(); console.log('SPAWN',b.entity.position,b.game);for(const regex of [/log$/,/bed$/,/chest/,/hay_block/,/iron_ore/,/stone$/])console.log(String(regex),b.findBlocks({matching:x=>regex.test(x.name),maxDistance:100,count:12}).map(p=>({pos:p,name:b.blockAt(p).name})));b.quit();});
