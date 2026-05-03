# EmpowerZ MLOps Pipeline

This directory contains the machine learning pipelines for the EmpowerZ project. Since this repository is public and actively collaborated on, this README outlines the ML architecture and how to run experiments.

## Architecture

We use a centralized MLOps pipeline to ensure all team members can track experiments and models uniformly:
- **Compute:** [Modal.com](https://modal.com/) is used for serverless GPU/CPU cloud training.
- **Tracking:** [DagsHub](https://dagshub.com/) (MLflow) is used to track model parameters, metrics, and artifacts.

## Setup for Collaborators

1. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Modal Authentication:**
   Authenticate your local environment with Modal:
   ```bash
   modal setup
   ```

3. **DagsHub Secrets (Crucial for Tracking):**
   You must have access to the team's DagsHub repository.
   In your [Modal Dashboard](https://modal.com/secrets), create a new Custom Secret named exactly `dagshub-mlflow` containing:
   - `MLFLOW_TRACKING_URI`
   - `MLFLOW_TRACKING_USERNAME`
   - `MLFLOW_TRACKING_PASSWORD`

## Running Experiments

To verify your connection to the team's MLOps tracking server, run:
```bash
modal run mlops_test.py
```
*(Note: `mlops_test.py` is functionally identical to the previously referenced `modal_train.py` pipeline test).*

If successful, you will see test metrics populate in the DagsHub MLflow dashboard.
