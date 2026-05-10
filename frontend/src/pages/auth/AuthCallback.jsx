import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Landing page for Supabase email links (confirmation, password reset, magic link).
 * Supabase appends type + token_hash as query params — parse and redirect.
 */
export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');

    switch (type) {
      case 'signup':
      case 'email_change':
        toast.success('Email verified! You can now sign in.');
        navigate('/verify-email', { replace: true });
        break;
      case 'recovery':
        // Password reset — redirect to a new-password page when built
        navigate('/signin', { replace: true });
        break;
      default:
        navigate('/signin', { replace: true });
    }
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-canvas)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          color: 'var(--text-tertiary)',
        }}
      >
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" />
        <p className="t-body">Completing sign in…</p>
      </div>
    </div>
  );
}
