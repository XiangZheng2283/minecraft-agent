// Keep game actions independent of planner response time after the initial plan.
export function asyncPlanner({getState, plan, onPlan, log=()=>{}, intervalMs=15000, now=Date.now}) {
 let pending=null, lastStage=null, lastStarted=-Infinity, closed=false;
 function refresh(force=false) {
  if(closed||pending)return pending;
  const state=getState(), at=now();
  if(!force&&state.stage===lastStage&&at-lastStarted<intervalMs)return null;
  lastStarted=at;lastStage=state.stage;
  log('planner_request',{stage:state.stage,step:state.steps,background:true});
  pending=Promise.resolve().then(()=>plan(state)).then(result=>{
   if(closed)return;
   if(getState().stage!==state.stage){lastStarted=-Infinity;log('plan_discarded',{reason:'Stage changed during request',stage:state.stage});return;}
   onPlan(result);log('planner_ready',{stage:state.stage,step:state.steps,wallMs:now()-at});
   return result;
  }).catch(error=>{log('plan_error',{error:error.message,background:true});lastStarted=now()-intervalMs+3000;}).finally(()=>{pending=null;});
  return pending;
 }
 return {refresh,close(){closed=true;},get pending(){return pending;}};
}
