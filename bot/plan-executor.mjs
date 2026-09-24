// Keeps stage completion tied to observable inventory or successful operation receipts.
const itemId = /^[a-z0-9_]+$/;
const actionId = /^[a-z][a-z0-9_]*$/;
const operationKey = (op) => JSON.stringify([op.action, op.args], (_, value) => value && !Array.isArray(value) && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

export function validateSteps(steps, validActions = null) {
  if (steps == null) return [];
  if (!Array.isArray(steps) || steps.length > 24) throw new Error('Invalid plan: steps must be a list of at most 24 stages');
  const ids = new Set();
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`Invalid plan: steps[${index}]`);
    if (typeof step.id !== 'string' || !actionId.test(step.id) || ids.has(step.id)) throw new Error(`Invalid plan: steps[${index}].id`);
    ids.add(step.id);
    if (typeof step.description !== 'string' || !step.description.trim() || step.description.length > 240) throw new Error(`Invalid plan: steps[${index}].description`);
    const targets = step.targets ?? {};
    if (!targets || typeof targets !== 'object' || Array.isArray(targets) || Object.entries(targets).some(([name, n]) => !itemId.test(name) || !Number.isSafeInteger(n) || n < 0)) throw new Error(`Invalid plan: steps[${index}].targets`);
    const operations = step.operations ?? [];
    if (!Array.isArray(operations) || operations.length > 20) throw new Error(`Invalid plan: steps[${index}].operations`);
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !actionId.test(operation.action) || (validActions && !validActions.has(operation.action))) throw new Error(`Invalid plan: unknown operation action ${operation?.action}`);
      if (!operation.args || typeof operation.args !== 'object' || Array.isArray(operation.args)) throw new Error(`Invalid plan: operation args must be an object`);
    }
    if (new Set(operations.map(operationKey)).size !== operations.length) throw new Error(`Invalid plan: duplicate operations in step ${step.id}`);
    if (!Object.keys(targets).length && !operations.length) throw new Error(`Invalid plan: step ${step.id} needs targets or operations for completion`);
    return { id: step.id, description: step.description.trim(), targets: { ...targets }, operations: operations.map((op) => ({ action: op.action, args: { ...op.args } })) };
  });
}

const key = operationKey;

export function createPlanExecutor(plan) {
  const stages = validateSteps(plan.steps);
  let index = 0;
  const receipts = new Set();
  return {
    current: () => stages[index] || null,
    pendingOperations: () => stages[index]?.operations.filter((op) => !receipts.has(key(op))) || [],
    index: () => index,
    done: () => stages.length > 0 && index >= stages.length,
    record(operation, result) {
      if (stages[index]?.operations.some((op) => key(op) === key(operation)) && result?.status === 'success') receipts.add(key(operation));
    },
    advance(inventory) {
      const advanced = [];
      while (index < stages.length) {
        const stage = stages[index];
        const targetsMet = Object.keys(stage.targets).length > 0 && Object.entries(stage.targets).every(([name, count]) => (inventory[name] || 0) >= count);
        const operationsMet = stage.operations.length > 0 && stage.operations.every((op) => receipts.has(key(op)));
        if ((Object.keys(stage.targets).length && !targetsMet) || (stage.operations.length && !operationsMet)) break;
        advanced.push(stage); index++; receipts.clear();
      }
      return advanced;
    },
  };
}
