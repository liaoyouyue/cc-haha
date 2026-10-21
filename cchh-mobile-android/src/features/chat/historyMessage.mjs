/**
 * Convert CCHH transcript records to a safe, stable mobile view model.
 * Compatibility contract: preserve the visible text/id/role/timestamp of
 * v0.1.5 while retaining typed blocks for future rich native rendering.
 * This module never logs or transmits the original input.
 */
export function textFromContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(v => v && v.type === 'text' && typeof v.text === 'string')
    .map(v => v.text).join('\n');
}

/** Non-text blocks are metadata only and are not yet shown in chat bubbles. */
export function summarizeBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    if (item.type === 'text' && typeof item.text === 'string') {
      return [{ type: 'text', text: item.text }];
    }
    if (item.type === 'tool_use') {
      return [{ type: 'tool_use', id: String(item.id ?? ''), name: String(item.name ?? '') }];
    }
    if (item.type === 'tool_result') {
      return [{ type: 'tool_result', toolUseId: String(item.tool_use_id ?? ''), isError: item.is_error === true }];
    }
    if (item.type === 'thinking') {
      return [{ type: 'thinking', available: typeof item.thinking === 'string' && item.thinking.length > 0 }];
    }
    if (item.type === 'image') return [{ type: 'image', available: true }];
    return [];
  });
}

export function messagesFromHistory(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages.filter(m => m && (m.type === 'user' || m.type === 'assistant'))
    .map(m => ({
      id: String(m.id), role: m.type, text: textFromContent(m.content),
      timestamp: m.timestamp || '', blocks: summarizeBlocks(m.content)
    }))
    // Existing v0.1.5 transcript only displays messages with visible text.
    // Rich-only tool or media events must be rendered separately by M2.
    .filter(m => m.text);
}
