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
