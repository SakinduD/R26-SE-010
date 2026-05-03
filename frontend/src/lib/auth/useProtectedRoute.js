import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './context';

/**
 * Redirects to /signin if the user is not authenticated.
 * Use in protected page components.
 *
 * @returns {{ isLoading: boolean }} — render a skeleton while isLoading is true
 */
export function useProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/signin', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return { isLoading };
}
