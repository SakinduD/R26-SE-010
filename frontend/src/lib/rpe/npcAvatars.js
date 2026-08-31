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
// female Google voice regardless of which model is showing. Only two
// distinct en-GB Neural2 voices exist per gender in Google's catalog beyond
// the ones already proven working here, so they're cycled across the extra
// models rather than every avatar getting a fully unique voice.
const MALE_VOICES   = ['en-GB-Neural2-D', 'en-GB-Neural2-B']
const FEMALE_VOICES = ['en-GB-Neural2-C', 'en-GB-Neural2-A', 'en-GB-Neural2-F']

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
  {
    id: 'james', label: 'James', gender: 'male',
    url: '/male-avatar1.glb', body: 'M', ttsVoice: MALE_VOICES[1],
    photo: MALE_PROFILE_IMAGES[1] ?? null,
  },
  {
    id: 'ethan', label: 'Ethan', gender: 'male',
    url: '/male-avatar2.glb', body: 'M', ttsVoice: MALE_VOICES[0],
    photo: MALE_PROFILE_IMAGES[2] ?? null,
  },
  {
    id: 'marcus', label: 'Marcus', gender: 'male',
    url: '/male-avatar3.glb', body: 'M', ttsVoice: MALE_VOICES[1],
    photo: MALE_PROFILE_IMAGES[3] ?? null,
  },
  {
    id: 'noah', label: 'Noah', gender: 'male',
    url: '/male-avatar4.glb', body: 'M', ttsVoice: MALE_VOICES[0],
    photo: MALE_PROFILE_IMAGES[4] ?? null,
  },
  {
    id: 'alex', label: 'Alex', gender: 'male',
    url: '/male-avatar5-sunglasses.glb', body: 'M', ttsVoice: MALE_VOICES[1],
    photo: MALE_PROFILE_IMAGES[5] ?? null,
    // Sunglasses read as an odd, distracting choice for an internal
    // manager/colleague scenario, but fit a customer who might genuinely
    // show up in whatever they like — so this is excluded from the random
    // per-scenario pick (pickNpcAvatar below) unless the NPC's own role
    // reads as a client/customer. A learner can still hand-pick it for any
    // scenario from the "view details" avatar picker regardless — this only
    // narrows the *default*, never forbids an explicit choice.
    special: 'customer',
  },
  {
    id: 'liam', label: 'Liam', gender: 'male',
    url: '/male-avatar6.glb', body: 'M', ttsVoice: MALE_VOICES[0],
    photo: MALE_PROFILE_IMAGES[6] ?? null,
  },
  {
    id: 'daniel', label: 'Daniel', gender: 'male',
    url: '/male-avatar7.glb', body: 'M', ttsVoice: MALE_VOICES[1],
    photo: MALE_PROFILE_IMAGES[7] ?? null,
  },
  {
    id: 'ryan', label: 'Ryan', gender: 'male',
    url: '/male-avatar8.glb', body: 'M', ttsVoice: MALE_VOICES[0],
    photo: MALE_PROFILE_IMAGES[8] ?? null,
  },
  {
    id: 'grace', label: 'Grace', gender: 'female',
    url: '/female-avatar1.glb', body: 'F', ttsVoice: FEMALE_VOICES[1],
    photo: FEMALE_PROFILE_IMAGES[2] ?? null,
  },
  {
    id: 'olivia', label: 'Olivia', gender: 'female',
    url: '/female-avatar2.glb', body: 'F', ttsVoice: FEMALE_VOICES[2],
    photo: FEMALE_PROFILE_IMAGES[3] ?? null,
  },
  {
    id: 'emma', label: 'Emma', gender: 'female',
    url: '/female-avatar3.glb', body: 'F', ttsVoice: FEMALE_VOICES[0],
    photo: FEMALE_PROFILE_IMAGES[4] ?? null,
  },
  {
    id: 'chloe', label: 'Chloe', gender: 'female',
    url: '/female-avatar4.glb', body: 'F', ttsVoice: FEMALE_VOICES[1],
    photo: FEMALE_PROFILE_IMAGES[5] ?? null,
  },
  {
    id: 'isla', label: 'Isla', gender: 'female',
    url: '/female-avatar5.glb', body: 'F', ttsVoice: FEMALE_VOICES[2],
    photo: FEMALE_PROFILE_IMAGES[6] ?? null,
  },
]

export function getAvatarOption(id) {
  return NPC_AVATAR_OPTIONS.find((a) => a.id === id) ?? null
}

// Whether an NPC counts as "dealing with a customer" for avatar-pool
// purposes — checked against whatever's on hand (npc_role reliably names
// the character, e.g. "Dismissive Client"; scenario title is a fallback for
// callers that only have that). Matches the same "client"/"customer" signal
// rpe_scenario_service.infer_category (backend) uses for its own
// "Client Management" categorisation, kept in sync deliberately rather than
// introducing a second, differently-tuned classifier.
function isCustomerFacing(npcRole, scenarioTitle) {
  const text = `${npcRole ?? ''} ${scenarioTitle ?? ''}`.toLowerCase()
  return text.includes('client') || text.includes('customer')
}

// One random pick per session from the matching-gender pool, for scenarios
// where the learner never opened "view details" to override anything —
// covers every scenario, generated ones included, since gender is derived
// server-side per scenario_id rather than requiring per-scenario data.
// npcRole/scenarioTitle are optional context so special-tagged avatars
// (currently just the sunglasses one) only ever get auto-picked for a
// scenario they actually fit — see NPC_AVATAR_OPTIONS' own comment.
export function pickNpcAvatar(gender, npcRole, scenarioTitle) {
  const wantGender = gender === 'male' ? 'male' : 'female'
  const customerContext = isCustomerFacing(npcRole, scenarioTitle)
  const pool = NPC_AVATAR_OPTIONS.filter(
    (a) => a.gender === wantGender && (!a.special || (a.special === 'customer' && customerContext))
  )
  const chosen = pool[Math.floor(Math.random() * pool.length)]
  return chosen ?? NPC_AVATAR_OPTIONS[0]
}

// Same random-within-gender pick, but for the profile-photo pool directly
// (kept independent of which 3D model is picked, e.g. for a plain scenario
// card that has no avatar picker at all). No special-avatar concept here —
// it's just a photo, not a rendered character choice.
export function pickNpcProfileImage(gender) {
  const pool = gender === 'female' ? FEMALE_PROFILE_IMAGES : MALE_PROFILE_IMAGES
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}
