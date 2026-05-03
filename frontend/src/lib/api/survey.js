import { authClient } from './client';

/**
 * @typedef {{ id: number, text: string, trait: 'O'|'C'|'E'|'A'|'N', reverse: boolean }} Question
 * @typedef {{ score: number, level: 'low'|'mid'|'high' }} TraitScore
 * @typedef {{ openness: TraitScore, conscientiousness: TraitScore, extraversion: TraitScore, agreeableness: TraitScore, neuroticism: TraitScore }} OceanScores
 * @typedef {{ user_id: string, scores: OceanScores, created_at: string, updated_at: string }} PersonalityProfile
 */

/** @returns {Promise<Question[]>} */
export async function getQuestions() {
  const res = await authClient.get('/api/v1/survey/questions');
  return res.data;
}

/**
 * @param {Record<number, number>} answers  questionId → likert value 1-5
 * @returns {Promise<PersonalityProfile>}
 */
export async function submitSurvey(answers) {
  const res = await authClient.post('/api/v1/survey/submit', { answers });
  return res.data;
}

/**
 * Returns the user's saved profile, or null if they haven't taken the survey yet.
 * @returns {Promise<PersonalityProfile|null>}
 */
export async function getMyProfile() {
  try {
    const res = await authClient.get('/api/v1/survey/profile/me');
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}
