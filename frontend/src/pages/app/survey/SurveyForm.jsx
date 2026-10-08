import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getQuestions, submitSurvey } from '@/lib/api/survey';
import { LIKERT_LABELS, STATEMENT_STEM } from '@/lib/survey/statements';
import ProgressBar from './ProgressBar';
import SurveyStatement from './SurveyStatement';

const LS_KEY = 'adaptiq:bfi44:v1';

/** Statements shown at once. 44 items → 9 pages, the last one short. */
const PAGE_SIZE = 5;

/** How long a finished page stays on screen before sliding to the next one. */
const AUTO_ADVANCE_MS = 550;

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

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function scrollToTop(node, smooth) {
  const behavior = smooth ? 'smooth' : 'auto';
  node?.closest?.('.app-content')?.scrollTo?.({ top: 0, behavior });
  window.scrollTo({ top: 0, behavior });
}

function paceNote(page, pageCount) {
  if (pageCount <= 1) return "No right answers here — just what sounds like you.";
  if (page === 0) return "Go with your first reaction. It's usually the honest one.";
  if (page === pageCount - 1) return 'Last one. Then your profile is ready.';
  const through = (page + 1) / pageCount;
  if (through <= 0.35) return "No right answers here — just what sounds like you.";
  if (through <= 0.65) return "About halfway. You're making good time.";
  return 'Home stretch.';
}

export default function SurveyForm({ initialAnswers }) {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const headingRef = useRef(null);
  const rootRef = useRef(null);

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [answers, setAnswers] = useState(() => ({ ...loadSaved(), ...initialAnswers }));
  const [submitting, setSubmitting] = useState(false);

  // Set to the page the learner just answered on. Only that page is allowed to
  // auto-advance, so paging into an already-finished page sits still instead of
  // bouncing straight back out of it.
  const [advanceFrom, setAdvanceFrom] = useState(null);

  useEffect(() => {
    getQuestions()
      .then((qs) => {
        setQuestions(qs);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Couldn't load the statements. Try refreshing the page.");
        setLoading(false);
      });
  }, []);

  const pages = useMemo(() => chunk(questions, PAGE_SIZE), [questions]);
  const pageCount = pages.length;
  const currentPage = pages[page] ?? [];

  const answeredCount = useMemo(
    () => questions.reduce((n, q) => (answers[q.id] === undefined ? n : n + 1), 0),
    [questions, answers],
  );
  const pageComplete = useMemo(
    () => pages.map((qs) => qs.every((q) => answers[q.id] !== undefined)),
    [pages, answers],
  );

  const isPageComplete = pageComplete[page] ?? false;
  const isFirstPage = page === 0;
  const isLastPage = pageCount > 0 && page === pageCount - 1;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  // The statement the number keys will answer: the first one still blank on
  // this page. No extra state needed — it just moves down as you go.
  const activeId = useMemo(() => {
    const next = currentPage.find((q) => answers[q.id] === undefined);
    return next ? next.id : null;
  }, [currentPage, answers]);

  // Persist draft on every answer change
  useEffect(() => {
    if (Object.keys(answers).length > 0) saveDraft(answers);
  }, [answers]);

  // Resume where the draft left off, once, after the questions arrive.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current || pages.length === 0) return;
    didRestore.current = true;
    const firstGap = pages.findIndex((qs) => qs.some((q) => answers[q.id] === undefined));
    setPage(firstGap === -1 ? pages.length - 1 : firstGap);
  }, [pages, answers]);

  // Move to the top of the new page and hand focus to its heading, so the flow
  // reads correctly with a screen reader and doesn't strand a scrolled-down
  // reader mid-page.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return undefined;
    }
    scrollToTop(rootRef.current, !prefersReduced);
    // AnimatePresence runs the outgoing page out before mounting the new one,
    // so the incoming heading does not exist yet — wait out the exit before
    // reaching for it.
    const tid = setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 320);
    return () => clearTimeout(tid);
  }, [page, prefersReduced]);

  const goTo = useCallback(
    (target) => {
      const next = Math.max(0, Math.min(target, pageCount - 1));
      setAdvanceFrom(null);
      setDirection(next >= page ? 1 : -1);
      setPage(next);
    },
    [page, pageCount],
  );

  const goNext = useCallback(() => {
    setAdvanceFrom(null);
    setDirection(1);
    setPage((p) => Math.min(p + 1, pageCount - 1));
  }, [pageCount]);

  const goPrev = useCallback(() => {
    setAdvanceFrom(null);
    setDirection(-1);
    setPage((p) => Math.max(p - 1, 0));
  }, []);

  const handleSelect = useCallback(
    (questionId, value) => {
      // Functional update so a fast run of keystrokes can't overwrite an answer
      // recorded a moment earlier from a stale copy of `answers`.
      setAnswers((prev) => (prev[questionId] === value ? prev : { ...prev, [questionId]: value }));
      setAdvanceFrom(page);
    },
    [page],
  );

  // Slide on once the page the learner is working through is fully answered.
  useEffect(() => {
    if (advanceFrom === null) return undefined;
    if (advanceFrom !== page) {
      setAdvanceFrom(null);
      return undefined;
    }
    if (!isPageComplete || isLastPage) return undefined;

    const tid = setTimeout(() => {
      setDirection(1);
      setPage((p) => Math.min(p + 1, pageCount - 1));
      setAdvanceFrom(null);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(tid);
  }, [advanceFrom, page, isPageComplete, isLastPage, pageCount]);

  // Keyboard: 1–5 answers the highlighted statement, arrows change page.
  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el?.isContentEditable) return;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // The scale the learner has tabbed into, if any. Focus wins over the
      // highlighted row — pressing 4 should answer the row you are looking at.
      const scale = el?.closest?.('.survey-scale');

      if (/^[1-5]$/.test(e.key)) {
        const focused = Number(scale?.dataset?.questionId);
        const target = Number.isFinite(focused) ? focused : activeId;
        if (target === null) return;
        e.preventDefault();
        handleSelect(target, Number(e.key));
        return;
      }

      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;

      // Inside a scale, arrows do what arrows do in a radio group: move across
      // the five options. Only outside one do they turn the page.
      if (scale) {
        const opts = Array.from(scale.querySelectorAll('.survey-opt'));
        const at = opts.indexOf(el);
        if (at !== -1) {
          e.preventDefault();
          const to = e.key === 'ArrowRight' ? Math.min(at + 1, opts.length - 1) : Math.max(at - 1, 0);
          opts[to]?.focus();
          return;
        }
      }

      e.preventDefault();
      if (e.key === 'ArrowRight') goNext();
      else goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeId, handleSelect, goNext, goPrev]);

  const handleSubmit = useCallback(async () => {
    if (!allAnswered) {
      const gap = pages.findIndex((qs) => qs.some((q) => answers[q.id] === undefined));
      const left = questions.length - answeredCount;
      toast.error(
        `${left} statement${left === 1 ? '' : 's'} still need${left === 1 ? 's' : ''} an answer.`,
      );
      if (gap !== -1) goTo(gap);
      return;
    }
    setSubmitting(true);
    try {
      await submitSurvey(answers);
      localStorage.removeItem(LS_KEY);
      navigate('/survey/results');
    } catch (err) {
      toast.error(err.response?.data?.detail ?? "Couldn't save your answers. Give it another go.", {
        action: { label: 'Retry', onClick: () => handleSubmit() },
      });
      setSubmitting(false);
    }
  }, [allAnswered, answers, answeredCount, goTo, navigate, pages, questions.length]);

  // Motion variants — respect prefers-reduced-motion
  const variants = prefersReduced
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        enter: (d) => ({ opacity: 0, x: d > 0 ? 40 : -40 }),
        center: { opacity: 1, x: 0 },
        exit: (d) => ({ opacity: 0, x: d > 0 ? -40 : 40 }),
      };

  const rowVariants = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 8 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.22, ease: 'easeOut', delay: i * 0.045 },
    }),
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '40vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  if (currentPage.length === 0) return null;

  const firstNumber = page * PAGE_SIZE + 1;
  const lastNumber = page * PAGE_SIZE + currentPage.length;
  const remaining = questions.length - answeredCount;

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', paddingBottom: 96 }}>
      <ProgressBar
        answered={answeredCount}
        total={questions.length}
        page={page}
        pageCount={pageCount}
        pageComplete={pageComplete}
        onJump={goTo}
      />

      <div className="page page-read">
        {isFirstPage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="banner banner-info"
            style={{ marginBottom: 20 }}
            role="status"
          >
            <span className="survey-hint">
              Press <kbd>1</kbd>–<kbd>5</kbd> to answer the highlighted statement,
              and <kbd>←</kbd> <kbd>→</kbd> to move between pages.
            </span>
          </motion.div>
        )}

        <div style={{ overflow: 'hidden' }}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.section
              key={page}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.26, ease: 'easeOut' }}
            >
              <header
                ref={headingRef}
                tabIndex={-1}
                style={{ outline: 'none', marginBottom: 18 }}
              >
                <div className="t-over" style={{ marginBottom: 6 }}>
                  Statements {firstNumber}–{lastNumber} of {questions.length}
                </div>
                <h2 className="t-h3" style={{ margin: 0 }}>
                  {STATEMENT_STEM.trim()}…
                </h2>
                <p className="t-cap" style={{ margin: '6px 0 0' }}>
                  {paceNote(page, pageCount)}
                </p>
              </header>

              <div className="survey-legend" aria-hidden>
                <span className="t-cap" style={{ fontSize: 11 }}>
                  1 = disagree · 5 = agree
                </span>
                <div className="survey-legend-scale">
                  <span className="survey-legend-end is-start">{LIKERT_LABELS[1]}</span>
                  <span className="survey-legend-end is-end">{LIKERT_LABELS[5]}</span>
                </div>
              </div>

              <div className="survey-list">
                {currentPage.map((q, i) => (
                  <motion.div
                    key={q.id}
                    custom={i}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <SurveyStatement
                      question={q}
                      number={page * PAGE_SIZE + i + 1}
                      value={answers[q.id]}
                      isActive={q.id === activeId}
                      onSelect={handleSelect}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.section>
          </AnimatePresence>
        </div>

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
          <button type="button" onClick={goPrev} disabled={isFirstPage} className="btn btn-ghost">
            <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ChevronLeft size={14} strokeWidth={1.8} />
              Back
            </span>
          </button>

          {isLastPage ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-primary btn-lg"
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {submitting && <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />}
                {submitting ? 'Building your profile…' : 'See my results'}
              </span>
            </button>
          ) : (
            // Never disabled — someone who wants to sit on a statement and come
            // back to it should not be walled in. The button promoting itself to
            // primary is the nudge instead.
            <button
              type="button"
              onClick={goNext}
              className={isPageComplete ? 'btn btn-primary' : 'btn btn-secondary'}
            >
              <span className="btn-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Next
                <ChevronRight size={14} strokeWidth={1.8} />
              </span>
            </button>
          )}
        </div>

        {isLastPage && remaining > 0 && (
          <p className="t-cap" style={{ marginTop: 12, textAlign: 'center' }}>
            {remaining} statement{remaining === 1 ? '' : 's'} still blank — we'll take you
            straight there.
          </p>
        )}
      </div>
    </div>
  );
}
