// Read-only survey of terrain already generated in prior runs of this seed.
import fs from 'node:fs';import zlib from 'node:zlib';import nbt from 'prismarine-nbt';
const worlds=['server/optimization-01','server/recorded-06'];const grid={step:4,cells:{},sources:worlds};
const u64=a=>BigInt.asUintN(64,(BigInt(a[0])<<32n)|BigInt(a[1]>>>0));
for(const world of worlds){
 for(const name of fs.readdirSync(world+'/region').filter(n=>n.endsWith('.mca'))){
  const [,rx,rz]=name.split('.').map(Number);if(rx<0||rx>2||rz>0||rz< -3)continue;
  const bytes=fs.readFileSync(world+'/region/'+name);
  for(let cz=0;cz<32;cz++)for(let cx=0;cx<32;cx++){
   const x=(rx*32+cx)*16,z=(rz*32+cz)*16;if(x<128||x>1152||z< -1376||z>256)continue;
   if(grid.cells[x+','+z])continue;const index=cx+cz*32,offset=bytes.readUIntBE(index*4,3)*4096;if(!offset)continue;
   const length=bytes.readUInt32BE(offset),compressed=bytes.subarray(offset+5,offset+4+length);if(bytes[offset+4]!==2)continue;
   const {parsed}=await nbt.parse(zlib.inflateSync(compressed));const d=nbt.simplify(parsed).Level,hm=d.Heightmaps?.MOTION_BLOCKING_NO_LEAVES;if(!hm)continue;
   const sections=new Map((d.Sections||[]).filter(s=>s.Palette).map(s=>[s.Y,s]));
   for(let dz=0;dz<16;dz+=4)for(let dx=0;dx<16;dx+=4){
    const i=dx+16*dz;let y=Number((u64(hm[Math.floor(i/7)])>>BigInt((i%7)*9))&511n)-1;
    const blockAt=y=>{const s=sections.get(Math.floor(y/16));if(!s)return 'air';if(s.Palette.length===1)return s.Palette[0].Name.slice(10);const bits=Math.max(4,Math.ceil(Math.log2(s.Palette.length))),per=Math.floor(64/bits),j=(y%16)*256+dz*16+dx;const p=Number((u64(s.BlockStates[Math.floor(j/per)])>>BigInt((j%per)*bits))&((1n<<BigInt(bits))-1n));return s.Palette[p]?.Name.slice(10)||'air';};
    let block=blockAt(y);while(y>45&&(block.endsWith('_log')||block.endsWith('_leaves')||block==='air'))block=blockAt(--y);
    grid.cells[(x+dx)+','+(z+dz)]={y:y+1,water:block==='water',block};
   }
  }
 }
}
fs.writeFileSync('optimization/seed-map.json',JSON.stringify(grid));console.log('Surveyed',Object.keys(grid.cells).length,'terrain samples without changing any world.');
