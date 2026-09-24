import mineflayer from 'mineflayer';import {writeFileSync} from 'node:fs';import {Vec3} from 'vec3';
const b=mineflayer.createBot({host:'127.0.0.1',port:25577,username:'LabBot',version:'1.16.5'});
b.on('error',console.error);b.on('spawn',async()=>{await b.waitForChunksToLoad();console.log('SPAWN',b.game.dimension,b.entity.position);});
setInterval(()=>{if(!b.entity)return;const d=Object.values(b.entities).find(e=>e.name==='ender_dragon');writeFileSync('combat-lab/state.json',JSON.stringify({position:b.entity.position,health:b.health,dimension:b.game.dimension,dragon:d?{id:d.id,position:d.position,yaw:d.yaw,metadata:d.metadata}:null,bedrock:b.game.dimension==='the_end'?b.findBlocks({matching:b.registry.blocksByName.bedrock.id,maxDistance:30,count:70}):[]},null,2));},500);
