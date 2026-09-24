import fs from 'node:fs';import nbt from 'prismarine-nbt';
const run=process.argv[2],world=process.argv[3]||run;if(!run)throw Error('Run name required');
const events=fs.readFileSync('runs/'+run+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse),victory=JSON.parse(fs.readFileSync('runs/'+run+'/victory.json'));
const {parsed}=await nbt.parse(fs.readFileSync('server/'+world+'/level.dat'));const d=nbt.simplify(parsed).Data;
const proof={run,world,verifiedAt:new Date().toISOString(),survival:d.GameType===0,peaceful:d.Difficulty===0,commandsDisabled:d.allowCommands===0,dragonKilled:d.DragonFight?.DragonKilled===1,exitPortal:victory.won===true,deaths:events.filter(e=>e.type==='death').length,decisions:events.filter(e=>e.type==='decision').length,plans:events.filter(e=>e.type==='plan').length,seed:String(d.WorldGenSettings.seed)};
proof.passed=proof.survival&&proof.peaceful&&proof.commandsDisabled&&proof.dragonKilled&&proof.exitPortal;
fs.writeFileSync('runs/'+run+'/world-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));if(!proof.passed)process.exitCode=1;
