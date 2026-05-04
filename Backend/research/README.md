# Feedback System & Predictive Analytics Research Pipeline

This folder contains the research artifacts for the Feedback System and Predictive Analytics component.

## Phase 1: NLP Sentiment Analysis Baseline

Goal: train and evaluate an NLP model that classifies self/peer feedback comments as negative, neutral, or positive.

Dataset:

- Kaggle Sentiment140 Dataset
- Expected raw file path: `Backend/research/datasets/raw/sentiment140.csv`
- Sentiment140 normally has no header and uses columns:
  `target,id,date,flag,user,text`

Label mapping:

- `0` -> negative
- `2` -> neutral
- `4` -> positive

Preprocessing:

- Converts text to lowercase.
- Converts HTML entities safely.
- Replaces URLs with `url`.
- Replaces user mentions with `user`.
- Removes unsupported symbols while keeping useful punctuation.
- Normalizes extra whitespace.
- Removes empty rows.
- Removes very short rows.
- Removes duplicate cleaned text rows.
- Records preprocessing counts in `sentiment_evaluation.json`.

Model:

- TF-IDF vectorizer
- Logistic Regression classifier

Why this model is suitable:

- It is simple and explainable for an undergraduate research baseline.
- It gives measurable NLP evaluation results.
- It can later be replaced by a transformer model if more accuracy is required.

## How To Run Phase 1

From the backend folder:

```powershell
cd Backend
python -m research.nlp_sentiment.train_sentiment_baseline `
  --dataset research/datasets/raw/sentiment140.csv `
  --output-model research/models/sentiment_model.joblib `
  --output-evaluation research/evaluation/sentiment_evaluation.json
```

For a faster first check, train with a balanced per-class row limit. This is important because Sentiment140 is commonly sorted with negative examples first and positive examples later:

```powershell
python -m research.nlp_sentiment.train_sentiment_baseline `
  --dataset research/datasets/raw/sentiment140.csv `
  --limit-per-class 25000
```

Outputs:

- `Backend/research/models/sentiment_model.joblib`
- `Backend/research/evaluation/sentiment_evaluation.json`

Optional: save the cleaned dataset used for training:

```powershell
python -m research.nlp_sentiment.train_sentiment_baseline `
  --dataset research/datasets/raw/sentiment140.csv `
  --output-processed research/datasets/processed/sentiment140_cleaned.csv
```

## Research Explanation

Sentiment140 is used to train a sentiment classifier for short informal text. The trained NLP model is then adapted to analyze self-assessment and peer feedback comments in the workplace soft-skills platform. The sentiment output becomes one signal for feedback analytics, skill scoring, blind spot detection, and mentoring recommendations.

## Evaluation Metrics

The baseline reports:

- Accuracy
- Weighted precision
- Weighted recall
- Weighted F1-score
- Per-class precision, recall, and F1-score

Use these values in the final report under NLP model evaluation.
