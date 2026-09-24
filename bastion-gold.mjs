import {Vec3} from 'vec3';
import {coveredWalk,coveredRise,coveredDescent} from './covered-shaft.mjs';
const count=(bot,name='gold_block')=>bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
async function workGoldStep(bot,target,log=()=>{}){
 const sourceName=target?bot.blockAt(target)?.name:null,product=sourceName==='nether_gold_ore'?'gold_nugget':'gold_block';
 bot.goldWork ||= {target:{x:target.x,y:target.y,z:target.z},sourceName:sourceName||'gold_block',product,before:count(bot,product),returnHeight:Math.floor(bot.entity.position.y),phase:'approach'};
 const work=bot.goldWork,q=new Vec3(work.target.x,work.target.y,work.target.z),p=bot.entity.position.floored();
 if(bot.blockAt(q)?.name!==(work.sourceName||'gold_block')){
  await bot.waitForTicks(5);
  if(count(bot,work.product)>work.before){const gained=count(bot,work.product)-work.before;log('protected_gold_collected',{position:q,count:gained,product:work.product||'gold_block',remainAtCollectionHeight:true});bot.goldWork=null;return 'Collected gold; keep the current protected position for the next target';}
  if(count(bot,work.product)<=work.before)log('protected_gold_uncollected',{position:q,reason:'Block removed but pickup not confirmed; return to cover and select another action'});
  work.phase='return';
 }
 if(work.phase==='return'){
  if(p.y>work.returnHeight)return coveredDescent(bot,work.returnHeight,log);
  if(p.y<work.returnHeight)return coveredRise(bot,work.returnHeight,log);
  const gained=count(bot,work.product)-work.before;log(gained>0?'protected_gold_collected':'protected_gold_returned',{position:q,count:gained});bot.goldWork=null;return gained>0?'Collected gold and returned to the protected corridor height':'Returned to cover without confirming the gold pickup';
 }
 if(p.x!==q.x||p.z!==q.z)return coveredWalk(bot,new Vec3(q.x,p.y,q.z),log);
 if(q.y<p.y)return coveredDescent(bot,q.y,log);
 if(q.y>=p.y+2)return coveredRise(bot,q.y-1,log);
 const pick=bot.inventory.items().find(i=>i.name==='iron_pickaxe');if(!pick)throw Error('Gold requires the reserved iron pickaxe');await bot.equip(pick,'hand');await bot.dig(bot.blockAt(q),true);await bot.waitForTicks(5);return 'Mined the selected gold block from cover';
}
export function goldWorkActions(bot,add,log,{needed=true}={}){if(!bot.goldWork)return false;if(!needed){add('finish_gold_batch','Stop gold collection because the required barter supplies are complete',()=>{log('gold_work_cancelled',{reason:'Barter ingredients complete'});bot.goldWork=null;});return true;}if(bot.inventory.items().filter(i=>i.name==='gold_ingot').reduce((n,i)=>n+i.count,0)>=64||(bot.goldBatchReady&&bot.goldWork.sourceName==='nether_gold_ore')){add('finish_gold_batch','Keep the current covered position and stop gold collection; the barter batch is ready',()=>{log('gold_batch_ready',{abandonedTarget:bot.goldWork.target});bot.goldWork=null;bot.goldBatchReady=true;});return true;}add('continue_protected_gold','Continue the selected protected gold collection at '+JSON.stringify(bot.goldWork.target),()=>workGold(bot,null,log));return true;}

export async function workGold(bot,target,log=()=>{}){
 try{return await workGoldStep(bot,target,log);}catch(e){
  if(bot.goldWork?.sourceName==='nether_gold_ore'&&/Unsafe shaft boundary|Shaft lining has no support/.test(e.message)){
   const q=bot.goldWork.target;bot.blockedGoldTargets ||= new Map();bot.blockedGoldTargets.set(`${q.x},${q.y},${q.z}`,Date.now()+300000);bot.goldWork=null;
   if(count(bot,'gold_ingot')>0)bot.goldBatchReady=true;
   log('gold_route_blocked',{target:q,reason:e.message,useCarriedGold:bot.goldBatchReady});return 'Gold route is blocked; select another ore target or trade the carried gold';
  }throw e;
 }
}
