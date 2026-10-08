/**
 * Tracks which earned badge_keys a learner has already been shown an
 * achievement toast for. Frontend-only, namespaced per user id so switching
 * accounts on one browser never leaks or hides badges between learners.
 */

const KEY_PREFIX = 'empowerz:achievements:seen:v1:';

function keyFor(userId) {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * @returns {string[] | null} badge_keys already shown to this user, or
 * `null` when this user has never been recorded before — distinct from an
 * initialized-but-empty array, so callers can tell "first time we've ever
 * looked at this account" apart from "we looked before and they had none."
 */
function getSeenBadgeKeys(userId) {
  try {
    if (typeof window === 'undefined' || !userId) return null;
    const raw = localStorage.getItem(keyFor(userId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setSeenBadgeKeys(userId, badgeKeys) {
  try {
    if (typeof window === 'undefined' || !userId) return;
    localStorage.setItem(keyFor(userId), JSON.stringify(badgeKeys || []));
  } catch {}
}

/**
 * Returns earned-but-unseen badges (oldest-earned first) and persists them
 * as seen.
 *
 * On a user's very first-ever call (no stored key yet), badges earned
 * *before* `checkStartedAt` are silently baselined as "already seen" rather
 * than toasting every badge a longtime user has ever earned all at once the
 * first time this ships. Badges earned at or after `checkStartedAt` — e.g.
 * a threshold the sync this very check triggered just crossed — are still
 * genuinely new and are returned so they toast even on a first visit.
 *
 * @param {string} userId
 * @param {Array<{badge_key: string, earned: boolean, earned_at: string|null}>} badges
 * @param {string|number|Date} [checkStartedAt] timestamp captured before the
 *   sync/read call that produced `badges`, used only on a first-ever check.
 * @returns {Array<{badge_key: string, earned: boolean, earned_at: string|null}>}
 */
export function consumeUnseenBadges(userId, badges, checkStartedAt) {
  if (!userId) return [];
  const earned = (badges || []).filter((badge) => badge.earned);
  const previouslySeen = getSeenBadgeKeys(userId);

  let unseen;
  if (previouslySeen === null) {
    const cutoff = checkStartedAt ? new Date(checkStartedAt).getTime() : null;
    unseen = cutoff
      ? earned.filter((badge) => badge.earned_at && new Date(badge.earned_at).getTime() >= cutoff)
      : [];
  } else {
    unseen = earned.filter((badge) => !previouslySeen.includes(badge.badge_key));
  }

  setSeenBadgeKeys(userId, earned.map((badge) => badge.badge_key));
  return unseen.slice().sort((a, b) => new Date(a.earned_at) - new Date(b.earned_at));
}
