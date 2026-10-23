import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAskUserQuestion, buildAnswers, withAnswers } from '../approvalAnswers.mjs';

const input = {
  questions: [
    { question: '选择部署方式？', header: '部署', multiSelect: false,
      options: [{ label: 'LAN' }, { label: '公网', description: 'ngrok' }] },
    { question: '需要哪些功能？', header: '功能', multiSelect: true,
      options: [{ label: '审批' }, { label: '停止' }] },
    { bad: true },
  ],
  metadata: { source: 'phone' },
};

test('parseAskUserQuestion trusts only string fields', () => {
  const questions = parseAskUserQuestion(input);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].header, '部署');
  assert.equal(questions[0].options[1].description, 'ngrok');
  assert.equal(questions[1].multiSelect, true);
});

test('buildAnswers maps answers by question text and reports gaps', () => {
  const questions = parseAskUserQuestion(input);
  const { answers, missing, complete } = buildAnswers(questions, [['公网'], []], ['', '审批, 停止']);
  assert.deepEqual(answers, { '选择部署方式？': '公网', '需要哪些功能？': '审批, 停止' });
  assert.equal(complete, true);
  assert.deepEqual(missing, []);

  const partial = buildAnswers(questions, [[], []], ['', '']);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, [0, 1]);
});

test('free text wins over selections like the desktop', () => {
  const questions = parseAskUserQuestion(input);
  const { answers } = buildAnswers(questions, [['LAN'], []], ['自定义地址', '']);
  assert.equal(answers['选择部署方式？'], '自定义地址');
});

test('withAnswers keeps the original tool input and merges answers', () => {
  const merged = withAnswers(input, { '选择部署方式？': 'LAN' });
  assert.equal(merged.metadata.source, 'phone');
  assert.equal(merged.questions.length, 3);
  assert.equal(merged.answers['选择部署方式？'], 'LAN');
});