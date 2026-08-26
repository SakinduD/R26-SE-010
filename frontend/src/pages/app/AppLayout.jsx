import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';
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

export default function AppLayout() {
  const { isLoading } = useProtectedRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (isLoading) return <NavSkeleton />;

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore — worst case the preference just doesn't persist
      }
      return next;
    });
  };

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />
      <div className="app-main">
        <Topbar />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
