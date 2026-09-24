// A short findBlock radius can miss a nearby block across two chunk-section edges.
export function findCraftingTables(bot){
 const remote=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:40});
 const near=remote&&bot.entity.position.distanceTo(remote.position.offset(.5,.5,.5))<=4?remote:null;
 return {near,remote};
}
