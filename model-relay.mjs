// Keys come from the environment (see models.mjs). Never log credentials or request bodies.
import http from 'node:http';
import {endpoints,callEndpoint} from './models.mjs';
for(const [kind,endpoint] of Object.entries(endpoints))if(!endpoint.key)throw Error(`Missing ${endpoint.keyVar} for the ${kind} endpoint`);
async function call(kind,body){
 const started=Date.now(),controllers=[new AbortController(),new AbortController()];let timer;
 const attempt=async index=>({index,data:await callEndpoint(kind,body,AbortSignal.any([controllers[index].signal,AbortSignal.timeout(60000)]))});
 try{const a=attempt(0),b=new Promise((resolve,reject)=>{timer=setTimeout(()=>attempt(1).then(resolve,reject),kind==='decision'?3000:10000);});const winner=await Promise.any([a,b]);clearTimeout(timer);controllers[1-winner.index].abort();return {data:winner.data,latencyMs:Date.now()-started};}finally{clearTimeout(timer);controllers.forEach(c=>c.abort());}
}
http.createServer(async(req,res)=>{try{let input='';for await(const chunk of req){input+=chunk;if(input.length>2000000)throw Error('Request too large');}const {kind,body}=JSON.parse(input);if(!Object.hasOwn(endpoints,kind))throw Error('Unsupported model endpoint');const result=await call(kind,body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}catch(e){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.errors?.at(-1)?.message||e.message}));}}).listen(3099,'127.0.0.1',()=>console.log(`Local model relay ready: planner ${endpoints.planner.url} (${endpoints.planner.model}), decision ${endpoints.decision.url} (${endpoints.decision.model}).`));
