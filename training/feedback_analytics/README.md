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
