// Item entities can arrive before their metadata packet.
export function droppedItem(entity){try{return entity?.getDroppedItem?.()||null;}catch{return null;}}
