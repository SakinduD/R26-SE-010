import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/context';
import { analyticsService } from '@/services/analytics/analyticsService';
import { consumeUnseenBadges } from './seenBadges';

/**
 * Shared gamification-badge state for the whole authenticated app shell.
 *
 * Mounted once (inside AppLayout, alongside Topbar), so it fetches and
 * "consumes" the unseen-badge diff exactly once per tab per user. Both the
 * Dashboard achievement toast and the Topbar notification bell read from
 * this single instance — if each fetched and consumed independently, whichever
 * mounted first would silently steal the unseen-badge diff from the other,
 * since a badge can only ever be marked "seen" once.
 */
const AchievementsContext = createContext({ badges: [], unseenBadges: [] });

// Module scope, resets on a full page reload — keyed per user id so
// switching accounts in one tab without reloading still gets its own fresh
// sync rather than inheriting the previous account's guard.
const gamificationSyncedUserIds = new Set();
// Guards the one-time unseen-badge diff itself (a badge can only ever be
// consumed once), independent of — and stricter than — the sync guard above,
// so a React StrictMode double-invoke in dev can't consume it twice.
let unseenConsumedThisSession = false;

export function AchievementsProvider({ children }) {
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const [badges, setBadges] = useState([]);
  const [unseenBadges, setUnseenBadges] = useState([]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !user?.id) return;
    let cancelled = false;
    const checkStartedAt = new Date().toISOString();

    const applyBadges = (list) => {
      if (cancelled || !list) return;
      setBadges(list);
      if (!unseenConsumedThisSession) {
        unseenConsumedThisSession = true;
        setUnseenBadges(consumeUnseenBadges(user.id, list, checkStartedAt));
      }
    };

    const fallbackToRead = () =>
      analyticsService
        .getGamificationByUser(user.id)
        .then((p) => applyBadges(p.badges))
        .catch(() => {});

    if (!gamificationSyncedUserIds.has(user.id)) {
      analyticsService
        .syncGamificationByUser(user.id)
        .then((result) => {
          gamificationSyncedUserIds.add(user.id);
          applyBadges(result.profile.badges);
        })
        .catch(fallbackToRead);
    } else {
      fallbackToRead();
    }

    return () => {
      cancelled = true;
    };
  }, [user?.id, isAuthLoading, isAuthenticated]);

  return (
    <AchievementsContext.Provider value={{ badges, unseenBadges }}>
      {children}
    </AchievementsContext.Provider>
  );
}

export function useAchievements() {
  return useContext(AchievementsContext);
}
