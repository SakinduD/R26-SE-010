import React from 'react';
import { LIKERT_LABELS, statementBody } from '@/lib/survey/statements';

const SCALE = [1, 2, 3, 4, 5];

export default function SurveyStatement({ question, number, value, isActive, onSelect }) {
  const answered = value !== undefined;

  return (
    <div
      className="survey-q"
      data-active={isActive || undefined}
      data-answered={answered || undefined}
    >
      <div className="survey-q-text">
        <span className="survey-q-num" aria-hidden>
          {number}
        </span>
        <span className="survey-q-body">{statementBody(question.text)}</span>
      </div>

      {/* data-question-id lets the form's key handler tell which row has focus,
          so 1–5 answers the row you tabbed into rather than the highlighted one. */}
      <div
        className="survey-scale"
        role="radiogroup"
        aria-label={question.text}
        data-question-id={question.id}
      >
        {SCALE.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={LIKERT_LABELS[v]}
            title={LIKERT_LABELS[v]}
            data-selected={value === v || undefined}
            className="survey-opt"
            onClick={() => onSelect(question.id, v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
