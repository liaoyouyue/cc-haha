// Lightweight Markdown for assistant messages: headings, lists, quotes,
// fenced code, rules and inline bold/italic/code/links. No HTML, no webview —
// the renderer maps these tokens onto plain RN <Text>. Pure; tested.

export function parseInline(text) {
  const out = [];
  const push = (value, style) => {
    if (value) out.push({ text: value, ...style });
  };
  let rest = typeof text === 'string' ? text : '';
  while (rest.length) {
    const match = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/.exec(rest);
    if (!match) {
      push(rest, {});
      break;
    }
    if (match.index > 0) push(rest.slice(0, match.index), {});
    const token = match[0];
    if (token.startsWith('**')) push(token.slice(2, -2), { bold: true });
    else if (token.startsWith('`')) push(token.slice(1, -1), { code: true });
    else if (token.startsWith('*')) push(token.slice(1, -1), { italic: true });
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      push(link[1], { link: link[2] });
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

// Blocks: {type:'p'|'h1'|'h2'|'h3'|'quote'|'ul'|'ol'|'hr'|'code', ...}
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const flush = (type, value) => {
    if (type === 'ul' || type === 'ol') blocks.push({ type, items: value });
    else if (type === 'code') blocks.push({ type, lang: value.lang, text: value.text });
    else blocks.push({ type, text: value });
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      flush('code', { lang, text: body.join('\n') });
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { flush('hr', ''); i++; continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { flush('h' + heading[1].length, heading[2]); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      flush('quote', quote.join('\n'));
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      flush('ul', items);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      flush('ol', items);
      continue;
    }
    const para = [];
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^\s*(```|>|#{1,3}\s|[-*+]\s|\d+[.)]\s|---+\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) flush('p', para.join('\n'));
    else i++;
  }
  return blocks;
}

// A tool result that looks like a unified diff gets line-level styling.
export function looksLikeDiff(text) {
  const value = String(text ?? '');
  return /^(diff --git|@@ |--- a\/|\+\+\+ b\/)/m.test(value) &&
    /^[+-][^+-]/m.test(value);
}
