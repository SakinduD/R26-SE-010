# Feedback Analytics Training Assets

This folder stores the training datasets, generated model artifacts, and evaluation outputs for the Feedback System and Predictive Analytics component.

## Structure

- `datasets/raw/` - original Kaggle files, not committed.
- `datasets/processed/` - cleaned generated datasets, not committed.
- `models/` - generated model artifacts, not committed.
- `evaluation/` - model comparison and evaluation evidence that can be committed.

## NLP Sentiment Training

From `Backend`:

```powershell
python -m research.nlp_sentiment.train_sentiment_baseline
```

The default paths point to this folder:

- `../training/feedback_analytics/datasets/raw/sentiment140.csv`
- `../training/feedback_analytics/models/sentiment_model.joblib`
- `../training/feedback_analytics/evaluation/sentiment_evaluation.json`
- `../training/feedback_analytics/evaluation/sentiment_model_comparison.csv`

## Predictive Behavioral Analytics Training

From the project root:

```powershell
python -m training.feedback_analytics.prediction.train_predictive_models --regenerate --source kaggle
```

The script merges the Kaggle Employee Performance Evaluation files, transforms them into the platform prediction schema, trains multiple regression and classification models, compares them, and saves the best model. If the raw Kaggle files are unavailable, `--source auto` can fall back to a synthetic prototype dataset.

Expected raw files:

- `training/feedback_analytics/datasets/raw/structured_data.csv`
- `training/feedback_analytics/datasets/raw/behavior_logs.csv`
- `training/feedback_analytics/datasets/raw/audio_features.csv`

Outputs:

- `training/feedback_analytics/datasets/processed/predictive_training_dataset.csv`
- `training/feedback_analytics/models/predictive_behavior_model.joblib`
- `training/feedback_analytics/evaluation/predictive_model_evaluation.json`
- `training/feedback_analytics/evaluation/predictive_model_comparison.csv`
- `training/feedback_analytics/evaluation/predictive_preprocessing_summary.json`

Features:

- `current_score`
- `previous_score`
- `trend_slope`
- `average_feedback_rating`
- `sentiment_score`
- `blind_spot_count`
- `session_count`
- `engagement_score`

Targets:

- `target_next_score` for score regression
- `target_risk_level` for risk classification

Research note:

- Kaggle data is used as the main predictive behavioral analytics training source.
- Synthetic generated data is only a prototype fallback for testing the final platform feature shape.

## LLM Mentoring Recommendations

The LLM mentoring layer converts analytics outputs into personalized mentoring actions. It uses:

- NLP sentiment results from feedback comments.
- Skill score summaries and feedback alignment.
- Blind spot detection results.
- Progress trend analysis.
- ML predictive behavioral analytics outputs.

Runtime feature:

- API endpoint: `GET /api/v1/analytics/users/{user_id}/mentoring-recommendations`
- Backend service: `Backend/app/services/llm_mentoring_service.py`
- Frontend page: `frontend/src/pages/Analytics/AnalyticsRecommendations.jsx`
- LLM model: `gpt-5-mini`

Each recommendation includes:

- `priority` - high, medium, or low
- `skill_area` - affected soft-skill area
- `title` - short mentoring action
- `reason` - why the recommendation was generated
- `detail` - explanation based on analytics evidence
- `next_action` - concrete action for the learner
- `source` - `llm` for real LLM output or `rule_based` for fallback
- `evidence_sources` - analytics signals used

Real LLM verification requires an OpenAI API key in `Backend/.env`:

```env
OPENAI_API_KEY=sk-your-real-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MENTORING_MODEL=gpt-5-mini
LLM_MENTORING_TIMEOUT_S=45.0
```

The API response must show `"source": "llm"` to confirm that the real LLM was used. If it shows `"source": "rule_based"`, the backend fallback is active.

Example request:

```powershell
curl -X GET "http://127.0.0.1:8000/api/v1/analytics/users/real-ml-api-user/mentoring-recommendations?limit=100" `
  -H "accept: application/json"
```

Expected real LLM response markers:

```json
{
  "source": "llm",
  "model_version": "gpt-5-mini",
  "recommendation_version": "llm-mentoring-v1"
}
```

Evaluation rubric:

| Criterion | Score Range | Meaning |
|---|---:|---|
| Relevance | 1-5 | Recommendation matches the learner's analytics evidence. |
| Personalization | 1-5 | Recommendation uses actual scores, trends, risks, or feedback. |
| Actionability | 1-5 | Recommendation gives a clear next action the learner can perform. |
| Evidence grounding | 1-5 | Recommendation is traceable to analytics evidence and does not hallucinate. |
| Safety and appropriateness | 1-5 | Recommendation is non-clinical, respectful, and suitable for workplace soft-skills coaching. |

Observed test case:

- User: `real-ml-api-user`
- Sessions: `2`
- Feedback entries: `1`
- Average feedback rating: `72`
- Blind spots: `0`
- Medium-risk predictions: `1`
- Improving trends: `1`
- LLM output source: `llm`
- Model version: `gpt-5-mini`

Observed frontend recommendations included actions such as monitoring recent confidence gains, increasing feedback sources, using simple decline-tracking metrics, and collecting baseline data for missing skill areas. The output was relevant, personalized, actionable, evidence-grounded, and appropriate for workplace soft-skills coaching.
