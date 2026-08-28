
export const LIKERT_LABELS = {
  1: 'Disagree strongly',
  2: 'Disagree a little',
  3: 'Neither agree nor disagree',
  4: 'Agree a little',
  5: 'Agree strongly',
};

export const STATEMENT_STEM = 'I see myself as someone who ';

export function statementBody(text) {
  if (typeof text !== 'string') return '';
  return text.startsWith(STATEMENT_STEM) ? text.slice(STATEMENT_STEM.length) : text;
}
