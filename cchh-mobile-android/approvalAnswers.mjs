// AskUserQuestion support. CCHH answers the permission request with
// updatedInput = {...originalInput, answers: {[questionText]: answer}}, as
// desktop/src/components/chat/AskUserQuestion.tsx does. Pure; tested.

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseAskUserQuestion(input) {
  const questions = isRecord(input) && Array.isArray(input.questions) ? input.questions : [];
  return questions
    .filter(q => isRecord(q) && typeof q.question === 'string')
    .map(q => ({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : '',
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter(o => isRecord(o) && typeof o.label === 'string')
        .map(o => ({
          label: o.label,
          description: typeof o.description === 'string' ? o.description : '',
        })),
    }));
}

// selections: string[][] one array of chosen labels per question.
// freeTexts: string[] one manual answer per question (wins over selections,
// matching the desktop's freeText priority).
export function buildAnswers(questions, selections, freeTexts) {
  const answers = {};
  const missing = [];
  questions.forEach((q, index) => {
    const free = String(freeTexts?.[index] ?? '').trim();
    const picked = (selections?.[index] ?? []).filter(Boolean);
    const answer = free || picked.join(', ');
    if (answer) answers[q.question] = answer;
    else missing.push(index);
  });
  return { answers, missing, complete: missing.length === 0 };
}

// Merge into the original tool input exactly like the desktop does.
export function withAnswers(input, answers) {
  return { ...(isRecord(input) ? input : {}), answers };
}
