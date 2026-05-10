import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getQuestions, submitSurvey } from '@/lib/api/survey';
import LikertOption from '@/components/ui/likert-option';
import ProgressBar from './ProgressBar';

const LS_KEY = 'adaptiq:bfi44:v1';

const LIKERT_LABELS = {
  1: 'Disagree strongly',
  2: 'Disagree a little',
  3: 'Neither agree nor disagree',
  4: 'Agree a little',
  5: 'Agree strongly',
};

function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDraft(answers) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(answers));
  } catch {
    // storage full — continue silently
  }
}

export default function SurveyForm({ initialAnswers }) {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const questionRef = useRef(null);

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [answers, setAnswers] = useState(() => ({ ...loadSaved(), ...initialAnswers }));
  const [submitting, setSubmitting] = useState(false);
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState(null);

  // Load questions on mount
  useEffect(() => {
    getQuestions()
      .then((qs) => {
        setQuestions(qs);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load questions. Please refresh.');
        setLoading(false);
      });
  }, []);

  const currentQ = questions[index];
  const isLast = index === questions.length - 1;
  const isFirst = index === 0;
  const currentAnswer = currentQ ? answers[currentQ.id] : undefined;
  const answeredCount = Object.keys(answers).filter(
    (k) => questions.some((q) => q.id === Number(k)),
  ).length;

  // Persist draft on every answer change
  useEffect(() => {
    if (Object.keys(answers).length > 0) saveDraft(answers);
  }, [answers]);

  // Focus new question card when index changes
  useEffect(() => {
    if (questionRef.current) questionRef.current.focus();
  }, [index]);

  const goNext = useCallback(() => {
    if (index < questions.length - 1) {
      setDirection(1);
      setIndex((i) => i + 1);
    }
  }, [index, questions.length]);

  const goPrev = useCallback(() => {
    if (index > 0) {
      setDirection(-1);
      setIndex((i) => i - 1);
    }
  }, [index]);

  const selectAnswer = useCallback(
    (value) => {
      if (!currentQ) return;
      setAnswers((prev) => ({ ...prev, [currentQ.id]: value }));

      // Clear any pending auto-advance
      if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);

      // Auto-advance after 250 ms (not on last question)
      if (!isLast) {
        const tid = setTimeout(() => {
          setDirection(1);
          setIndex((i) => i + 1);
        }, 250);
        setAutoAdvanceTimer(tid);
      }
    },
    [currentQ, isLast, autoAdvanceTimer],
  );

  // Cleanup timer on unmount
  useEffect(() => () => { if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer); }, [autoAdvanceTimer]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'BUTTON' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      switch (e.key) {
        case '1': case '2': case '3': case '4': case '5':
          selectAnswer(Number(e.key));
          break;
        case 'ArrowRight':
        case 'Enter':
          if (currentAnswer) goNext();
          break;
        case 'ArrowLeft':
          goPrev();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectAnswer, goNext, goPrev, currentAnswer]);

  const handleSubmit = async () => {
    if (answeredCount < questions.length) {
      toast.error(`Please answer all questions (${answeredCount} / ${questions.length} done)`);
      return;
    }
    setSubmitting(true);
    try {
      await submitSurvey(answers);
      localStorage.removeItem(LS_KEY);
      navigate('/survey/results');
    } catch (err) {
      toast.error(
        err.response?.data?.detail ?? 'Submission failed. Please try again.',
        { action: { label: 'Retry', onClick: handleSubmit } },
      );
      setSubmitting(false);
    }
  };

  // Motion variants — respect prefers-reduced-motion
  const variants = prefersReduced
    ? {
        enter:  { opacity: 0 },
        center: { opacity: 1 },
        exit:   { opacity: 0 },
      }
    : {
        enter:  (d) => ({ opacity: 0, x: d > 0 ? 48 : -48 }),
        center: { opacity: 1, x: 0 },
        exit:   (d) => ({ opacity: 0, x: d > 0 ? -48 : 48 }),
      };

  const optionVariants = {
    hidden:  { opacity: 0, y: prefersReduced ? 0 : 10 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.25, ease: 'easeOut', delay: i * 0.05 },
    }),
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '40vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  if (!currentQ) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 80 }}>
      <ProgressBar current={index + 1} total={questions.length} />

      <div className="page page-read">
        {/* Keyboard hint — first question only */}
        {isFirst && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="banner banner-info"
            style={{ marginBottom: 20 }}
            role="status"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              Press&nbsp;<kbd>1</kbd>–<kbd>5</kbd>&nbsp;to select,&nbsp;<kbd>→</kbd>&nbsp;or&nbsp;<kbd>Enter</kbd>&nbsp;to advance,&nbsp;<kbd>←</kbd>&nbsp;to go back.
            </span>
          </motion.div>
        )}

        {/* Question card */}
        <div style={{ overflow: 'hidden' }}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={currentQ.id}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: 'easeOut' }}
              style={{ display: 'flex', flexDirection: 'column' }}
              tabIndex={-1}
              ref={questionRef}
            >
              {/* Question text */}
              <div
                id={`question-label-${currentQ.id}`}
                className="card"
                style={{ marginBottom: 20, padding: 24 }}
              >
                <div className="t-over" style={{ marginBottom: 8 }}>
                  Question {index + 1} / {questions.length}
                </div>
                <p style={{ fontSize: 18, lineHeight: 1.45, color: 'var(--text-primary)', margin: 0, fontWeight: 400 }}>
                  {currentQ.text}
                </p>
              </div>

              {/* Likert options */}
              <div
                role="radiogroup"
                aria-labelledby={`question-label-${currentQ.id}`}
                className="likert-row"
              >
                {[1, 2, 3, 4, 5].map((val, i) => (
                  <motion.div
                    key={val}
                    custom={i}
                    variants={optionVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <LikertOption
                      value={val}
                      label={val}
                      selected={currentAnswer === val}
                      onSelect={selectAnswer}
                    />
                  </motion.div>
                ))}
              </div>

              {/* Likert verbal labels under each cell */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                {[1, 2, 3, 4, 5].map((val) => (
                  <div
                    key={`label-${val}`}
                    className="t-cap"
                    style={{ textAlign: 'center', fontSize: 10.5, lineHeight: 1.3 }}
                  >
                    {LIKERT_LABELS[val]}
                  </div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 8,
          }}
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst}
            className="btn btn-ghost"
          >
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ChevronLeft size={14} strokeWidth={1.8} />
              Back
            </span>
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || answeredCount < questions.length}
              className="btn btn-primary btn-lg"
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {submitting && <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit assessment'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!currentAnswer}
              className="btn btn-secondary"
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Next
                <ChevronRight size={14} strokeWidth={1.8} />
              </span>
            </button>
          )}
        </div>

        {/* Unanswered count hint */}
        {isLast && answeredCount < questions.length && (
          <p className="t-cap" style={{ marginTop: 12, textAlign: 'center' }}>
            {questions.length - answeredCount} question
            {questions.length - answeredCount !== 1 ? 's' : ''} still unanswered
            — use Back to review.
          </p>
        )}
      </div>
    </div>
  );
}
