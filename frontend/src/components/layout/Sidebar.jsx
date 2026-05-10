import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Mic,
  Brain,
  Swords,
  Video,
  BarChart3,
  User,
  TrendingUp,
  Sparkles,
  Eye,
  Lightbulb,
  MessageSquare,
  FileText,
  Settings as SettingsIcon,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/context';

function SidebarLink({ to, icon: Icon, label, collapsed = false }) {
  const { pathname } = useLocation();
  const isActive = pathname === to;
  return (
    <Link
      to={to}
      className="sb-link"
      data-active={isActive}
      title={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
    >
      {Icon && (
        <span className="sb-icon">
          <Icon size={16} strokeWidth={1.6} />
        </span>
      )}
      <span className="sb-label">{label}</span>
    </Link>
  );
}

export default function Sidebar({ collapsed = false, onToggle }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const analyticsActive = pathname.startsWith('/analytics');
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  useEffect(() => {
    if (analyticsActive) setAnalyticsOpen(true);
  }, [analyticsActive]);

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    navigate('/');
  };

  const fullName = user?.display_name || user?.email || 'Guest';
  const initial = (user?.display_name || user?.email || 'U').charAt(0).toUpperCase();

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      {/* Brand + collapse toggle */}
      <div className="sb-brand">
        <Link to="/dashboard" className="sb-mark" aria-label="EmpowerZ home">
          EZ
        </Link>
        {!collapsed && <span className="sb-brand-text">EmpowerZ</span>}
        <div style={{ flex: 1 }} />
        {!collapsed && (
          <button
            className="icon-btn"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <PanelLeftClose size={14} strokeWidth={1.6} />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          className="icon-btn"
          style={{ alignSelf: 'center', marginBottom: 8 }}
          onClick={onToggle}
          aria-label="Expand sidebar"
          title="Expand"
        >
          <PanelLeft size={14} strokeWidth={1.6} />
        </button>
      )}

      {/* Overview */}
      <div className="sb-section-label">Overview</div>
      <SidebarLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />

      {/* Learn */}
      <div className="sb-section-label">Learn</div>
      <SidebarLink to="/survey" icon={ClipboardList} label="Assessment" collapsed={collapsed} />
      <SidebarLink to="/baseline" icon={Mic} label="Baseline" collapsed={collapsed} />
      <SidebarLink to="/training-plan" icon={Brain} label="Training Plan" collapsed={collapsed} />

      {/* Practice */}
      <div className="sb-section-label">Practice</div>
      <SidebarLink to="/roleplay" icon={Swords} label="Role Play" collapsed={collapsed} />
      <SidebarLink to="/multimodal-analysis" icon={Video} label="Multimodal" collapsed={collapsed} />

      {/* Progress (collapsible) */}
      <div
        className="sb-section-label"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>Progress</span>
        {!collapsed && (
          <button
            type="button"
            className="icon-btn"
            style={{ width: 20, height: 20 }}
            onClick={() => setAnalyticsOpen((o) => !o)}
            aria-label={analyticsOpen ? 'Collapse Progress section' : 'Expand Progress section'}
          >
            {analyticsOpen ? (
              <ChevronDown size={12} strokeWidth={1.6} />
            ) : (
              <ChevronRight size={12} strokeWidth={1.6} />
            )}
          </button>
        )}
      </div>
      <SidebarLink
        to="/analytics-dashboard"
        icon={BarChart3}
        label="Overview"
        collapsed={collapsed}
      />
      {analyticsOpen && !collapsed && (
        <div className="sb-sub">
          <SidebarLink to="/analytics-skill-twin" icon={User} label="Skill Twin" />
          <SidebarLink to="/analytics-progress-trends" icon={TrendingUp} label="Trends" />
          <SidebarLink to="/analytics-predictions" icon={Sparkles} label="Predictions" />
          <SidebarLink to="/analytics-blind-spots" icon={Eye} label="Blind Spots" />
          <SidebarLink to="/analytics-recommendations" icon={Lightbulb} label="Recommendations" />
          <SidebarLink to="/analytics-feedback" icon={MessageSquare} label="Self-Reflection" />
          <SidebarLink to="/analytics-session-report" icon={FileText} label="Session Report" />
        </div>
      )}

      <div className="sb-spacer" />

      {/* Settings */}
      <SidebarLink to="/settings" icon={SettingsIcon} label="Settings" collapsed={collapsed} />

      {/* User block */}
      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        {!collapsed && (
          <div className="sb-user-meta" style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--text-primary)',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={fullName}
            >
              {fullName}
            </div>
            <div
              className="t-cap"
              style={{
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={user?.email}
            >
              {user?.email || ''}
            </div>
          </div>
        )}
        {!collapsed && (
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={14} strokeWidth={1.6} />
          </button>
        )}
      </div>
    </aside>
  );
}
