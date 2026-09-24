import json,heapq,math
rows=json.load(open('optimization/eyes/nether-surfaces.json')); cols={};nodes={}
for x,y,z,b in rows:cols.setdefault((x,z),[]).append((x,y,z));nodes[(x,y,z)]=b
start=min(nodes,key=lambda p:math.dist(p,(34,49,12)));goal=min(nodes,key=lambda p:math.dist(p,(-120,59,11)));print('start',start,'goal',goal)
q=[(0,start)];cost={start:0};prev={}
while q:
 d,p=heapq.heappop(q)
 if d!=cost[p]:continue
 if p==goal:break
 x,y,z=p
 for dx,dz in [(1,0),(-1,0),(0,1),(0,-1)]:
  for t in cols.get((x+dx,z+dz),[]):
   dy=t[1]-y
   if dy>1 or dy<-3:continue
   nd=d+1+max(0,dy)*.4
   if nd<cost.get(t,1e9):cost[t]=nd;prev[t]=p;heapq.heappush(q,(nd,t))
if goal not in cost:
 nearest=min(cost,key=lambda p:math.dist(p,goal));print('NO PATH visited',len(cost),'closest',nearest,'dist',math.dist(nearest,goal));goal=nearest
path=[goal]
while path[-1]!=start:path.append(prev[path[-1]])
path.reverse();json.dump(path,open('optimization/eyes/nether-surface-path.json','w'));print('path length',len(path),'end',path[-1])
