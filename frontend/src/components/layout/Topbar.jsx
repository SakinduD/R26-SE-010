import React from 'react';
import { useLocation } from 'react-router-dom';
import { Info, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import NotificationBell from '@/components/achievements/NotificationBell';
import ActiveSessionNudge from '@/components/RPE/ActiveSessionNudge';

const CRUMB_MAP = {
  '/dashboard': ['Overview', 'Dashboard'],
  '/survey': ['Learn', 'Assessment'],
  '/survey/results': ['Learn', 'Assessment', 'Results'],
  '/baseline': ['Learn', 'Voice Baseline'],
  '/training-plan': ['Learn', 'Training Plan'],
  '/roleplay': ['Practice', 'Role Play'],
  '/roleplay/session': ['Practice', 'Role Play', 'Session'],
  '/roleplay/session/complete': ['Practice', 'Role Play', 'Session Complete'],
  '/roleplay/my-sessions': ['Practice', 'My Journey'],
  '/multimodal-analysis': ['Practice', 'Multimodal'],
  '/analytics-dashboard': ['Progress', 'Overview'],
  '/analytics-recommendations': ['Progress', 'Recommendations'],
  '/analytics-feedback': ['Progress', 'Self-Reflection'],
  '/analytics-skill-twin': ['Progress', 'Skill Twin'],
  '/analytics-predictions': ['Progress', 'Predictions'],
  '/analytics-blind-spots': ['Progress', 'Blind Spots'],
  '/analytics-progress-trends': ['Progress', 'Trends'],
  '/analytics-journey': ['Progress', 'Skill Journey'],
  '/analytics-session-report': ['Progress', 'Session Report'],
  '/settings': ['Settings'],
  '/admin': ['Admin'],
  '/styleguide': ['Styleguide'],
};

function getCrumbs(pathname) {
  if (CRUMB_MAP[pathname]) return CRUMB_MAP[pathname];

  // Parameterised routes: try the longest matching prefix
  if (pathname.startsWith('/roleplay/session/')) return ['Practice', 'Role Play', 'Session'];
  if (pathname.startsWith('/roleplay/feedback')) return ['Practice', 'Role Play', 'Feedback'];
  if (pathname.startsWith('/analytics/users/')) {
    if (pathname.endsWith('/skill-twin')) return ['Progress', 'Skill Twin'];
    if (pathname.endsWith('/predictions')) return ['Progress', 'Predictions'];
    if (pathname.endsWith('/blind-spots')) return ['Progress', 'Blind Spots'];
    if (pathname.endsWith('/progress')) return ['Progress', 'Trends'];
    if (pathname.endsWith('/journey')) return ['Progress', 'Skill Journey'];
    if (pathname.endsWith('/recommendations')) return ['Progress', 'Recommendations'];
    return ['Progress'];
  }
  if (pathname.startsWith('/analytics/sessions/')) {
    if (pathname.endsWith('/feedback')) return ['Progress', 'Self-Reflection'];
    if (pathname.endsWith('/blind-spots')) return ['Progress', 'Blind Spots'];
    if (pathname.endsWith('/report')) return ['Progress', 'Session Report'];
    return ['Progress'];
  }

  return ['—'];
}

export default function Topbar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const parts = getCrumbs(pathname);
  const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase();

  return (
    <header className="topbar">
      <div className="crumb">
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="crumb-sep">/</span>}
            <span className={i === parts.length - 1 ? 'crumb-cur' : undefined}>{p}</span>
          </React.Fragment>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <div className="topbar-actions">
        <button className="topbar-search" type="button">
          <Search size={13} strokeWidth={1.8} />
          <span className="t-cap">Search</span>
          <kbd>⌘K</kbd>
        </button>

        <ActiveSessionNudge />

        <div className="topbar-icons">
          <NotificationBell />
          <button
            className="icon-btn"
            aria-label="Help"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('ez:start-tour'))}
          >
            <Info size={14} strokeWidth={1.6} />
          </button>
        </div>

        <div className="topbar-divider" aria-hidden />

        <div className="topbar-avatar" aria-hidden>
          {initial}
        </div>
      </div>
    </header>
  );
}
