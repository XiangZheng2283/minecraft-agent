// Owner chat commands. Only players listed in agent.json "owners" are obeyed; an empty list disables chat control.
export const HELP = '!goal <text> | !come | !stop | !resume | !received | !status | !where <block> | !remember <text> | or "<botname>, <request>"';

export function parseCommand(message, botName) {
  const text = String(message || '').trim();
  if (!text) return null;
  const m = text.match(/^!(\w+)\s*(.*)$/s);
  if (m) {
    const cmd = m[1].toLowerCase(), arg = m[2].trim();
    if (['goal', 'do', 'task'].includes(cmd)) return arg ? { cmd: 'goal', arg } : null;
    if (['come', 'here'].includes(cmd)) return { cmd: 'goal', arg: 'Come to me and stay near me' };
    if (['follow'].includes(cmd)) return { cmd: 'goal', arg: 'Follow me and protect me' };
    if (['stop', 'pause'].includes(cmd)) return { cmd: 'stop' };
    if (['resume', 'go'].includes(cmd)) return { cmd: 'resume' };
    if (['received', 'gotit'].includes(cmd)) return { cmd: 'received' };
    if (['status', 'st'].includes(cmd)) return { cmd: 'status' };
    if (['where', 'find'].includes(cmd)) return arg ? { cmd: 'where', arg } : null;
    if (['remember', 'note'].includes(cmd)) return arg ? { cmd: 'remember', arg } : null;
    if (['help', '?'].includes(cmd)) return { cmd: 'help' };
    return null;
  }
  // "Bob, get me 10 logs" / "bob: ..." addresses the bot by name.
  const name = String(botName).toLowerCase();
  const lower = text.toLowerCase();
  if (lower.startsWith(name) && /^[\s,:，：]/.test(text.slice(name.length))) {
    const arg = text.slice(name.length).replace(/^[\s,:，：]+/, '').trim();
    return arg ? { cmd: 'goal', arg } : null;
  }
  return null;
}

export const isOwner = (owners, username) => owners.some((o) => o.toLowerCase() === String(username).toLowerCase());
