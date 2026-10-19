// Split assistant text into plain and fenced-code runs. A missing closing
// fence keeps the rest as code so a truncated stream still renders readably.
export function splitFences(text) {
  const parts = []
  const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0, match
  while ((match = fence.exec(text))) {
    if (match.index > last) parts.push({ code: false, text: text.slice(last, match.index) })
    parts.push({ code: true, text: match[2].replace(/\n$/, '') })
    last = fence.lastIndex
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) })
  return parts.filter(part => part.text)
}
