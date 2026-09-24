import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const run=process.argv[2];if(!run)throw Error('Usage: node assemble-video.mjs RUN');
const dir=path.resolve('runs',run),events=fs.readFileSync(dir+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse);
const allStarts=events.filter(e=>e.type==='recording_started');
const omittedEmptyCaptures=allStarts.filter(e=>!fs.existsSync(dir+'/capture-'+e.captureId+'.webm'));
for(const e of omittedEmptyCaptures){const next=allStarts.find(n=>Date.parse(n.time)>Date.parse(e.time));if(events.some(a=>a.type==='decision'&&Date.parse(a.time)>=Date.parse(e.time)&&(!next||Date.parse(a.time)<Date.parse(next.time))))throw Error('Missing capture contains player actions');}
const starts=allStarts.filter(e=>fs.existsSync(dir+'/capture-'+e.captureId+'.webm')),segments=[];
const duration=file=>Number(JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',dir+'/'+file],{encoding:'utf8'})).format.duration);
for(let i=0;i<starts.length;i++){
 const c=starts[i],finish=events.find(e=>e.type==='recording_finished'&&e.captureId===c.captureId),next=starts[i+1];
 if(!finish&&!next)throw Error('Last capture is not finished');
 if(i&&Date.parse(c.time)-Date.parse(segments.at(-1).end)>10000){const file=i===1?'pause-card.mp4':'pause-descent.mp4';segments.push({type:'pause',file,duration:duration(file),reason:i===1?'Escape action update after death; normal respawn':'Controlled portal descent update; player paused and disconnected'});}
 const source='capture-'+c.captureId+'.webm',file='segment-'+String(i+1).padStart(2,'0')+'.mp4';
 if(!fs.existsSync(dir+'/'+file))execFileSync('ffmpeg',['-y','-i',dir+'/'+source,'-c:v','libx264','-preset','veryfast','-crf','29','-pix_fmt','yuv420p','-r','12','-an','-movflags','+faststart',dir+'/'+file],{stdio:['ignore','ignore','ignore']});
 segments.push({type:'gameplay',captureId:c.captureId,source,file,start:c.time,end:finish?.time||next.time,endEvidence:finish?'recorder finished':'browser reload before first recovery action',duration:duration(file)});
}
fs.writeFileSync(dir+'/concat.txt',segments.map(s=>"file '"+s.file+"'").join('\n')+'\n');
execFileSync('ffmpeg',['-y','-f','concat','-safe','0','-i',dir+'/concat.txt','-c','copy','-movflags','+faststart',dir+'/full-playthrough.mp4'],{stdio:['ignore','ignore','ignore']});
fs.writeFileSync(dir+'/video-manifest.json',JSON.stringify({run,omittedEmptyCaptures,mode:'Survival',difficulty:'peaceful',deaths:events.filter(e=>e.type==='death').length,segments,description:'All captured gameplay at original speed, with a visible card for the agent update pause. No audio.'},null,2));
console.log(JSON.stringify({run,segments:segments.length,duration:duration('full-playthrough.mp4')}));
