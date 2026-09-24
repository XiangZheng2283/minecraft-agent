import mineflayer from 'mineflayer';
import {Vec3} from 'vec3';
const bot=mineflayer.createBot({host:'127.0.0.1',port:25577,username:'Surveyor',version:'1.16.5'});
bot.once('spawn',async()=>{await bot.waitForChunksToLoad();setTimeout(()=>{for(let y=58;y<=65;y++){console.log('Y',y);for(let z=-3;z<=3;z++)console.log(Array.from({length:7},(_,i)=>{let b=bot.blockAt(new Vec3(i-3,y,z));return b?.name==='air'?'.':b?.name==='bedrock'?'B':b?.name==='obsidian'?'O':b?.name?.slice(0,1)||'?'}).join(''));}bot.quit();},8000);});
