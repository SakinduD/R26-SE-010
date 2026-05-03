import os
import modal

# Define the cloud environment
image = (
    modal.Image.debian_slim()
    .apt_install("git")
    .pip_install("mlflow", "scikit-learn", "numpy")
    .add_local_file("combined_features.npz", remote_path="/root/combined_features.npz")
)

# Initialize the Modal App
app = modal.App("empowerz-svm-baseline")

# Define the cloud function for training
@app.function(image=image, secrets=[modal.Secret.from_name("dagshub-mlflow")])
def train_svm_baseline():
    import mlflow
    import numpy as np
    import json
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import SVC
    from sklearn.model_selection import train_test_split, StratifiedKFold
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

    print("Cloud GPU started! Connecting to DagsHub MLflow...")
    mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
    mlflow.set_experiment("EmpowerZ_Model_1_SVM")

    # LOAD PREPROCESSED DATA
    print("Loading preprocessed harmonized feature matrix from image...")
    data = np.load("/root/combined_features.npz")
    X = data['X']
    y_labels = data['y']
    print(f"Loaded successfully! Feature Matrix Shape: {X.shape}")

    # Log class distribution for observability
    class_counts = np.bincount(y_labels, minlength=7)
    class_distribution = {f"class_{idx}": int(count) for idx, count in enumerate(class_counts)}

    # --- SVM TRAINING AND EVALUATION ---
    X_train, X_test, y_train, y_test = train_test_split(X, y_labels, test_size=0.2, random_state=42, stratify=y_labels)

    # --- GRID SEARCH FOR OPTIMIZATION ---
    from sklearn.model_selection import GridSearchCV
    
    # Define the parameter grid to search
    param_grid = {
        'svm__C': [0.1, 1, 10, 100, 1000],
        'svm__gamma': ['scale', 'auto', 0.0001, 0.001, 0.01],
        'svm__kernel': ['rbf', 'poly', 'linear']
    }

    # Initialize the base pipeline
    base_pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('svm', SVC(probability=True, class_weight='balanced'))
    ])

    print("Starting Grid Search... Optimizing for Harmonized 7-Class Schema.")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    grid_search = GridSearchCV(
        base_pipeline,
        param_grid,
        cv=cv,
        n_jobs=-1,
        verbose=1,
        scoring="f1_macro",
        refit="f1_macro"
    )

    with mlflow.start_run(run_name="Harmonized_RAVDESS_SUBESCO_SVM"):
        # Train with Grid Search
        grid_search.fit(X_train, y_train)
        
        # Get the best model
        best_model = grid_search.best_estimator_
        
        # Log the winning hyperparameters
        mlflow.log_params(grid_search.best_params_)
        mlflow.log_param("dataset", "Combined_RAVDESS_SUBESCO")
        mlflow.log_param("classes", 7)
        mlflow.log_param("optimization", "GridSearchCV_5Fold")

        # Log class distribution artifacts
        dist_path = "/tmp/class_distribution.json"
        with open(dist_path, "w", encoding="utf-8") as handle:
            json.dump(class_distribution, handle, indent=2)
        mlflow.log_artifact(dist_path)

        # Evaluate the best model
        y_pred = best_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        
        # Log metrics
        mlflow.log_metric("accuracy", accuracy)

        # Log per-class metrics for observability
        report = classification_report(y_test, y_pred, output_dict=True)
        for label, scores in report.items():
            if isinstance(scores, dict):
                mlflow.log_metric(f"f1_{label}", scores['f1-score'])
        if "macro avg" in report:
            mlflow.log_metric("f1_macro", report["macro avg"]["f1-score"])

        # Log confusion matrix as CSV artifact
        cm = confusion_matrix(y_test, y_pred, labels=list(range(7)))
        cm_path = "/tmp/confusion_matrix.csv"
        np.savetxt(cm_path, cm, delimiter=",", fmt="%d")
        mlflow.log_artifact(cm_path)

        # Save the WINNING model
        mlflow.sklearn.log_model(best_model, "empowerz_affect_fusion_svm_harmonized")
        
        print("\n--- Classification Report (7-Class Harmonized) ---")
        print(classification_report(y_test, y_pred))
        print(f"Accuracy: {accuracy * 100:.2f}%")
        print(f"Best Parameters: {grid_search.best_params_}")
        
        print("\nSuccessfully logged harmonized model to DagsHub!")

# Entry point
@app.local_entrypoint()
def main():
    if not os.path.exists("combined_features.npz"):
        print("ERROR: 'combined_features.npz' not found! Please run 'python preprocess_combined.py' first.")
        return
        
    print("Submitting SVM Pipeline to Modal.com...")
    train_svm_baseline.remote()