import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function AuthLayout() {
  return (
    <div className="auth-shell">
      {/* Top-left brand */}
      <Link to="/" className="auth-logo" aria-label="EmpowerZ home">
        <div className="sb-mark" style={{ width: 28, height: 28, fontSize: 14 }}>EZ</div>
        <span className="sb-brand-text">EmpowerZ</span>
      </Link>

      {/* Top-right back link */}
      <Link
        to="/"
        className="t-cap"
        style={{
          position: 'fixed',
          top: 28,
          right: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--text-tertiary)',
          textDecoration: 'none',
          zIndex: 5,
        }}
      >
        <ArrowLeft size={14} strokeWidth={1.6} />
        Back to home
      </Link>

      {/* Centered card */}
      <div className="auth-card">
        <Outlet />
      </div>

      <div className="auth-footer">EmpowerZ — A SLIIT Research Project</div>
    </div>
  );
}
