import json,heapq,math
m=json.load(open('optimization/eyes/overworld-surfaces.json'));cells={(v['x'],v['z']):v for v in m['cells'].values()};start=min(cells,key=lambda p:math.dist(p,(147,100)));end=min(cells,key=lambda p:math.dist(p,(-1957,301)));q=[(0,start)];cost={start:0};prev={}
while q:
 c,p=heapq.heappop(q)
 if c!=cost[p]:continue
 if p==end:break
 for dx,dz in [(16,0),(-16,0),(0,16),(0,-16),(16,16),(16,-16),(-16,16),(-16,-16)]:
  n=(p[0]+dx,p[1]+dz)
  if n not in cells:continue
  cell=cells[n];dy=abs(cell['y']-cells[p]['y']);value=c+math.hypot(dx,dz)+dy*2+(100 if cell['block']=='water' else 0)+(1000 if cell['block'] in ['lava','cactus'] else 0)
  if value<cost.get(n,math.inf):cost[n]=value;prev[n]=p;heapq.heappush(q,(value,n))
if end not in cost:print('Disconnected surveyed grid',len(cost),'closest',min(cost,key=lambda p:math.dist(p,end)),'end',end);raise SystemExit(1)
route=[];p=end
while True:
 route.append(cells[p]);
 if p==start:break
 p=prev[p]
route.reverse();waypoints=[route[0]]
for i in range(1,len(route)-1):
 a,b,c=route[i-1:i+2]
 if (b['x']-a['x'],b['z']-a['z'])!=(c['x']-b['x'],c['z']-b['z']):waypoints.append(b)
waypoints.append(route[-1]);json.dump({'seed':'664012','route':route,'waypoints':waypoints,'waterCells':sum(x['block']=='water' for x in route)},open('optimization/eyes/overworld-route.json','w'),indent=2);print('route',len(route),'waypoints',len(waypoints),'water',sum(x['block']=='water' for x in route),'height',min(x['y'] for x in route),max(x['y'] for x in route))
