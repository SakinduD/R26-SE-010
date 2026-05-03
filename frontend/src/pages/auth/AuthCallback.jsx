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
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Completing sign in…</p>
      </div>
    </div>
  );
}
