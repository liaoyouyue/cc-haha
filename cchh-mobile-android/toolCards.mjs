// Tool-call folding for chat messages, mirroring the upstream H5 "one card
// per tool run" pattern. Pure functions; tested in tests/toolCards.test.mjs.

// CCHH assistant message content blocks we understand.
// tool_use: {type:'tool_use', id, name, input}
// tool_result: {type:'tool_result', tool_use_id, content, is_error}
export function toolCardsFromContent(content) {
  if (!Array.isArray(content)) return [];
  const cards = [];
  const indexByUseId = new Map();
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use') {
      const card = {
        toolUseId: String(block.id ?? `tool-${cards.length}`),
        name: String(block.name ?? 'tool'),
        input: block.input ?? {},
        output: '',
        isError: false,
        images: [],
        complete: false,
      };
      indexByUseId.set(card.toolUseId, cards.length);
      cards.push(card);
    } else if (block.type === 'tool_result') {
      const idx = indexByUseId.get(String(block.tool_use_id));
      if (idx === undefined) continue;
      cards[idx].output = textOf(block.content);
      cards[idx].images = imageUrisOf(block.content);
      cards[idx].isError = Boolean(block.is_error);
      cards[idx].complete = true;
    }
  }
  return cards.filter((c) => c.complete);
}

function imageUrisOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && typeof b === 'object' && b.type === 'image' && b.source)
    .map((b) => {
      if (b.source.type === 'base64' && typeof b.source.data === 'string' && b.source.data) {
        return `data:${b.source.media_type || 'image/png'};base64,${b.source.data}`;
      }
      if (b.source.type === 'url' && typeof b.source.url === 'string' && /^https?:\/\//.test(b.source.url)) {
        return b.source.url;
      }
      return null;
    })
    .filter(Boolean);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('\n');
}

// Compact single-line summary for the folded card.
export function toolCardSummary(card) {
  const inputBrief = JSON.stringify(card.input ?? {}).slice(0, 160);
  const outputBrief = (card.output ?? '').trim().slice(0, 120);
  const out = outputBrief ? ` · ${outputBrief}` : '';
  return `${card.name}${inputBrief && inputBrief !== '{}' ? ' ' + inputBrief : ''}${out}`;
}

// Folded vs expanded state is UI state; this helper just tells the renderer
// whether a message contains tool cards at all.
export function hasToolCards(content) {
  return toolCardsFromContent(content).length > 0;
}