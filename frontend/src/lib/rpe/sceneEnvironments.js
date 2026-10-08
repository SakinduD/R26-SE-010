// Scenario → cinematic environment mapping for SceneEnvironmentV2.
//
// No environment/setting/location field exists anywhere in the RPE backend
// (verified against Backend/app/services/rpe_scenario_service.py and
// Backend/app/schemas/rpe.py) — scenarios only carry `category` (one of six
// Practice Lab categories) and a free-text `conflict_type`. Both are real
// fields already returned by the API; this file is what turns them into a
// visual environment, kept entirely outside SceneEnvironmentV2 itself so
// the component never hardcodes a scenario/category name.
//
// conflict_type is checked first — it says who's actually in the room
// (a manager, a peer, a client), which is a more direct environment signal
// than the broader practice category. category is the fallback, and
// managerOffice is the safe default (per spec) when neither is available.

export const ENABLE_CINEMATIC_ENVIRONMENT = true

export const DEFAULT_ENVIRONMENT_ID = 'managerOffice'

// Four real generated backgrounds live in public/rpe-background/ (no space
// in the folder name — kept a bare static path simple/URL-safe). Each was
// re-encoded from the ~1.8MB source renders down to a WEBP q70 desktop copy
// and a 900px-wide mobile copy (see the PR/session notes — originals are
// gone, these are lossless-enough at the blur+darken treatment this stage
// applies; nothing here is a placeholder gradient anymore).
const ASSET_BASE = '/rpe-background'

// id: internal key · label: not shown in UI, used by the dev-only preview
// selector (EnvironmentPreviewDev.jsx) only.
export const RPE_ENVIRONMENTS = {
  managerOffice: {
    id: 'managerOffice',
    label: 'Manager Office',
    backgroundImage: `${ASSET_BASE}/rpe-env-manager-office.webp`,
    backgroundImageMobile: `${ASSET_BASE}/rpe-env-manager-office-sm.webp`,
    // Desk sits right-of-frame in the source render; open floor + window
    // wall is left-of-center — that's where the avatar reads as "standing
    // in the room" rather than overlapping the furniture.
    backgroundPosition: '38% 38%',
    vignette: 0.40,
    blur: 3,
    brightness: 0.60,
    saturate: 0.80,
    contrast: 0.99,
    ambientMotion: 'low',
  },
  clientConference: {
    id: 'clientConference',
    label: 'Client Conference Room',
    backgroundImage: `${ASSET_BASE}/rpe-env-client-conference.webp`,
    backgroundImageMobile: `${ASSET_BASE}/rpe-env-client-conference-sm.webp`,
    backgroundPosition: '52% 36%',
    vignette: 0.36,
    blur: 3,
    brightness: 0.64,
    saturate: 0.85,
    contrast: 1.0,
    ambientMotion: 'medium',
  },
  privateMeeting: {
    id: 'privateMeeting',
    label: 'Private Meeting Room',
    backgroundImage: `${ASSET_BASE}/rpe-env-private-meeting.webp`,
    backgroundImageMobile: `${ASSET_BASE}/rpe-env-private-meeting-sm.webp`,
    backgroundPosition: '48% 38%',
    vignette: 0.38,
    blur: 3,
    brightness: 0.66,
    saturate: 0.88,
    contrast: 0.99,
    ambientMotion: 'low',
  },
  collaborativeOffice: {
    id: 'collaborativeOffice',
    label: 'Collaborative Open Office',
    backgroundImage: `${ASSET_BASE}/rpe-env-collaborative-office.webp`,
    backgroundImageMobile: `${ASSET_BASE}/rpe-env-collaborative-office-sm.webp`,
    backgroundPosition: '50% 40%',
    vignette: 0.28,
    blur: 2,
    brightness: 0.70,
    saturate: 0.92,
    contrast: 1.0,
    ambientMotion: 'medium',
  },
}

// The 6 Practice Lab categories (frontend/src/pages/RPE/ScenarioSelect.jsx
// CATEGORIES) — only 4 actually appear in current scenario data.
const CATEGORY_TO_ENVIRONMENT = {
  'Difficult Conversations': 'privateMeeting',
  'Conflict': 'managerOffice',
  'Assertiveness': 'collaborativeOffice',
  'Client Management': 'clientConference',
  'Negotiation': 'clientConference',
  'Leadership': 'managerOffice',
}

// Free-text conflict_type values observed across Backend/app/models/rpe/scenarios/*.json.
const CONFLICT_TYPE_TO_ENVIRONMENT = {
  manager_pressure: 'managerOffice',
  autonomy_conflict: 'managerOffice',
  peer_indirect: 'collaborativeOffice',
  peer_sabotage: 'collaborativeOffice',
  team_collaboration: 'collaborativeOffice',
  external_pressure: 'clientConference',
  negotiation: 'clientConference',
  presentation: 'clientConference',
  networking: 'collaborativeOffice',
}

export function resolveEnvironmentId(category, conflictType) {
  if (conflictType && CONFLICT_TYPE_TO_ENVIRONMENT[conflictType]) {
    return CONFLICT_TYPE_TO_ENVIRONMENT[conflictType]
  }
  if (category && CATEGORY_TO_ENVIRONMENT[category]) {
    return CATEGORY_TO_ENVIRONMENT[category]
  }
  return DEFAULT_ENVIRONMENT_ID
}

export function getEnvironment(environmentId) {
  return RPE_ENVIRONMENTS[environmentId] || RPE_ENVIRONMENTS[DEFAULT_ENVIRONMENT_ID]
}
