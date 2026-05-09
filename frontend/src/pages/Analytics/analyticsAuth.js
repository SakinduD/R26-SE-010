import { useAuth } from '../../lib/auth/context'

export function getAnalyticsUserId(user) {
  return user?.id || user?.user_id || user?.sub || user?.email || ''
}

export function useAnalyticsIdentity(routeUserId) {
  const { user, isLoading, isAuthenticated } = useAuth()
  const authenticatedUserId = getAnalyticsUserId(user)
  // ALWAYS use real authenticated user - NO FALLBACK TO TEST DATA
  const userId = routeUserId || authenticatedUserId
  const userLabel = user?.display_name || user?.email || userId

  return {
    user,
    userId,
    userLabel,
    isAuthLoading: isLoading,
    isAuthenticated,
    isUsingAuthenticatedUser: Boolean(!routeUserId && authenticatedUserId),
  }
}
