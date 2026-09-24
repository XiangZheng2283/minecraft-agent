// Shared knowledge store: SQLite FTS5 (trigram) keyword search + optional embeddings, RRF fusion, optional rerank.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import mcData from 'minecraft-data';

const RRF_K=60, BATCH=32, TIMEOUT_MS=20000, CHUNK_MAX=1500;

export function embedConfigFromEnv(env=process.env){
  if(!env.EMBED_BASE_URL||!env.EMBED_MODEL) return null;
  return {baseUrl:env.EMBED_BASE_URL,apiKey:env.EMBED_API_KEY||'',model:env.EMBED_MODEL};
}
export function rerankConfigFromEnv(env=process.env){
  if(!env.RERANK_BASE_URL||!env.RERANK_MODEL) return null;
  return {baseUrl:env.RERANK_BASE_URL,apiKey:env.RERANK_API_KEY||'',model:env.RERANK_MODEL};
}

const apiUrl=(base,path)=>{let b=String(base).replace(/\/+$/,'');if(!/\/v1$/.test(b)) b+='/v1';return b+path;};

async function postJson(fetchImpl,cfg,path,body){
  const headers={'content-type':'application/json'};
  if(cfg.apiKey) headers.authorization=`Bearer ${cfg.apiKey}`;
  const res=await fetchImpl(apiUrl(cfg.baseUrl,path),{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(TIMEOUT_MS)});
  if(!res.ok) throw new Error(`${path} HTTP ${res.status}: ${String(await res.text().catch(()=>'')).slice(0,200)}`);
  return res.json();
}

const toBlob=v=>new Uint8Array(new Float32Array(v).buffer);
const fromBlob=b=>new Float32Array(new Uint8Array(b).slice().buffer);
function cosine(a,b){
  if(a.length!==b.length) return -1;
  let d=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  return na&&nb?d/Math.sqrt(na*nb):0;
}

const CJK=/[\u3040-\u30ff\u3400-\u9fff\uf900-\uffdc\uac00-\ud7af]/u;
const chars=s=>[...s];
// Split a query into search terms; long CJK runs (no spaces) also yield their trigrams so partial matches work.
export function queryTerms(query){
  const out=new Set();
  for(const raw of String(query).toLowerCase().split(/[^\p{L}\p{N}_]+/u)){
    if(!raw) continue;
    out.add(raw);
    const cs=chars(raw);
    if(cs.length>3&&CJK.test(raw)) for(let i=0;i+3<=cs.length;i++) out.add(cs.slice(i,i+3).join(''));
  }
  return [...out];
}
const likeEscape=s=>s.replace(/[!%_]/g,m=>'!'+m);

// Collapse a recipe variant into plain English.
function describeVariant(r,name){
  const id=x=>x==null?null:typeof x==='object'?(Array.isArray(x)?id(x[0]):x.id):x;
  const counts=new Map(),add=i=>{const n=name(id(i));if(n) counts.set(n,(counts.get(n)||0)+1);};
  let shape,needsTable;
  if(r.inShape){
    const h=r.inShape.length,w=Math.max(...r.inShape.map(row=>row.length));
    r.inShape.flat().forEach(add);shape=`shaped ${w}x${h} grid`;needsTable=w>2||h>2;
  }else{
    (r.ingredients||[]).forEach(add);shape='shapeless';needsTable=(r.ingredients||[]).length>4;
  }
  const from=[...counts].map(([n,c])=>`${c} ${n}`).join(', ');
  const count=typeof r.result==='object'?r.result.count??1:1;
  return {text:`${shape} from ${from}`,count,needsTable};
}

// Split markdown into [{title,text}] by #/## headings, then by paragraphs when too long.
export function chunkMarkdown(md,fallbackTitle=''){
  const sections=[];let cur={title:fallbackTitle,lines:[]};
  for(const line of md.replace(/\r\n?/g,'\n').split('\n')){
    const m=/^#{1,2}\s+(.*)$/.exec(line);
    if(m){sections.push(cur);cur={title:m[1].trim(),lines:[]};}else cur.lines.push(line);
  }
  sections.push(cur);
  const chunks=[];
  for(const s of sections){
    const body=s.lines.join('\n').trim();
    if(!body) continue;
    for(const text of packParagraphs(body)) chunks.push({title:s.title,text});
  }
  return chunks;
}
function packParagraphs(body){
  if(body.length<=CHUNK_MAX) return [body];
  const parts=body.split(/\n\s*\n/).flatMap(p=>{p=p.trim();const out=[];for(let i=0;i<p.length;i+=CHUNK_MAX) out.push(p.slice(i,i+CHUNK_MAX));return out;});
  const out=[];let buf='';
  for(const p of parts){
    if(buf&&buf.length+2+p.length>CHUNK_MAX){out.push(buf);buf='';}
    buf=buf?`${buf}\n\n${p}`:p;
  }
  if(buf) out.push(buf);
  return out;
}

export function openKnowledge({path='data/knowledge/knowledge.db',embed=embedConfigFromEnv(),rerank=rerankConfigFromEnv(),fetchImpl=globalThis.fetch,log=()=>{}}={}){
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', bot TEXT, key TEXT UNIQUE, created_at INTEGER NOT NULL, embedding BLOB, embed_model TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, text, tokenize='trigram');`);
  const q={
    byKey:db.prepare('SELECT id,title,text FROM docs WHERE key=?'),
    insert:db.prepare('INSERT INTO docs(source,title,text,tags,bot,key,created_at) VALUES(?,?,?,?,?,?,?)'),
    update:db.prepare('UPDATE docs SET source=?,title=?,text=?,tags=?,bot=? WHERE id=?'),
    clearEmb:db.prepare('UPDATE docs SET embedding=NULL,embed_model=NULL WHERE id=?'),
    setEmb:db.prepare('UPDATE docs SET embedding=?,embed_model=? WHERE id=?'),
    ftsIns:db.prepare('INSERT INTO docs_fts(rowid,title,text) VALUES(?,?,?)'),
    ftsDel:db.prepare('DELETE FROM docs_fts WHERE rowid=?'),
    del:db.prepare('DELETE FROM docs WHERE id=?'),
    getText:db.prepare('SELECT title,text FROM docs WHERE id=?'),
    keysLike:db.prepare("SELECT id,key FROM docs WHERE key LIKE ? ESCAPE '!'"),
  };
  let closed=false;
  const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};

  // --- embedding queue: id -> generation, so an edit during an in-flight request is not lost
  const queue=new Map();let gen=0,running=null;
  const enqueue=id=>{if(embed){queue.set(id,++gen);kick();}};
  const embedInput=r=>(r.title?`${r.title}\n${r.text}`:r.text).slice(0,8000);
  async function embedTexts(texts){
    const json=await postJson(fetchImpl,embed,'/embeddings',{model:embed.model,input:texts});
    const out=Array.from(texts,()=>null);
    for(const d of json?.data||[]) out[d.index]=d.embedding;
    if(out.some(v=>!Array.isArray(v))) throw new Error('embeddings response missing vectors');
    return out;
  }
  async function drain(){
    while(queue.size&&!closed){
      const batch=[...queue].slice(0,BATCH),rows=[];
      for(const [id,g] of batch){const r=q.getText.get(id);if(r) rows.push({id,g,input:embedInput(r)});else queue.delete(id);}
      if(!rows.length) continue;
      let vecs;
      try{vecs=await embedTexts(rows.map(r=>r.input));}
      catch(e){log(`knowledge: embedding failed (${queue.size} queued, will retry): ${e.message}`);return;}
      if(closed) return;
      tx(()=>rows.forEach((r,i)=>{if(queue.get(r.id)===r.g){q.setEmb.run(toBlob(vecs[i]),embed.model,r.id);queue.delete(r.id);}}));
    }
  }
  function kick(){
    if(!embed||running||!queue.size||closed) return running;
    // start on a microtask so synchronous add() bursts land in one batch
    running=Promise.resolve().then(drain).catch(e=>log(`knowledge: embed queue error: ${e.message}`)).finally(()=>{running=null;});
    return running;
  }
  if(embed) for(const {id} of db.prepare('SELECT id FROM docs WHERE embedding IS NULL OR embed_model IS NOT ? ORDER BY id').all(embed.model)) queue.set(id,++gen);
  kick();

  function add({source,title='',text,tags=[],bot=null,key=null}){
    if(!source||typeof text!=='string') throw new TypeError('add() needs source and text');
    const tagJson=JSON.stringify(tags||[]);
    const existing=key!=null?q.byKey.get(key):null;
    if(existing){
      const id=Number(existing.id),changed=existing.title!==title||existing.text!==text;
      q.update.run(source,title,text,tagJson,bot,id);
      if(changed){q.ftsDel.run(id);q.ftsIns.run(id,title,text);q.clearEmb.run(id);enqueue(id);}
      return id;
    }
    const id=Number(q.insert.run(source,title,text,tagJson,bot,key,Date.now()).lastInsertRowid);
    q.ftsIns.run(id,title,text);
    enqueue(id);
    return id;
  }
  function removeId(id){q.ftsDel.run(id);q.del.run(id);queue.delete(id);}

  async function flush(){
    if(!running) kick();
    while(running) await running;
  }

  // --- retrieval
  function filterSql(source,bot,alias='d'){
    const where=[],args=[];
    if(source!=null){where.push(`${alias}.source=?`);args.push(source);}
    // Cross-bot retrieval requires an explicit shared tag; legacy experience stays private.
    if(bot!=null){where.push(`(${alias}.bot IS NULL OR ${alias}.bot=? OR (${alias}.source='experience' AND EXISTS (SELECT 1 FROM json_each(${alias}.tags) WHERE value='shared')))`);args.push(bot);}
    return {sql:where.length?' AND '+where.join(' AND '):'',args};
  }
  function keywordIds(query,{source,bot,candidates}){
    const terms=queryTerms(query),long=terms.filter(t=>chars(t).length>=3),short=terms.filter(t=>chars(t).length<3);
    const f=filterSql(source,bot),ids=[],seen=new Set();
    const push=rows=>{for(const r of rows){const id=Number(r.id);if(!seen.has(id)&&ids.length<candidates){seen.add(id);ids.push(id);}}};
    // exact title hits (e.g. "stick", "crafting_table") beat partial bm25 matches
    const exact=String(query).trim().toLowerCase().replace(/_/g,' ');
    push(db.prepare(`SELECT d.id FROM docs d WHERE lower(d.title)=?${f.sql} ORDER BY d.id LIMIT ?`).all(exact,...f.args,candidates));
    if(long.length){
      const match=long.map(t=>`"${t.replace(/"/g,'""')}"`).join(' OR ');
      push(db.prepare(`SELECT f.rowid id FROM docs_fts f JOIN docs d ON d.id=f.rowid WHERE docs_fts MATCH ?${f.sql} ORDER BY bm25(docs_fts,5.0,1.0) LIMIT ?`).all(match,...f.args,candidates));
    }
    if(short.length&&ids.length<candidates){
      // trigram needs >=3 chars; score short terms by how many of them each doc contains
      const hit=short.map(()=>`(d.title LIKE ? ESCAPE '!' OR d.text LIKE ? ESCAPE '!')`);
      const likeArgs=short.flatMap(t=>{const p=`%${likeEscape(t)}%`;return [p,p];});
      push(db.prepare(`SELECT d.id, (${hit.join('+')}) n FROM docs d WHERE (${hit.join(' OR ')})${f.sql} ORDER BY n DESC, d.id DESC LIMIT ?`)
        .all(...likeArgs,...likeArgs,...f.args,candidates));
    }
    return ids;
  }
  async function vectorIds(query,{source,bot,candidates}){
    let qv;
    try{[qv]=await embedTexts([query]);}catch(e){log(`knowledge: query embedding failed: ${e.message}`);return [];}
    if(closed) return [];
    const f=filterSql(source,bot);
    const rows=db.prepare(`SELECT d.id,d.embedding FROM docs d WHERE d.embedding IS NOT NULL AND d.embed_model=?${f.sql}`).all(embed.model,...f.args);
    return rows.map(r=>({id:Number(r.id),s:cosine(qv,fromBlob(r.embedding))}))
      .sort((a,b)=>b.s-a.s).slice(0,candidates).map(r=>r.id);
  }
  function fuse(lists){
    const m=new Map();
    for(const [label,ids] of lists) ids.forEach((id,i)=>{
      const e=m.get(id)||{id,score:0,via:[]};e.score+=1/(RRF_K+i+1);e.via.push(label);m.set(id,e);
    });
    return [...m.values()].sort((a,b)=>b.score-a.score);
  }
  const loadDocs=ids=>{
    if(!ids.length) return new Map();
    const rows=db.prepare(`SELECT id,source,title,text,tags,bot FROM docs WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
    return new Map(rows.map(r=>[Number(r.id),{id:Number(r.id),source:r.source,title:r.title,text:r.text,tags:JSON.parse(r.tags||'[]'),bot:r.bot}]));
  };
  async function rerankList(query,fused,docs){
    const json=await postJson(fetchImpl,rerank,'/rerank',{model:rerank.model,query,
      documents:fused.map(e=>{const d=docs.get(e.id);return (d.title?`${d.title}\n${d.text}`:d.text).slice(0,4000);}),top_n:fused.length});
    const results=json?.results;
    if(!Array.isArray(results)) throw new Error('rerank response missing results');
    const out=[],used=new Set();
    for(const r of [...results].sort((a,b)=>b.relevance_score-a.relevance_score)){
      const e=fused[r.index];
      if(e&&!used.has(r.index)){used.add(r.index);out.push({...e,score:r.relevance_score,reranked:true});}
    }
    fused.forEach((e,i)=>{if(!used.has(i)) out.push(e);});
    return out;
  }
  async function search(query,{limit=5,source=null,bot=null,candidates=30}={}){
    if(!String(query||'').trim()) return [];
    const opts={source,bot,candidates};
    kick(); // opportunistically retry pending embeddings
    const lists=[['keyword',keywordIds(query,opts)]];
    if(embed) lists.push(['vector',await vectorIds(query,opts)]);
    if(closed) return [];
    let fused=fuse(lists).slice(0,candidates);
    const docs=loadDocs(fused.map(e=>e.id));
    fused=fused.filter(e=>docs.has(e.id));
    if(rerank&&fused.length){
      try{fused=await rerankList(query,fused,docs);}catch(e){log(`knowledge: rerank failed, using RRF order: ${e.message}`);}
    }
    return fused.slice(0,limit).map(e=>({...docs.get(e.id),score:e.score,via:e.via.join('+')+(e.reranked?'+rerank':'')}));
  }

  // --- ingestion
  function ingestRecipes(version='1.16.5'){
    const data=mcData(version),name=id=>id==null?null:data.items[id]?.name??data.blocks?.[id]?.name??null;
    let n=0;
    tx(()=>{
      for(const [idStr,variants] of Object.entries(data.recipes)){
        const item=data.items[Number(idStr)];
        if(!item||!variants?.length) continue;
        const vs=variants.map(r=>describeVariant(r,name)),first=vs[0].count;
        const shown=vs.slice(0,4).map(v=>v.text+(v.count!==first?` (yields ${v.count})`:''));
        const more=vs.length>4?`; plus ${vs.length-4} more variants`:'';
        const table=vs.every(v=>v.needsTable)?'yes':vs.some(v=>v.needsTable)?'depends on variant':'no';
        const text=`Crafting ${item.displayName} (${item.name}) yields ${first}: ${shown.join('; or ')}${more}. Requires crafting table: ${table}.`;
        add({source:'recipe',title:item.displayName,text,tags:['recipe',item.name],key:`recipe:${item.name}`});
        n++;
      }
    });
    return n;
  }
  function ingestMarkdown(dir='data/knowledge'){
    let total=0;
    for(const file of readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.md')).sort()){
      const chunks=chunkMarkdown(readFileSync(join(dir,file),'utf8'),file.replace(/\.md$/i,''));
      tx(()=>{
        const keys=new Set(chunks.map((c,i)=>{const key=`md:${file}#${i}`;add({source:'strategy',title:c.title,text:c.text,tags:['markdown',file],key});return key;}));
        for(const r of q.keysLike.all(`md:${likeEscape(file)}#%`)) if(!keys.has(r.key)) removeId(Number(r.id));
      });
      total+=chunks.length;
    }
    return total;
  }

  function stats(){
    const {docs,embedded}=db.prepare('SELECT count(*) docs, count(embedding) embedded FROM docs').get();
    const bySource={};
    for(const r of db.prepare('SELECT source,count(*) n FROM docs GROUP BY source').all()) bySource[r.source]=Number(r.n);
    return {docs:Number(docs),embedded:Number(embedded),bySource};
  }
  function close(){if(!closed){closed=true;db.close();}}

  return {add,flush,search,ingestRecipes,ingestMarkdown,stats,close};
}
