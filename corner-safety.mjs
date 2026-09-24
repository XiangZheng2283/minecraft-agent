// A diagonal move needs clearance for the player's width on both sides.
// The stock graph accepts one clear side, but its controller can then stop at the corner.
export function installCornerSafety(movements){
 const diagonal=movements.getMoveDiagonal.bind(movements);
 movements.getMoveDiagonal=(node,dir,neighbors)=>{
  const landing=movements.getBlock(node,dir.x,0,dir.z);
  if(!landing.physical){
   const sides=[[dir.x,0],[0,dir.z]];
   if(sides.some(([x,z])=>[0,1].some(y=>movements.getBlock(node,x,y,z).physical)))return;
  }
  return diagonal(node,dir,neighbors);
 };
}
