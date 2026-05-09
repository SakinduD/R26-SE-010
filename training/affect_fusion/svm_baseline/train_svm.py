import os
import modal

# Define the cloud environment
image = (
    modal.Image.debian_slim()
    .apt_install("git")
    .pip_install("mlflow", "scikit-learn", "numpy")
    .add_local_file("ravdess_features.npz", remote_path="/root/ravdess_features.npz")
)

# Initialize the Modal App
app = modal.App("empowerz-svm-baseline")

# Define the cloud function for training
@app.function(image=image, secrets=[modal.Secret.from_name("dagshub-mlflow")], gpu="T4")
def train_svm_baseline():
    import mlflow
    import numpy as np
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.svm import SVC
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, classification_report

    print("Cloud GPU started! Connecting to DagsHub MLflow...")
    mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
    mlflow.set_experiment("EmpowerZ_Model_1_SVM")

    # LOAD PREPROCESSED DATA
    print("Loading preprocessed feature matrix from image...")
    data = np.load("/root/ravdess_features.npz")
    X = data['X']
    y_labels = data['y']
    print(f"Loaded successfully! Feature Matrix Shape: {X.shape}")

    # --- SVM TRAINING AND EVALUATION ---
    X_train, X_test, y_train, y_test = train_test_split(X, y_labels, test_size=0.2, random_state=42, stratify=y_labels)

    # --- MCA-13: GRID SEARCH FOR OPTIMIZATION ---
    from sklearn.model_selection import GridSearchCV
    
    # Define the parameter grid to search
    param_grid = {
        'svm__C': [0.1, 1, 10, 100],
        'svm__gamma': ['scale', 'auto', 0.001, 0.01],
        'svm__kernel': ['rbf', 'poly']
    }

    # Initialize the base pipeline
    base_pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('svm', SVC(probability=True))
    ])

    print("Starting Grid Search... Trying 40 combinations to find the best model.")
    grid_search = GridSearchCV(base_pipeline, param_grid, cv=5, n_jobs=-1, verbose=1)

    with mlflow.start_run(run_name="Optimized_GridSearch_SVM"):
        # Train with Grid Search
        grid_search.fit(X_train, y_train)
        
        # Get the best model
        best_model = grid_search.best_estimator_
        
        # Log the winning hyperparameters
        mlflow.log_params(grid_search.best_params_)
        mlflow.log_param("dataset", "RAVDESS_Audio_Only")
        mlflow.log_param("optimization", "GridSearchCV_5Fold")

        # Evaluate the best model
        y_pred = best_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        
        # Log metrics
        mlflow.log_metric("accuracy", accuracy)

        # Save the WINNING model
        mlflow.sklearn.log_model(best_model, "empowerz_affect_fusion_svm")
        
        print("\n--- Classification Report ---")
        print(classification_report(y_test, y_pred))
        print(f"Accuracy: {accuracy * 100:.2f}%")
        print(f"Best Parameters: {grid_search.best_params_}")
        
        print("\nSuccessfully logged optimized model to DagsHub!")

# Entry point
@app.local_entrypoint()
def main():
    if not os.path.exists("ravdess_features.npz"):
        print("ERROR: 'ravdess_features.npz' not found! Please run 'python preprocess_svm.py' first.")
        return
        
    print("Submitting SVM Pipeline to Modal.com...")
    train_svm_baseline.remote()