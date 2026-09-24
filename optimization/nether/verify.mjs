import fs from 'node:fs';
const run=process.argv[2],dir='runs/'+run,events=fs.readFileSync(dir+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse),base=JSON.parse(fs.readFileSync(dir+'/verification.json'));
const entered=events.find(e=>e.type==='nether_entered'),exited=events.find(e=>e.type==='nether_exited'),kill=events.find(e=>e.type==='dragon_killed'),turns=events.filter(e=>e.type==='camera_turn'),native=events.filter(e=>e.type==='native_camera_turn');
const max=a=>Math.max(0,...a.map(e=>e.degrees));
let dimension=null;const transitions=[];
for(const e of events)if(e.type==='display_state'&&e.dimension!==dimension){if(dimension)transitions.push({time:e.time,from:dimension,to:e.dimension});dimension=e.dimension;}
// Vanilla resets the view on dimension transitions. Keep those events in the proof.
const transitionTurns=native.filter(e=>e.degrees>45&&transitions.some(t=>Math.abs(Date.parse(t.time)-Date.parse(e.time))<=1250));
const regularNative=native.filter(e=>!transitionTurns.includes(e));
const rate=base.configuration.camera?.rateDegreesPerSecond||240;
const checks={fullRun:base.passed,newSeed:base.seed==='8398967436125155523',netherBeforeDragon:!!entered&&!!exited&&!!kill&&Date.parse(entered.time)<Date.parse(exited.time)&&Date.parse(exited.time)<Date.parse(kill.time),netherRecorded:!!entered&&!!exited&&Date.parse(entered.time)>Date.parse(base.recordingStarted)&&Date.parse(exited.time)<Date.parse(base.recordingFinished),continuousControllerSpeed:turns.length>0&&turns.every(e=>Number.isFinite(e.dtMs)&&e.degrees<=Math.SQRT2*rate*e.dtMs/1000+.3),noAbruptDisplayTurnsOutsideDimensionTransitions:regularNative.length>0&&max(regularNative)<=45.01,craftScreen:events.some(e=>e.type==='inventory_display'&&e.kind==='craft'&&e.state==='open'),inventoryScreen:events.some(e=>e.type==='inventory_display'&&e.kind==='inventory'&&e.state==='open')};
const proof={run,checks,passed:Object.values(checks).every(Boolean),netherSeconds:entered&&exited?(Date.parse(exited.time)-Date.parse(entered.time))/1000:null,controlTurnSamples:turns.length,maxControlTurnDegrees:max(turns),displayTurnSamples:native.length,maxDisplayTurnDegrees:max(native),maxRegularDisplayTurnDegrees:max(regularNative),dimensionTransitions:transitions,gameTransitionViewResets:transitionTurns,cameraRateDegreesPerAxisPerSecond:rate};
fs.writeFileSync(dir+'/nether-camera-proof.json',JSON.stringify(proof,null,2));console.log(proof);if(!proof.passed)process.exitCode=1;
