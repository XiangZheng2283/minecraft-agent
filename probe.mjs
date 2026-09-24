import {writeFileSync} from 'node:fs';
import {request,endpoints} from './models.mjs';
for (const [kind,body] of [
['decision',{model:endpoints.decision.model,state:'Minecraft survival. Health 20. A log is within reach. No tools or wood. Goal: get wood for tools.',questions:{action:{type:'choice',instructions:'Select the next player action.',criteria:{mine_log:'Break the nearby log to get wood.',wait:'Stand still.'}}}}],
['planner',{model:endpoints.planner.model,messages:[{role:'user',content:'Reply with JSON {"objective":"ok"} to confirm the Minecraft planner endpoint works.'}],max_tokens:200,response_format:{type:'json_object'}}]
]) {
 try{const r=await request(kind,body);writeFileSync(`research/${kind}-probe.json`,JSON.stringify(r.data,null,2));console.log(kind,'OK',endpoints[kind].url,r.latencyMs+'ms',JSON.stringify(kind==='decision'?r.data.answers:r.data.choices?.[0]?.message?.content));}
 catch(e){console.log(kind,'FAILED',endpoints[kind].url,e.message);process.exitCode=1;}
}
