import {test} from 'node:test';
import assert from 'node:assert/strict';
import mc from 'minecraft-protocol';
import {mirrorOptions,resourcesReadyCheck} from './native-mirror.mjs';
test('mirror defaults to loopback and local readiness file',()=>{
 assert.deepEqual(mirrorOptions({}),{host:'127.0.0.1',port:25578,remote:false,readyDelayMs:20000});
 let asked=null;const ready=resourcesReadyCheck({remote:false,readyDelayMs:0},0,{exists:p=>{asked=p;return true;}});
 assert.equal(ready(),true);assert.equal(asked,'native-client/resources-ready.txt');
});
test('remote mirror listens on the given host and waits a fixed delay instead of the file',()=>{
 const o=mirrorOptions({NATIVE_MIRROR_HOST:'0.0.0.0',NATIVE_MIRROR_PORT:'25600',NATIVE_MIRROR_REMOTE:'1',NATIVE_MIRROR_READY_DELAY_MS:'5000'});
 assert.deepEqual(o,{host:'0.0.0.0',port:25600,remote:true,readyDelayMs:5000});
 let t=1000;const ready=resourcesReadyCheck(o,1000,{exists:()=>{throw Error('must not read the file');},now:()=>t});
 assert.equal(ready(),false);t=5999;assert.equal(ready(),false);t=6000;assert.equal(ready(),true);
});
test('native view rotation, paddle and digging packets serialize in Minecraft 1.16.5',()=>{
 const serializer=mc.createSerializer({state:'play',isServer:true,version:'1.16.5'});let count=0;serializer.on('error',e=>{throw e;});serializer.on('data',()=>count++);
 for(let degrees=0;degrees<=360;degrees+=45)serializer.write({name:'entity_teleport',params:{entityId:1,x:0,y:63,z:0,yaw:(Math.round(degrees*256/360)<<24)>>24,pitch:0,onGround:false}});
 serializer.write({name:'entity_metadata',params:{entityId:1,metadata:[{key:11,type:7,value:true},{key:12,type:7,value:false}]}});
 serializer.write({name:'block_break_animation',params:{entityId:1,location:{x:0,y:63,z:0},destroyStage:-1}});assert.equal(count,11);
});
