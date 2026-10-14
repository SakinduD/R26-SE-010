import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Landing page for Supabase email links (confirmation, password reset, magic link).
 * Supabase appends type + tokens either as query params or in the URL hash
 * (#access_token=...&type=recovery) — read both, then redirect.
 */
export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    hashParams.forEach((value, key) => params.set(key, value));

    // Expired / already-used links come back as #error=...&error_description=...
    const error = params.get('error_description') || params.get('error');
    if (error) {
      toast.error(error.replace(/\+/g, ' '));
      navigate('/signin', { replace: true });
      return;
    }

    const type = params.get('type');

    switch (type) {
      case 'signup':
      case 'email_change':
        toast.success('Email verified! You can now sign in.');
        navigate('/verify-email', { replace: true });
        break;
      case 'recovery':
        // Hand the recovery token to the reset page via router state so it never
        // lingers in the address bar or browser history.
        navigate('/reset-password', {
          replace: true,
          state: { accessToken: params.get('access_token') },
        });
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
