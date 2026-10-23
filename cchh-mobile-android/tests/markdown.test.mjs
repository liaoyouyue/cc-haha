import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, looksLikeDiff } from '../markdown.mjs';

test('parseMarkdown splits headings, paragraphs, lists, quotes and code', () => {
  const blocks = parseMarkdown(`# 标题
这是**第一段**
第二行

- 项目一
- 项目二

1. 第一步
2. 第二步

> 引用

\`\`\`js
const a = 1
\`\`\`

---`);
  assert.deepEqual(blocks.map(b => b.type), ['h1','p','ul','ol','quote','code','hr']);
  assert.equal(blocks[0].text, '标题');
  assert.equal(blocks[1].text, '这是**第一段**\n第二行');
  assert.deepEqual(blocks[2].items, ['项目一','项目二']);
  assert.deepEqual(blocks[3].items, ['第一步','第二步']);
  assert.equal(blocks[4].text, '引用');
  assert.equal(blocks[5].lang, 'js');
  assert.equal(blocks[5].text, 'const a = 1');
});

test('parseInline marks bold, italic, code and links without HTML', () => {
  assert.deepEqual(parseInline('a **b** `c` *d* [e](https://x.y)'), [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' ' },
    { text: 'c', code: true },
    { text: ' ' },
    { text: 'd', italic: true },
    { text: ' ' },
    { text: 'e', link: 'https://x.y' },
  ]);
});

test('parseInline leaves malformed markup as text', () => {
  const parts = parseInline('**unclosed and [broken](');
  assert.equal(parts.map(p => p.text).join(''), '**unclosed and [broken](');
});

test('looksLikeDiff only reports real diffs', () => {
  assert.equal(looksLikeDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new'), true);
  assert.equal(looksLikeDiff('just output\nwith + plus'), false);
  assert.equal(looksLikeDiff(''), false);
});