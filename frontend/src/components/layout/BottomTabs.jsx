import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Swords,
  BarChart3,
  MoreHorizontal,
} from 'lucide-react';

const ITEMS = [
  {
    to: '/dashboard',
    icon: LayoutDashboard,
    label: 'Home',
    match: ['/dashboard'],
  },
  {
    to: '/survey',
    icon: ClipboardList,
    label: 'Learn',
    match: ['/survey', '/baseline', '/training-plan'],
  },
  {
    to: '/roleplay',
    icon: Swords,
    label: 'Practice',
    match: ['/roleplay', '/multimodal-analysis'],
  },
  {
    to: '/analytics-dashboard',
    icon: BarChart3,
    label: 'Progress',
    match: ['/analytics'],
  },
  {
    to: '/settings',
    icon: MoreHorizontal,
    label: 'More',
    match: ['/settings'],
  },
];

export default function BottomTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-tabs" aria-label="Mobile navigation">
      <div className="bottom-tabs-inner">
        {ITEMS.map(({ to, icon: Icon, label, match }) => {
          const active = match.some((m) => pathname.startsWith(m));
          return (
            <Link key={to} to={to} className="bot-link" data-active={active}>
              <Icon size={18} strokeWidth={1.6} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
