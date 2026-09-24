import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openKnowledge,embedConfigFromEnv,rerankConfigFromEnv,chunkMarkdown} from './knowledge.mjs';

const root=mkdtempSync(join(tmpdir(),'knowledge-test-'));
after(()=>rmSync(root,{recursive:true,force:true}));
let n=0;
const dbPath=()=>join(root,`k${++n}`,'kb.db'); // nested dir also checks parent creation
const open=(opts={})=>openKnowledge({path:dbPath(),embed:null,rerank:null,...opts});
const repoKnowledgeDir=join(dirname(fileURLToPath(import.meta.url)),'..','data','knowledge');

// Deterministic bag-of-letters embeddings: 26 letter counts + 1 constant so no vector is all zero.
const bag=s=>{const v=new Array(27).fill(0);v[26]=0.01;for(const c of s.toLowerCase()){const i=c.charCodeAt(0)-97;if(i>=0&&i<26) v[i]++;}return v;};
const json=(body,status=200)=>({ok:status<300,status,json:async()=>body,text:async()=>JSON.stringify(body)});
function fakeApi({failEmbed=false,rerankMode='reverse'}={}){
  const api={calls:[],inFlight:0,maxInFlight:0,failEmbed,rerankMode};
  api.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    api.calls.push({url,headers:init.headers,body});
    api.inFlight++;api.maxInFlight=Math.max(api.maxInFlight,api.inFlight);
    await new Promise(r=>setTimeout(r,5));
    api.inFlight--;
    if(url.endsWith('/embeddings')){
      if(api.failEmbed) throw new Error('embed service down');
      return json({data:body.input.map((s,index)=>({index,embedding:bag(s)})).reverse()});
    }
    if(url.endsWith('/rerank')){
      if(api.rerankMode==='fail') return json({error:'nope'},500);
      const k=body.documents.length;
      return json({results:body.documents.map((_,index)=>({index,relevance_score:index/k}))}); // last doc scores highest
    }
    throw new Error('unexpected url '+url);
  };
  return api;
}
const embedCfg={baseUrl:'http://embed.test/v1/',apiKey:'sk-e',model:'bag-27'};
const rerankCfg={baseUrl:'http://rerank.test',apiKey:'',model:'rev'};

test('config from env',()=>{
  assert.equal(embedConfigFromEnv({}),null);
  assert.equal(embedConfigFromEnv({EMBED_BASE_URL:'http://x'}),null);
  assert.deepEqual(embedConfigFromEnv({EMBED_BASE_URL:'http://x',EMBED_MODEL:'m',EMBED_API_KEY:'k'}),{baseUrl:'http://x',apiKey:'k',model:'m'});
  assert.equal(rerankConfigFromEnv({RERANK_MODEL:'m'}),null);
  assert.deepEqual(rerankConfigFromEnv({RERANK_BASE_URL:'http://r',RERANK_MODEL:'m'}),{baseUrl:'http://r',apiKey:'',model:'m'});
});

test('keyword search: trigram, CJK, short-term LIKE fallback, filters',async()=>{
  const k=open();
  const table=k.add({source:'note',title:'工作台',text:'先用四个木板合成工作台，然后做木镐。',tags:['zh']});
  const wood=k.add({source:'note',text:'砍树获得木头是第一步。'});
  const creeper=k.add({source:'note',title:'Creepers',text:'Creepers explode; keep distance.',bot:'alice'});
  const lava=k.add({source:'strategy',text:'Never dig straight down into lava.',bot:'bob'});

  let r=await k.search('工作台');
  assert.equal(r[0].id,table);assert.equal(r[0].via,'keyword');assert.deepEqual(r[0].tags,['zh']);
  r=await k.search('怎么合成工作台'); // unsegmented CJK sentence still matches via its trigrams
  assert.equal(r[0].id,table);
  r=await k.search('木头'); // 2 chars: trigram can't match, LIKE fallback does
  assert.deepEqual(r.map(d=>d.id),[wood]);
  r=await k.search('creeper explode');
  assert.equal(r[0].id,creeper);
  assert.deepEqual((await k.search('lava',{source:'note'})),[]);
  assert.deepEqual((await k.search('lava',{bot:'alice'})),[]);
  assert.equal((await k.search('lava',{bot:'bob'}))[0].id,lava);
  assert.equal((await k.search('creepers',{bot:'bob'})).length,0);
  assert.deepEqual(await k.search('"quoted" OR (weird* ^'),[]); // sanitized, no FTS syntax error
  assert.deepEqual(await k.search('   '),[]);
  assert.equal((await k.search('100%_x')).length,0);
  k.close();
});

test('other bots can recall shared experience without exposing their private records',async()=>{
  const k=open();
  try {
    const experience=k.add({source:'experience',title:'Safe lava crossing',text:'Place cobblestone before crossing lava.',tags:['shared'],bot:'miner'});
    const legacy=k.add({source:'experience',title:'Legacy owner request',text:'Place cobblestone before crossing lava.',tags:['success'],bot:'miner'});
    const privateNote=k.add({source:'note',title:'Private owner instruction',text:'Place cobblestone before crossing lava.',bot:'miner'});
    const privateMemory=k.add({source:'memory',title:'Private base',text:'Place cobblestone before crossing lava.',bot:'miner'});
    const recipe=k.add({source:'recipe',title:'Crafting cobblestone',text:'Place cobblestone before crossing lava.'});
    const strategy=k.add({source:'strategy',title:'Lava strategy',text:'Place cobblestone before crossing lava.'});

    const recalled=await k.search('cobblestone before crossing lava',{bot:'helper',limit:10});
    assert.deepEqual(new Set(recalled.map(d=>d.id)),new Set([experience,recipe,strategy]));
    assert.equal(recalled.find(d=>d.id===experience).bot,'miner');
    assert.deepEqual(await k.search('private owner instruction',{source:'note',bot:'helper'}),[]);
    assert.deepEqual(await k.search('private base',{source:'memory',bot:'helper'}),[]);
    assert.equal((await k.search('safe lava crossing',{source:'experience',bot:'helper'}))[0].id,experience);
    assert.deepEqual(await k.search('legacy owner request',{source:'experience',bot:'helper'}),[]);
    assert.equal((await k.search('legacy owner request',{source:'experience',bot:'miner'}))[0].id,legacy);
    assert.equal((await k.search('private owner instruction',{source:'note',bot:'miner'}))[0].id,privateNote);
    assert.equal((await k.search('private base',{source:'memory',bot:'miner'}))[0].id,privateMemory);
  } finally { k.close(); }
});

test('key upsert updates in place',async()=>{
  const k=open();
  const id=k.add({source:'memory',key:'base',text:'Base is at 10 64 20'});
  assert.equal(k.add({source:'memory',key:'base',text:'Base moved to -300 70 55',tags:['home']}),id);
  assert.equal(k.stats().docs,1);
  assert.deepEqual(await k.search('10 64 20'),[]);
  const [hit]=await k.search('moved');
  assert.equal(hit.id,id);assert.deepEqual(hit.tags,['home']);
  assert.notEqual(k.add({source:'memory',text:'Base is at 10 64 20'}),id); // no key => new row
  assert.deepEqual(k.stats(),{docs:2,embedded:0,bySource:{memory:2}});
  k.close();
});

test('ingestRecipes is idempotent and describes recipes',async()=>{
  const k=open();
  const count=k.ingestRecipes('1.16.5');
  assert.ok(count>300,`expected many recipes, got ${count}`);
  assert.equal(k.ingestRecipes('1.16.5'),count);
  assert.equal(k.stats().bySource.recipe,count);
  let [top]=await k.search('crafting_table',{source:'recipe'});
  assert.equal(top.title,'Crafting Table');
  assert.match(top.text,/^Crafting Crafting Table \(crafting_table\) yields 1: shaped 2x2 grid from 4 oak_planks/);
  assert.match(top.text,/Requires crafting table: no\.$/);
  [top]=await k.search('Crafting Table',{source:'recipe'});
  assert.equal(top.title,'Crafting Table');
  [top]=await k.search('oak_planks',{source:'recipe',limit:1});
  assert.match(top.text,/Crafting Oak Planks \(oak_planks\) yields 4: shapeless from 1 oak_log/);
  [top]=await k.search('furnace',{source:'recipe'});
  assert.equal(top.title,'Furnace');
  assert.match(top.text,/shaped 3x3 grid from 8 cobblestone.*Requires crafting table: yes\./);
  k.close();
});

test('ingestMarkdown chunks by heading, splits long sections, is idempotent, drops stale chunks',async()=>{
  const dir=join(root,'md');mkdirSync(dir,{recursive:true});
  const para=i=>`Paragraph ${i} about mining. `+'x'.repeat(500);
  const long=[1,2,3,4,5].map(para).join('\n\n');
  writeFileSync(join(dir,'guide.md'),`# Guide\n\nIntro text.\n\n## Wood\n\nPunch trees.\n\n## Mining\n\n${long}\n\n## Empty\n\n## Lava\nAvoid lava lakes.\n`);
  writeFileSync(join(dir,'notes.txt'),'ignored');
  const chunks=chunkMarkdown(`# A\n\nx\n\n## B\ny`);
  assert.deepEqual(chunks,[{title:'A',text:'x'},{title:'B',text:'y'}]);

  const k=open();
  const first=k.ingestMarkdown(dir);
  // Guide intro, Wood, Mining x3 (5x~530 chars packed into <=1500), Lava; empty section skipped
  assert.equal(first,6);
  assert.equal(k.ingestMarkdown(dir),first);
  assert.equal(k.stats().bySource.strategy,first);
  const mining=await k.search('mining',{limit:10});
  assert.ok(mining.length>=3&&mining.every(d=>d.title==='Mining'&&d.text.length<=1500));
  const [lava]=await k.search('lava lakes');
  assert.equal(lava.title,'Lava');assert.deepEqual(lava.tags,['markdown','guide.md']);

  writeFileSync(join(dir,'guide.md'),`## Wood\n\nPunch trees and craft planks.\n`);
  assert.equal(k.ingestMarkdown(dir),1);
  assert.equal(k.stats().docs,1);
  assert.deepEqual(await k.search('lava'),[]);
  assert.match((await k.search('planks'))[0].text,/craft planks/);

  const real=k.ingestMarkdown(repoKnowledgeDir);
  assert.ok(real>=10,`strategy.md should give >=10 chunks, got ${real}`);
  const [obs]=await k.search('obsidian diamond pickaxe',{source:'strategy'});
  assert.match(obs.text,/obsidian/i);
  k.close();
});

test('embedding queue batches, persists vectors, and hybrid search fuses keyword+vector',async()=>{
  const api=fakeApi();
  const k=open({embed:embedCfg,fetchImpl:api.fetch});
  for(let i=0;i<40;i++) k.add({source:'filler',text:`filler document number ${i} qqq`});
  const dog=k.add({source:'pets',title:'dog',text:'dog'});
  const god=k.add({source:'pets',title:'odg',text:'odg'});
  const cat=k.add({source:'pets',title:'cat',text:'cat'});
  await k.flush();
  const embedCalls=api.calls.filter(c=>c.url.endsWith('/embeddings'));
  assert.deepEqual(embedCalls.map(c=>c.body.input.length),[32,11]);
  assert.equal(api.maxInFlight,1);
  assert.equal(embedCalls[0].url,'http://embed.test/v1/embeddings');
  assert.equal(embedCalls[0].headers.authorization,'Bearer sk-e');
  assert.equal(embedCalls[0].body.model,'bag-27');
  assert.deepEqual(k.stats(),{docs:43,embedded:43,bySource:{filler:40,pets:3}});

  // "gdo" has no trigram overlap with anything but is an anagram of dog/odg => vector-only hits
  let r=await k.search('gdo',{source:'pets'});
  assert.deepEqual(new Set(r.slice(0,2).map(d=>d.id)),new Set([dog,god]));
  assert.ok(r.every(d=>d.via==='vector'));
  // "dog" matches keyword and vector => ranked first with fused label
  r=await k.search('dog',{source:'pets'});
  assert.equal(r[0].id,dog);assert.equal(r[0].via,'keyword+vector');
  assert.ok(Math.abs(r[0].score-2/61)<1e-12,'RRF: rank 1 in both lists');
  assert.equal(r.find(d=>d.id===cat).via,'vector');

  // text change clears the vector and re-embeds it
  k.add({source:'pets',key:null,title:'x',text:'y'});
  const bird=k.add({source:'pets',key:'bird',text:'bird'});
  k.add({source:'pets',key:'bird',text:'parrot'});
  await k.flush();
  assert.equal(k.stats().embedded,k.stats().docs);
  const last=api.calls.filter(c=>c.url.endsWith('/embeddings')).at(-1).body.input;
  assert.ok(last.includes('parrot')&&!last.includes('bird'));
  assert.equal((await k.search('parrot',{source:'pets'}))[0].id,bird);
  k.close();

  // vectors persist across reopen, nothing re-embedded
  const api2=fakeApi();
  const k2=openKnowledge({path:join(root,`k${n}`,'kb.db'),embed:embedCfg,rerank:null,fetchImpl:api2.fetch});
  await k2.flush();
  assert.equal(api2.calls.length,0);
  assert.equal((await k2.search('gdo',{source:'pets'}))[0].via,'vector');
  k2.close();
});

test('rerank reorders fused results; rerank failure keeps RRF order',async()=>{
  const docs=[['apple pie','apple pie recipe'],['apple tree','grow an apple tree'],['green apple','green apple juice'],['apples','apple apple apple']];
  const setup=opts=>{const k=open(opts);docs.forEach(([title,text])=>k.add({source:'food',title,text}));return k;};

  const plain=setup({embed:embedCfg,fetchImpl:fakeApi().fetch});
  await plain.flush();
  const base=await plain.search('apple',{limit:10});
  assert.equal(base.length,4);
  plain.close();

  const api=fakeApi();
  const k=setup({embed:embedCfg,rerank:rerankCfg,fetchImpl:api.fetch});
  await k.flush();
  const rr=await k.search('apple',{limit:10});
  assert.deepEqual(rr.map(d=>d.title),base.map(d=>d.title).reverse());
  assert.ok(rr.every(d=>d.via==='keyword+vector+rerank'));
  const call=api.calls.find(c=>c.url.endsWith('/rerank'));
  assert.equal(call.url,'http://rerank.test/v1/rerank');
  assert.equal(call.body.query,'apple');assert.equal(call.body.top_n,4);assert.equal(call.body.documents.length,4);
  assert.equal(call.headers.authorization,undefined);

  const logs=[];
  api.rerankMode='fail';
  const k2=setup({embed:embedCfg,rerank:rerankCfg,fetchImpl:api.fetch,log:m=>logs.push(m)});
  await k2.flush();
  const fallback=await k2.search('apple',{limit:10});
  assert.deepEqual(fallback.map(d=>d.title),base.map(d=>d.title));
  assert.ok(fallback.every(d=>d.via==='keyword+vector'));
  assert.ok(logs.some(m=>/rerank failed/.test(m)));
  k.close();k2.close();

  // keyword-only store with rerank
  const k3=setup({rerank:rerankCfg,fetchImpl:fakeApi().fetch});
  const kw=await k3.search('apple',{limit:10});
  assert.ok(kw.every(d=>d.via==='keyword+rerank'));
  k3.close();
});

test('embedding failures never throw from add/search and are retried later',async()=>{
  const logs=[];
  const api=fakeApi({failEmbed:true});
  const k=open({embed:embedCfg,fetchImpl:api.fetch,log:m=>logs.push(m)});
  const id=k.add({source:'note',text:'torches keep mobs away'});
  assert.equal(typeof id,'number');
  await k.flush();
  assert.equal(k.stats().embedded,0);
  const r=await k.search('torches');
  assert.equal(r[0].id,id);assert.equal(r[0].via,'keyword');
  assert.ok(logs.some(m=>/embedding failed/.test(m)));
  assert.ok(logs.some(m=>/query embedding failed/.test(m)));

  // also survives a fetch that rejects synchronously-ish / bad payloads
  const k2=open({embed:embedCfg,fetchImpl:async()=>json({data:[]}),log:()=>{}});
  k2.add({source:'note',text:'abc'});
  await k2.flush();
  assert.equal(k2.stats().embedded,0);
  assert.equal((await k2.search('abc'))[0].via,'keyword');
  k2.close();

  api.failEmbed=false;
  await k.flush(); // retry pending docs
  assert.equal(k.stats().embedded,1);
  assert.equal((await k.search('torches'))[0].via,'keyword+vector');
  k.close();
});
