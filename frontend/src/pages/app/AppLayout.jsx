import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Joyride } from 'react-joyride';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
import { useAuth } from '@/lib/auth/context';
import * as authApi from '@/lib/api/auth';
import { AchievementsProvider } from '@/lib/achievements/AchievementsContext';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import BottomTabs from '@/components/layout/BottomTabs';

function NavSkeleton() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-hidden style={{ visibility: 'hidden' }} />
      <div className="app-main">
        <header className="topbar" aria-hidden style={{ visibility: 'hidden' }} />
        <main className="app-content">
          <div className="page">
            <div className="skel" style={{ width: 192, height: 32, marginBottom: 16 }} />
            <div className="skel" style={{ width: 288, height: 16 }} />
          </div>
        </main>
      </div>
    </div>
  );
}

const SIDEBAR_COLLAPSED_KEY = 'ez-sidebar-collapsed';
// User-scoped key so different accounts on the same browser each get their own flag.
const tourSeenKey = (email) => `ez-tour-seen:${email}`;

const TOUR_STEPS_CONFIG = [
  {
    target: '#sb-link-dashboard',
    title: 'Dashboard Overview',
    content: 'Welcome to your main dashboard! Here you can check your personality profile completeness, active training plan status, and your overall activity for the week.',
    placement: 'right',
    route: '/dashboard',
    skipBeacon: true,
  },
  {
    target: '#sb-link-survey',
    title: 'Personality Assessment',
    content: 'Take our tailored 44-statement personality assessment (BFI-44) to evaluate your traits and generate your personalized training scenarios.',
    placement: 'right',
    route: '/survey',
    skipBeacon: true,
  },
  {
    target: '#sb-link-baseline',
    title: 'Baseline Assessment',
    content: 'Record and set up your communication baseline. This helps measure your speech pitch, expressions, and posture improvements over time.',
    placement: 'right',
    route: '/baseline',
    skipBeacon: true,
  },
  {
    target: '#sb-link-training-plan-new',
    title: 'Create a New Plan',
    content: 'Generate a targeted plan focusing on specific soft skills or professional scenarios where you want to build confidence.',
    placement: 'right',
    route: '/training-plan/new',
    skipBeacon: true,
  },
  {
    target: '#sb-link-training-plan',
    title: 'Active Training Plan',
    content: 'Track and manage your current lesson pathways, progress achievements, and recommended interactive modules.',
    placement: 'right',
    route: '/training-plan',
    skipBeacon: true,
  },
  {
    target: '#sb-link-roleplay',
    title: 'Practice Lab',
    content: 'Enter the Practice Lab to participate in live, interactive roleplay scenarios with our advanced AI coaches.',
    placement: 'right',
    route: '/roleplay',
    skipBeacon: true,
  },
  {
    target: '#sb-link-multimodal-analysis',
    title: 'Multimodal Analysis',
    content: 'Engage with our real-time webcam and audio engine to analyze your facial expressions, vocal inflections, and gestures during conversations.',
    placement: 'right',
    route: '/multimodal-analysis',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-dashboard',
    title: 'Progress Overview',
    content: 'Explore your detailed analytics hub, tracking cumulative performance across all practice sessions.',
    placement: 'right',
    route: '/analytics-dashboard',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-skill-twin',
    title: 'Your Skill Twin',
    content: 'Meet your digital Twin profile which mirrors your behavioral patterns and shows areas of strengths and soft skill growth.',
    placement: 'right',
    route: '/analytics-skill-twin',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-progress-trends',
    title: 'Performance Trends',
    content: 'Visualize how your scores and communication metrics fluctuate and improve over daily or weekly training sessions.',
    placement: 'right',
    route: '/analytics-progress-trends',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-journey',
    title: 'Skill Journey & Badges',
    content: 'Track your gamified achievements, level progress, and unlocked badges as you progress in your training.',
    placement: 'right',
    route: '/analytics-journey',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-predictions',
    title: 'Predictive Insights',
    content: 'Review automated future outlook forecasts showing how current learning speed projects onto long-term career benchmarks.',
    placement: 'right',
    route: '/analytics-predictions',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-blind-spots',
    title: 'Behavioral Blind Spots',
    content: 'Examine subtle behavioral blind spots identified by our multimodal sensors and AI trainers during roleplay exercises.',
    placement: 'right',
    route: '/analytics-blind-spots',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-recommendations',
    title: 'Personalized Recommendations',
    content: 'Access actionable suggestions tailored by AI to address weaknesses and build on your current strengths.',
    placement: 'right',
    route: '/analytics-recommendations',
    skipBeacon: true,
  },
  {
    target: '#sb-link-analytics-session-report',
    title: 'Session Reports',
    content: 'Dive deep into detailed reports generated immediately after each practice session, detailing metrics and transcripts.',
    placement: 'right',
    route: '/analytics-session-report',
    skipBeacon: true,
  },
];


const joyrideStyles = {
  options: {
    arrowColor: 'var(--bg-surface)',
    backgroundColor: 'var(--bg-surface)',
    overlayColor: 'rgba(0, 0, 0, 0.60)',
    primaryColor: 'var(--accent)',
    textColor: 'var(--text-primary)',
    zIndex: 1200,
  },
  tooltip: {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    borderRadius: '12px',
    border: '1px solid var(--border-subtle)',
    boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4)',
    padding: '20px 22px',
    maxWidth: '320px',
  },
  tooltipContainer: {
    textAlign: 'left',
  },
  tooltipTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '8px',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
  },
  tooltipContent: {
    fontSize: '13px',
    lineHeight: '1.65',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
  },
  tooltipFooter: {
    marginTop: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  buttonPrimary: {
    backgroundColor: 'var(--accent)',
    color: '#ffffff',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 500,
    padding: '8px 16px',
    border: 'none',
    cursor: 'pointer',
    outline: 'none',
    letterSpacing: '0.01em',
  },
  buttonBack: {
    color: 'var(--text-secondary)',
    marginRight: '8px',
    fontSize: '13px',
    fontWeight: 500,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    padding: '8px 4px',
  },
  buttonSkip: {
    color: 'var(--text-tertiary)',
    fontSize: '12px',
    fontWeight: 400,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    padding: '4px 0',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },
  buttonClose: {
    color: 'var(--text-tertiary)',
    width: '18px',
    height: '18px',
    padding: '0',
    top: '12px',
    right: '12px',
    fontSize: '10px',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotlight: {
    borderRadius: '8px',
  },
};

export default function AppLayout() {
  const { isLoading } = useProtectedRoute();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [tourRun, setTourRun] = useState(false);
  const [tourKey, setTourKey] = useState(0);
  // Use a ref (not state) so React StrictMode's dev double-invoke doesn't reset
  // the guard and cancel the timer before it fires.
  const checkedForEmailRef = useRef(null);

  // Auto trigger tour on first-time login — driven by has_seen_tour from the DB.
  // Gate on !isLoading so the Sidebar (#sb-link-* targets) is mounted in the DOM.
  // NOTE: We deliberately do NOT return a clearTimeout cleanup here. React StrictMode
  // in dev double-invokes effects: mount → cleanup → mount again. Returning clearTimeout
  // would kill the timer on the first cleanup, and the second mount would skip (ref set).
  // Instead we guard inside the callback so only the first-fired timer acts.
  useEffect(() => {
    const email = user?.email;
    if (!isLoading && email && email !== checkedForEmailRef.current) {
      checkedForEmailRef.current = email;
      const key = tourSeenKey(email);

      // If DB already says seen, sync it to localStorage so future checks are instant.
      if (user.has_seen_tour) {
        try { localStorage.setItem(key, '1'); } catch { }
        return;
      }

      // localStorage guard: set BEFORE the timer fires so any refresh mid-delay
      // or mid-tour won't re-trigger it. Key is user-scoped so different accounts
      // on the same browser each get their own independent flag.
      const seenLocally = localStorage.getItem(key) === '1';
      if (!seenLocally) {
        // Mark locally immediately — this is the single source of truth for this browser.
        try { localStorage.setItem(key, '1'); } catch { }
        setTimeout(() => {
          setTourKey((prev) => prev + 1);
          setTourRun(true);
          navigate('/dashboard');
        }, 600);
      }
    }
  }, [isLoading, user, navigate]);

  // Listen for manual tour start event
  useEffect(() => {
    const handleStartTour = () => {
      setTourKey((prev) => prev + 1);
      setTourRun(true);
      navigate('/dashboard');
    };
    window.addEventListener('ez:start-tour', handleStartTour);
    return () => window.removeEventListener('ez:start-tour', handleStartTour);
  }, [navigate]);

  // Collapse sidebar listener
  useEffect(() => {
    const handler = () => {
      setSidebarCollapsed(true);
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
      } catch {
        // ignore
      }
    };
    window.addEventListener('ez:collapse-sidebar', handler);
    return () => window.removeEventListener('ez:collapse-sidebar', handler);
  }, []);

  // Immersive mode — fully hides the sidebar AND topbar (not just collapses
  // the sidebar to its icon rail, unlike ez:collapse-sidebar above, which
  // stays untouched for whatever already relies on it). Deliberately a
  // separate event/state rather than reusing that one, so this can't change
  // behavior for anything not explicitly opting into full immersion —
  // currently only RolePlaySessionV2. detail:true enters, detail:false (or
  // the dispatching page unmounting) exits.
  const [immersive, setImmersive] = useState(false);
  useEffect(() => {
    const handler = (e) => setImmersive(!!e.detail);
    window.addEventListener('ez:immersive-mode', handler);
    return () => window.removeEventListener('ez:immersive-mode', handler);
  }, []);

  if (isLoading) return <NavSkeleton />;

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleJoyrideCallback = (data) => {
    const { action, index, status, type } = data;

    if (type === 'step:after') {
      const nextIndex = index + (action === 'prev' ? -1 : 1);
      if (nextIndex >= 0 && nextIndex < TOUR_STEPS_CONFIG.length) {
        navigate(TOUR_STEPS_CONFIG[nextIndex].route);
      }
    } else if (status === 'finished' || status === 'skipped') {
      setTourRun(false);
      // Set localStorage immediately so refresh doesn't re-trigger the tour
      // even before the DB write completes. Key is user-scoped.
      try { localStorage.setItem(tourSeenKey(user.email), '1'); } catch { }
      // Persist to DB and sync the auth context user so has_seen_tour updates in-memory.
      authApi.markTourSeen()
        .then((updatedUser) => refreshUser(updatedUser))
        .catch(() => { });
    }
  };

  return (
    <AchievementsProvider>
      <div className="app-shell">
        {!immersive && (
          <Sidebar
            collapsed={tourRun ? false : sidebarCollapsed}
            onToggle={toggleSidebar}
            forceOpenProgress={tourRun}
          />
        )}
        <div className="app-main">
          {!immersive && <Topbar />}
          <main className="app-content">
            <Outlet />
          </main>
        </div>
        {!immersive && <BottomTabs />}

        <Joyride
          key={tourKey}
          steps={TOUR_STEPS_CONFIG}
          run={tourRun}
          callback={handleJoyrideCallback}
          continuous
          scrollToFirstStep
          options={{
            buttons: ['back', 'close', 'primary', 'skip'],
            showProgress: true,
            skipBeacon: true,
          }}
          disableOverlayClose
          disableCloseOnEsc={false}
          locale={{
            back: '← Back',
            close: '✕',
            last: 'Finish',
            next: 'Next →',
            skip: 'Stop Tour',
          }}
          styles={joyrideStyles}
        />
      </div>
    </AchievementsProvider>
  );
}
