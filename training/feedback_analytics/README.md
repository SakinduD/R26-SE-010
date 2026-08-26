# Feedback Analytics Training Assets

This folder stores the training datasets, generated model artifacts, and evaluation outputs for the Feedback System and Predictive Analytics component.

## Structure

- `datasets/raw/` - original Kaggle files, not committed.
- `datasets/processed/` - cleaned generated datasets, not committed.
- `models/` - generated model artifacts, not committed.
- `evaluation/` - model comparison and evaluation evidence that can be committed.

## NLP Sentiment Training

From the project root:

```powershell
python -m training.feedback_analytics.sentiment.train_sentiment_baseline
```

The default paths point to this folder:

- `training/feedback_analytics/datasets/raw/sentiment140.csv`
- `training/feedback_analytics/models/sentiment_model.joblib`
- `training/feedback_analytics/evaluation/sentiment_evaluation.json`
- `training/feedback_analytics/evaluation/sentiment_model_comparison.csv`

Text cleaning is imported from `Backend/research/nlp_sentiment/sentiment_baseline.py`
rather than duplicated, so training and serving always prepare text the same way.

## Workplace Sentiment Validation

Every sentiment model here is trained on somebody else's corpus - 2009 tweets,
or Glassdoor reviews - and then asked about workplace self-reflections. A test
accuracy is evidence about the corpus it was measured on and about nothing else,
so a separate hand-labelled set measures each of them on the actual domain. That
set is the only reason it is known which model to serve; the corpus-test numbers
rank them in the wrong order.

Build or refresh the labelling sheet:

```powershell
python -m training.feedback_analytics.sentiment.build_validation_set
```

It collects every real learner reflection from `feedback_entries` and adds
authored sentences covering phrasings the small real set does not contain. Labels
are left empty on purpose. Re-running preserves existing labels and appends only
new sentences.

Label them through the text worksheet rather than by editing the CSV, which has
quoted fields containing commas:

```powershell
python -m training.feedback_analytics.sentiment.label_worksheet           # export
# fill each [__] with p / n / m / x, save, then:
python -m training.feedback_analytics.sentiment.label_worksheet --apply   # read back
```

A letter that is not one of the four stops the whole apply and names the line;
nothing partial is written.

Then measure the current model against it:

```powershell
python -m training.feedback_analytics.sentiment.evaluate_workplace
```

Results are written to `evaluation/sentiment_workplace_evaluation.json`, split by
`learner` and `authored` source, and include how many predictions clear the 0.60
confidence gate that blind-spot detection requires. Run this before and after any
model change against the same labelled file - that pair of numbers is the only
evidence that a change was an improvement.

### What the first measurement found

`evaluation/sentiment_workplace_evaluation_s140.json` records the run. Headline:

| | Sentiment140 test set | workplace validation set |
|---|---|---|
| accuracy | 78.01% | 73.08% |

Accuracy is the least interesting number in it. Two others decided everything
that came after:

- **The model is reliable in one direction only.** It reads "positive" at
  precision 0.90 and "negative" at 0.63. Raising the confidence gate does not
  help - the wrong negative readings are among the most confident
  (`"My voice was steady and I did not rush a single answer"` is read as negative
  at 0.86). Sentiment140 is emoticon-labelled tweets, where negative sentiment
  travels with complaint vocabulary; workplace reflections use "not",
  "difficult", "mistake" descriptively.

- **Mixed reflections are dumped into negative.** Of 17 rows labelled mixed or
  neutral, 15 were read as negative. The model has two classes and cannot
  abstain, and the real learner reflections collected so far are mostly mixed.

### What was done about it

Both findings are about the training data, not the classifier, so the answer was
a different corpus. Glassdoor reviews are workplace language and carry a usable
third class (`pros` / `cons` / 3-star headlines with a contrast marker). Two
models were built on it and scored by the same instrument as everything else:

| model | trained on | workplace accuracy | mixed F1 | above the 0.60 gate |
|---|---|---:|---:|---:|
| **DistilBERT fine-tuned** | Glassdoor 3-class | **0.842** | **0.81** | **97%** |
| TF-IDF + Logistic Regression | Sentiment140 | 0.731 | no class | 77% |
| TF-IDF + Linear SVM | Glassdoor 3-class | 0.684 | 0.85 | 79% |
| RoBERTa, not fine-tuned | published weights | 0.684 | 0.40 | 63% |

The split in that table is the whole argument. The bag-of-words models get
`mixed` from the data and still misread negation, because TF-IDF counts words
independently and has no mechanism for one to change the meaning of the next.
The pretrained transformer reads context and has no `mixed` class. Fine-tuning a
transformer on the three-class data is the one move that produces both, and it
does: 0.842, and the sentence that defeated every other model is read correctly.

**`sentiment_analysis_service.MODEL_CANDIDATES` therefore serves
`models/sentiment_distilbert` and falls back to `models/sentiment_model.joblib`.**
The fallback is not a lesser configuration to apologise for - it is what keeps
every other analytics endpoint working on a machine without torch. The served
version travels with every result, so the module can never quietly serve the
weaker model while reporting the stronger one.

Because a model that reads `mixed` is now serving,
`blind_spot_service.TRUSTED_DETECTED_SENTIMENTS` is
`{"positive", "mixed"}` - not `{"positive"}`, which is what the Sentiment140
measurement justified. `negative` stays closed: measured at the same gate it
flags 16 and gets 11 right, and when it is wrong it tells a learner their own
account betrays a difficulty they never described. The reasoning is written out
in full beside the constant. `Backend/tests/test_sentiment_gap_direction.py`
pins it. Widening it requires re-measuring a replacement model on this same
validation set.

Swapping the model changes what new entries say and leaves older ones frozen on
the previous model's answer, so `sentiment_reread_service` re-reads stored
comments with the current model. It touches only entries a model actually
judged; rule-derived labels on system-generated feedback are their producer's,
not a model's.

All 43 validation rows now carry `labelled_by = human`. The evaluation prints
that share on every run and warns while it is below 1.0.

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
