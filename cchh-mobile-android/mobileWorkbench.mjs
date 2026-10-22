// Core workflow tabs only. Terminal, file browsing and the desktop
// placeholder are out of scope for the free LAN-first client.
export const WORKSPACE_TABS = [
  {id:'chat',label:'聊天',symbol:'◉'},
  {id:'tasks',label:'任务',symbol:'☑'},
];

export function projectRootOf(session) {
  const root = session?.projectPath || session?.workDir || '';
  return typeof root === 'string' ? root.trim() : '';
}

export function withinProjectRoot(root, target) {
  if(typeof root!=='string' || !root || typeof target!=='string' || !target) return false;
  const normalize = value => value.replace(/\\/g,'/').replace(/\/+$/,'');
  const base = normalize(root);
  const next = normalize(target);
  const windows = /^[a-z]:\//i.test(base) || base.startsWith('//');
  const a = windows ? base.toLowerCase() : base;
  const b = windows ? next.toLowerCase() : next;
  if(a === '') return b.startsWith('/');
  if(b === a) return true;
  return b.startsWith(a + '/');
}

// Do not interpret arbitrary assistant prose as a command. This view is a
// read-only extraction of tool-use and tool-result data from CCHH's transcript.
export function terminalEntriesFromHistory(payload) {
  const result = [];
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for(const message of messages) {
    const parts = Array.isArray(message?.content) ? message.content : [];
    for(const part of parts) {
      if(part?.type === 'tool_use' && /^(Bash|Shell|PowerShell|terminal|exec|computer_shell)$/i.test(part.name || '')) {
        const input = part.input || {};
        const command = input.command || input.cmd || input.script;
        if(typeof command === 'string' && command.trim()) {
          result.push({id:String(part.id || message.id || result.length),kind:'command',
            label:part.name,text:command.slice(0,6000)});
        }
      }
      if(part?.type === 'tool_result') {
        const text = typeof part.content === 'string' ? part.content :
          Array.isArray(part.content)
            ? part.content.filter(x=>x?.type==='text').map(x=>x.text||'').join('\n')
            : '';
        if(text.trim()) {
          result.push({id:String(part.tool_use_id || message.id || result.length)+':result',
            kind:'output',label:'输出',text:text.slice(0,6000)});
        }
      }
    }
  }
  return result.slice(-60);
}

export function safeModelChoices(payload) {
  return (Array.isArray(payload?.models) ? payload.models : [])
    .filter(m => m && typeof m.id === 'string' && m.id && typeof m.name === 'string')
    .slice(0,80).map(m => ({id:m.id,name:m.name}));
}
