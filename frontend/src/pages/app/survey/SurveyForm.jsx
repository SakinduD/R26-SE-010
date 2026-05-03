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
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentQ) return null;

  return (
    <div className="flex flex-col">
      <ProgressBar current={index + 1} total={questions.length} />

      <div className="mx-auto w-full max-w-xl px-4 py-8">
        {/* Keyboard hint — first question only */}
        {isFirst && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-2 rounded-lg border border-border/50 bg-accent/40 px-3.5 py-2.5 text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">Tip:</span>
            Press&nbsp;<kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">1</kbd>–
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">5</kbd>&nbsp;to select,&nbsp;
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">→</kbd>&nbsp;or&nbsp;
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd>&nbsp;to advance,&nbsp;
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">←</kbd>&nbsp;to go back.
          </motion.div>
        )}

        {/* Question card */}
        <div className="overflow-hidden">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={currentQ.id}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: 'easeOut' }}
              className="flex flex-col"
              tabIndex={-1}
              ref={questionRef}
            >
              {/* Question text */}
              <div
                id={`question-label-${currentQ.id}`}
                className="mb-5 rounded-xl border border-border/60 bg-card p-5 shadow-sm"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                  Question {index + 1}
                </p>
                <p className="text-base font-medium leading-relaxed text-foreground">
                  {currentQ.text}
                </p>
              </div>

              {/* Likert options */}
              <div
                role="radiogroup"
                aria-labelledby={`question-label-${currentQ.id}`}
                className="space-y-2"
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
                      label={LIKERT_LABELS[val]}
                      selected={currentAnswer === val}
                      onSelect={selectAnswer}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronLeft className="size-4" />
            Back
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || answeredCount < questions.length}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'Submitting…' : 'Submit assessment'}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!currentAnswer}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>

        {/* Unanswered count hint */}
        {isLast && answeredCount < questions.length && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {questions.length - answeredCount} question
            {questions.length - answeredCount !== 1 ? 's' : ''} still unanswered
            — use Back to review.
          </p>
        )}
      </div>
    </div>
  );
}
