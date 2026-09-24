import itemFactory from 'prismarine-item';
import {angleDelta} from './camera-control.mjs';
import mc from 'minecraft-protocol';
import {existsSync,statSync,readFileSync} from 'node:fs';
export function captureHeartbeatGuard(read,now=Date.now){let last=0;return ()=>{try{const h=read();if(h.encoderAlive&&h.frames>0)last=Math.max(last,h.time);}catch{}return last>0&&now()-last<8000;};}
// Local mode waits for the client's resources-ready.txt. A remote client (NATIVE_MIRROR_REMOTE=1) writes that file on its own machine, so a fixed delay after login stands in for it.
export function mirrorOptions(env=process.env){
 const remote=env.NATIVE_MIRROR_REMOTE==='1';
 return {host:env.NATIVE_MIRROR_HOST||'127.0.0.1',port:Number(env.NATIVE_MIRROR_PORT||25578),remote,readyDelayMs:Number(env.NATIVE_MIRROR_READY_DELAY_MS||20000)};
}
export function resourcesReadyCheck({remote,readyDelayMs},connectedAt,{exists=existsSync,now=Date.now}={}){
 return remote?()=>now()-connectedAt>=readyDelayMs:()=>exists('native-client/resources-ready.txt');
}
export function installNativeMirror(bot,options={}){
 const {host,port,remote,readyDelayMs}={...mirrorOptions(),...options};
 const Item=itemFactory('1.16.5');
 const server=mc.createServer({host,port,version:'1.16.5','online-mode':false,keepAlive:true,motd:'Read-only agent view',maxPlayers:1});
 console.log(`Native mirror listening on ${host}:${port}${remote?` (remote client, ${readyDelayMs} ms resource delay)`:''}`);
 const healthyRecording=captureHeartbeatGuard(()=>JSON.parse(readFileSync('native-client/capture-heartbeat.json','utf8')));
 const base=new Map(),chunks=new Map(),lights=new Map(),blocks=new Map(),spawns=new Map(),metadata=new Map(),other=[];let viewer=null,teleportId=100000,joined=false;
 const skip=new Set(['keep_alive','kick_disconnect','compress','success','encryption_begin']);
 const basic=new Set(['login','respawn','spawn_position','difficulty','abilities','declare_commands','declare_recipes','tags','time','update_health','experience','held_item_slot','window_items','update_view_position','update_view_distance']);
 const spawnNames=new Set(['spawn_entity','spawn_entity_living','named_entity_spawn','spawn_entity_experience_orb','spawn_entity_painting']);
 function send(name,data){if(name==='set_passengers')data={...data,passengers:data.passengers.filter(id=>id!==bot.entity?.id)};if(viewer?.state==='play')try{viewer.write(name,data);}catch(e){console.error('Mirror packet',name,e.message);}}
 function cache(name,d){
  if(basic.has(name)){if(name==='respawn'){chunks.clear();lights.clear();blocks.clear();spawns.clear();metadata.clear();}base.set(name,d);}
  if(name==='map_chunk')chunks.set(d.x+','+d.z,d);
  if(name==='update_light')lights.set(d.chunkX+','+d.chunkZ,d);
  if(name==='unload_chunk'){chunks.delete(d.chunkX+','+d.chunkZ);lights.delete(d.chunkX+','+d.chunkZ);}
  if(name==='block_change')blocks.set(JSON.stringify(d.location),d);
  if(spawnNames.has(name))spawns.set(d.entityId,[name,d]);
  if(name==='entity_destroy')for(const id of d.entityIds){spawns.delete(id);metadata.delete(id);}
  if(name==='entity_metadata'){const old=metadata.get(d.entityId)||new Map();for(const m of d.metadata)old.set(m.key,m);metadata.set(d.entityId,old);}
  if(['player_info','advancements','set_slot','entity_equipment','multi_block_change','block_entity_data'].includes(name)){other.push([name,d]);if(other.length>10000)other.splice(0,1000);}
 }
 bot._client.on('packet',(data,meta)=>{if(meta.state!=='play'||skip.has(meta.name)||meta.name==='position')return;cache(meta.name,data);send(meta.name,data);});
 let camera=null;function position(){if(!bot.entity)return;const p=bot.entity.position,previous=camera;camera={yaw:bot.entity.yaw,pitch:bot.entity.pitch};if(previous)bot.emit('nativeCameraTurn',{degrees:Math.hypot(angleDelta(camera.yaw,previous.yaw),camera.pitch-previous.pitch)*180/Math.PI});send('position',{x:p.x,y:p.y,z:p.z,yaw:(180-camera.yaw*180/Math.PI)%360,pitch:-camera.pitch*180/Math.PI,flags:0,teleportId:teleportId++});}
 server.on('login',client=>{
  console.log('Native display connected from',client.socket?.remoteAddress,'; allow resource loading');
  const resourcesReady=resourcesReadyCheck({remote,readyDelayMs},Date.now());
  setTimeout(async()=>{const deadline=Date.now()+Math.max(120000,readyDelayMs+60000);while(!resourcesReady()||!bot.entity||!base.has('login')||chunks.size===0){if(client.ended)return;if(Date.now()>deadline){client.end('Native resources failed to load');return;}await new Promise(r=>setTimeout(r,250));}if(client.ended)return;viewer=client;
   for(const [name,data] of base)send(name,data);
   send('update_view_position',{chunkX:Math.floor(bot.entity.position.x/16),chunkZ:Math.floor(bot.entity.position.z/16)});position();
   for(const data of chunks.values())send('map_chunk',data);
   for(const data of lights.values())send('update_light',data);
   for(const data of blocks.values())send('block_change',data);
   for(const [name,data] of other.filter(([n])=>n==='player_info'))send(name,data);
   for(const [id,[name,data]] of spawns){send(name,data);const e=bot.entities[id];if(e){send('entity_teleport',{entityId:id,x:e.position.x,y:e.position.y,z:e.position.z,yaw:(Math.round((Math.PI-e.yaw)*128/Math.PI)<<24)>>24,pitch:(Math.round(-e.pitch*128/Math.PI)<<24)>>24,onGround:!!e.onGround});}}
   for(const [id,m] of metadata)send('entity_metadata',{entityId:id,metadata:[...m.values()]});
   for(const [name,data] of other.filter(([n])=>n!=='player_info'))send(name,data);
   send('held_item_slot',{slot:bot.quickBarSlot});position();setTimeout(()=>{if(viewer===client&&!client.ended){joined=true;console.log('Native read-only viewer ready');bot.emit('nativeViewReady');}},3000);
  },500);
  client.on('end',reason=>{console.log('Native viewer ended:',reason);if(viewer===client){viewer=null;const was=joined;joined=false;if(was)bot.emit('nativeViewLost',{reason:String(reason)});}});client.on('error',e=>console.error('Native viewer:',e.message));
 });
 const originalWrite=bot._client.write.bind(bot._client);
 bot._client.write=(name,data)=>{if(name==='close_window')send('close_window',data);if(name==='held_item_slot')send('held_item_slot',{slot:data.slotId});if(name==='vehicle_move'&&bot.vehicle)send('entity_teleport',{entityId:bot.vehicle.id,x:data.x,y:data.y,z:data.z,yaw:(Math.round(data.yaw*256/360)<<24)>>24,pitch:(Math.round(data.pitch*256/360)<<24)>>24,onGround:false});if(name==='steer_boat'&&bot.vehicle)send('entity_metadata',{entityId:bot.vehicle.id,metadata:[{key:11,type:7,value:data.leftPaddle},{key:12,type:7,value:data.rightPaddle}]});if(name==='arm_animation'&&bot.entity)send('animation',{entityId:bot.entity.id,animation:data.hand===1?3:0});return originalWrite(name,data);};
 let dig=null,digAt=0,inventoryAt=0;const interval=setInterval(()=>{position();if(Date.now()-inventoryAt>100){inventoryAt=Date.now();const w=bot.currentWindow||bot.inventory;if(w){send('window_items',{windowId:w.id,items:w.slots.map(i=>Item.toNotch(i))});send('set_slot',{windowId:-1,slot:-1,item:Item.toNotch(w.selectedItem)});}}const b=bot.targetDigBlock;if(b!==dig){if(dig)send('block_break_animation',{entityId:bot.entity.id,location:dig.position,destroyStage:-1});dig=b;digAt=Date.now();}if(dig)send('block_break_animation',{entityId:bot.entity.id,location:dig.position,destroyStage:Math.min(9,Math.floor((Date.now()-digAt)/Math.max(100,bot.digTime(dig))*10))});},20);bot.on('end',()=>clearInterval(interval));
 return {get ready(){return joined;},get captureHealthy(){if(!joined)return false;if(existsSync('native-client/record-path.txt'))return healthyRecording();try{return Date.now()-statSync('native-client/native-preview.png').mtimeMs<8000;}catch{return false;}},close(){clearInterval(interval);server.close();}};
}
