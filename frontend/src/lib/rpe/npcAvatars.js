// Shared NPC identity pool — the avatar 3D model, its matching TalkingHead
// rig/voice config, a representative profile photo for pickers, and a
// suggested (fully renameable) default name. Used by both the scenario
// detail screen (where a learner can override the pick) and the role-play
// session itself (where the chosen — or randomly picked, if never
// overridden — identity actually renders).
//
// Paths are relative (not the @ alias): import.meta.glob resolves patterns
// statically at build time and doesn't reliably follow custom aliases.
const MALE_PROFILE_IMAGES = Object.values(
  import.meta.glob('../../assets/profileimg/male/*.png', { eager: true, import: 'default' })
)
const FEMALE_PROFILE_IMAGES = Object.values(
  import.meta.glob('../../assets/profileimg/female/*.png', { eager: true, import: 'default' })
)

// 3D models live in public/ (plain static files, not bundled src/ imports),
// so they're referenced by root-relative URL. "body" is TalkingHead's own
// rig-type option and must match each model's actual body, not just be
// cosmetic. ttsVoice must match gender too, or a male model speaks with a
// female Google voice regardless of which model is showing.
export const NPC_AVATAR_OPTIONS = [
  {
    id: 'david', label: 'David', gender: 'male',
    url: '/david.glb', body: 'M', ttsVoice: 'en-GB-Neural2-D',
    photo: MALE_PROFILE_IMAGES[0] ?? null,
  },
  {
    id: 'avatar', label: 'Maya', gender: 'female',
    url: '/avatar.glb', body: 'F', ttsVoice: 'en-GB-Neural2-C',
    photo: FEMALE_PROFILE_IMAGES[0] ?? null,
  },
  {
    id: 'avaturn', label: 'Sophie', gender: 'female',
    url: '/avaturn.glb', body: 'F', ttsVoice: 'en-GB-Neural2-C',
    photo: FEMALE_PROFILE_IMAGES[1] ?? FEMALE_PROFILE_IMAGES[0] ?? null,
  },
]

export function getAvatarOption(id) {
  return NPC_AVATAR_OPTIONS.find((a) => a.id === id) ?? null
}

// One random pick per session from the matching-gender pool, for scenarios
// where the learner never opened "view details" to override anything —
// covers every scenario, generated ones included, since gender is derived
// server-side per scenario_id rather than requiring per-scenario data.
export function pickNpcAvatar(gender) {
  const pool = NPC_AVATAR_OPTIONS.filter((a) => a.gender === (gender === 'male' ? 'male' : 'female'))
  const chosen = pool[Math.floor(Math.random() * pool.length)]
  return chosen ?? NPC_AVATAR_OPTIONS[0]
}

// Same random-within-gender pick, but for the profile-photo pool directly
// (kept independent of which 3D model is picked, e.g. for a plain scenario
// card that has no avatar picker at all).
export function pickNpcProfileImage(gender) {
  const pool = gender === 'female' ? FEMALE_PROFILE_IMAGES : MALE_PROFILE_IMAGES
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}
