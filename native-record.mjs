import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const control=resolve('native-client/record-path.txt');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function startNativeRecording(dir,log){
 const file=resolve(dir,'full-playthrough.mp4');
 if(existsSync(file))throw Error('Refusing to overwrite native recording');
 writeFileSync(control,file);
 const deadline=Date.now()+30000;
 while(!existsSync(file+'.started.json')){if(Date.now()>deadline)throw Error('Native recorder did not start');await sleep(100);}
 const start=JSON.parse(readFileSync(file+'.started.json'));
 log('recording_started',{captureId:'native',renderer:'Minecraft Java 1.16.5',file,...start});
 let finishing;return ()=>finishing||=(async()=>{if(existsSync(control)&&readFileSync(control,'utf8').trim()===file)unlinkSync(control);
  const deadline=Date.now()+45000;while(!existsSync(file+'.finished.json')){if(Date.now()>deadline)throw Error('Native recorder did not finalize');await sleep(200);}
  const finish=JSON.parse(readFileSync(file+'.finished.json'));if(finish.exitCode!==0)throw Error('Native video encoder failed');
  log('recording_finished',{captureId:'native',file,...finish});return finish;
 })();
}
