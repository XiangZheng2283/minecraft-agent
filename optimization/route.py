import json,heapq,math,pathlib
m=json.load(open('optimization/seed-map.json'));cells={tuple(map(int,k.split(','))):v for k,v in m['cells'].items()};start=(204,196);goal=(1016,-1220)
dirs=[(x,z) for x in [-4,0,4] for z in [-4,0,4] if x or z]
def nearshore(p):return sum(not cells.get((p[0]+x,p[1]+z),{}).get('water',False) for x,z in dirs)
shore={p:nearshore(p) if v['water'] else 0 for p,v in cells.items()}
q=[(0,0,start)];cost={start:0};prev={}
while q:
 _,g,p=heapq.heappop(q)
 if g!=cost[p]:continue
 if p==goal:break
 a=cells[p]
 for dx,dz in dirs:
  t=(p[0]+dx,p[1]+dz);b=cells.get(t)
  if not b or b['block']=='lava':continue
  distance=math.hypot(dx,dz);c=distance*(.65 if a['water'] and b['water'] else 1.0)
  if a['water']!=b['water']:c+=35
  if b['water']:c+=shore[t]*3
  else:c+=max(0,abs(b['y']-a['y'])-1)*5
  n=g+c
  if n<cost.get(t,float('inf')):cost[t]=n;prev[t]=p;heapq.heappush(q,(n+math.dist(t,goal)*.65,n,t))
if goal not in cost:raise RuntimeError('No surveyed route')
path=[goal]
while path[-1]!=start:path.append(prev[path[-1]])
path.reverse();waypoints=[];anchor=0
for i,p in enumerate(path[1:],1):
 if i==len(path)-1 or math.dist(path[anchor],p)>=140 or (i>anchor+4 and cells[p]['water']!=cells[path[i-1]]['water']):
  waypoints.append({'x':p[0],'y':cells[p]['y'],'z':p[1],'terrain':'water' if cells[p]['water'] else 'land'});anchor=i
# Keep each water segment inside surveyed water, then keep its first launch point.
def sample(p):return cells.get((round(p[0]/4)*4,round(p[1]/4)*4))
def visible(a,b):
 water=sample(a)['water'] and sample(b)['water'];n=max(1,math.ceil(math.dist(a,b)/2))
 for i in range(n+1):
  c=sample((a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n))
  if not c or water and not c['water']:return False
 return True
waypoints=[];i=0
while i<len(path)-1:
 j=i+1
 for k in range(i+2,len(path)):
  if math.dist(path[i],path[k])>160:break
  if visible(path[i],path[k]):j=k
 p=path[j];c=sample(p);waypoints.append({'x':p[0],'y':max(63,c['y']),'z':p[1],'terrain':'water' if c['water'] else 'land'});i=j
launch=next(p for p in path if cells[p]['water'])
waypoints.insert(0,{'x':launch[0],'y':cells[launch]['y'],'z':launch[1],'terrain':'water'})
out={'seed':'-4530634556500121041','source':'Read-only terrain survey of prior runs; no world edits','waypoints':waypoints,'path':path,'distance':sum(math.dist(a,b) for a,b in zip(path,path[1:]))}
pathlib.Path('optimization/seed-route.json').write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!='path'},indent=2))
# A small map for review. North is at the top.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1040" viewBox="0 0 1024 1664"><rect width="1024" height="1664" fill="#1b2330"/>']
for (x,z),v in cells.items():
 if not 128<=x<=1152 or not -1376<=z<=288:continue
 color='#276f9d' if v['water'] else '#729364' if v['y']<80 else '#a09581'
 svg.append(f'<rect x="{x-128}" y="{z+1376}" width="4" height="4" fill="{color}"/>')
points=' '.join(f'{x-128},{z+1376}' for x,z in path);svg.append(f'<polyline points="{points}" fill="none" stroke="#ffd36c" stroke-width="4"/>')
for i,p in enumerate(waypoints):svg.append(f'<circle cx="{p["x"]-128}" cy="{p["z"]+1376}" r="6" fill="#ffffff"/><text x="{p["x"]-119}" y="{p["z"]+1376}" fill="#111" font-size="16">{i+1}</text>')
svg.append('</svg>');pathlib.Path('optimization/seed-route.svg').write_text(''.join(svg))
