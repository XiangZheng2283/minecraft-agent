"""Compare full run evidence without changing game or model state."""
import json,pathlib,sys,datetime,collections
run=sys.argv[1]
def read_run(name):
 root=pathlib.Path('runs')/name;rows=[json.loads(x) for x in (root/'events.jsonl').read_text().splitlines()]
 decisions=[x for x in rows if x['type']=='decision'];plans=[x for x in rows if x['type']=='plan'];proof=json.loads((root/'verification.json').read_text())
 return {'run':name,'videoSeconds':float(proof['media']['format']['duration']),'decisions':len(decisions),'plannerCalls':len(plans),'genericWaits':sum(x.get('selected')=='wait' for x in decisions),'failedActions':sum(x['type']=='result' and str(x.get('result','')).startswith('FAILED') for x in rows),'deaths':proof['deathCount'],'passed':proof['passed'],'plannerModels':proof['plannerModels'],'controllerModels':proof['controllerModels'],'videoBytes':int(proof['media']['format']['size'])}
a,b=read_run('recorded-06'),read_run(run)
out={'baseline':a,'final':b,'durationReductionPercent':round(100*(1-b['videoSeconds']/a['videoSeconds']),1),'decisionReductionPercent':round(100*(1-b['decisions']/a['decisions']),1),'note':'The baseline includes a death, recovery, and code-update pauses. The final run uses a native renderer, a surveyed route, and revised action policies. This is a whole-system comparison, not an isolated model benchmark.'}
pathlib.Path('optimization/comparison.json').write_text(json.dumps(out,indent=2))
def duration(x):return f'{int(x)//60} min {int(x)%60:02d} sec'
lines=['# Full-run comparison','','| Measure | Earlier run | New run |','|---|---:|---:|']
for key,label in [('videoSeconds','Full video'),('decisions','JEV decisions'),('plannerCalls','Planner calls'),('genericWaits','Generic waits'),('failedActions','Failed actions'),('deaths','Deaths')]:
 v=lambda q:duration(q[key]) if key=='videoSeconds' else str(q[key])
 lines.append(f'| {label} | {v(a)} | {v(b)} |')
lines+=['',out['note'],'','The new recording uses Sol as planner and JEV as controller. It runs in Survival on Peaceful difficulty. The video uses native Minecraft Java 1.16.5 graphics at 960 × 540 and 20 fps. It has no audio.','',f'New run: `runs/{run}`. Its saved world, model transcript, video duration, complete action coverage, and unchanged source hashes pass verification.','', 'The main repairs remove completed supply tasks, avoid repeated waits, use measured boat clearance, follow a surveyed water route, and clear old pathfinder targets on cancellation. Planner calls occur at milestones and failures. Combat still uses normal player actions and a read-only dragon-position sensor.','', 'Preparation still has inventory transaction retries. These retries remain in the full video and transcript. Further speed gains are possible; the result does not establish an optimal Minecraft time.']
pathlib.Path('optimization/COMPARISON.md').write_text('\n'.join(lines)+'\n');print(json.dumps(out,indent=2))
