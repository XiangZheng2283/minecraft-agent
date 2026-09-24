import json,sys,collections,datetime,pathlib
run=sys.argv[1];root=pathlib.Path('runs')/run
rows=[json.loads(s) for s in (root/'events.jsonl').read_text().splitlines()]
def t(x):return datetime.datetime.fromisoformat(x['time'].replace('Z','+00:00')).timestamp()
def group(k):
 for p in ['row_detour','swim_detour','detour','craft','logs','beds','blocks','stone','chests','collect','attack','escape']:
  if k.startswith(p):return p
 return k
counts=collections.defaultdict(lambda:dict(count=0,failed=0,seconds=0,unchanged=0))
last=None;plans=[];latencies=[];phases=collections.defaultdict(list)
for e in rows:
 if e['type']=='plan':plans.append(e)
 if e['type']=='decision':
  last=e;latencies.append(e.get('latencyMs',0));state=json.loads(e['request']['state']);phases[state.get('stage',state.get('dimension','unknown'))].append(t(e))
 if e['type']=='result' and last:
  k=group(last['selected']);g=counts[k];g['count']+=1;g['seconds']+=max(0,t(e)-t(last));g['failed']+=str(e.get('result','')).startswith('FAILED');before=json.loads(last['request']['state']).get('position');g['unchanged']+=before==e.get('position');last=None
for g in counts.values():g['seconds']=round(g['seconds'],1)
result={'run':run,'decisions':len(latencies),'plannerCalls':len(plans),'plannerApiSeconds':round(sum(e.get('latencyMs',0) for e in plans)/1000,1),'jevApiSeconds':round(sum(latencies)/1000,1),'deaths':sum(e['type']=='death' for e in rows),'actions':dict(sorted(counts.items(),key=lambda q:-q[1]['seconds'])),'phaseActionSpans':{k:round(max(v)-min(v),1) for k,v in phases.items()},'note':'API time can overlap actions. Phase spans include operator pauses during development.'}
(root/'efficiency.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
