export function dragonKillAward(packet){
 return (packet.progressMapping||[]).some(p=>p.key==='minecraft:end/kill_dragon'&&p.value.some(c=>c.criterionProgress!=null));
}
export function gameWon(packet){return packet.reason===4||packet.reason==='win_game';}

export function dragonDeathState(battle){return battle?.health===0&&battle?.phase===9;}
