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

    # SVM TRAINING AND EVALUATION
    print("Training the Support Vector Machine (Baseline)...")
    X_train, X_test, y_train, y_test = train_test_split(X, y_labels, test_size=0.2, random_state=42, stratify=y_labels)

    # Wrap scaling and SVM inside a pipeline (RBF kernel)
    svm_pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('svm', SVC(kernel='rbf', C=10.0, gamma='scale', probability=True))
    ])

    with mlflow.start_run(run_name="Baseline_SVM_RBF"):
        # Log hyperparameters
        mlflow.log_param("kernel", "rbf")
        mlflow.log_param("C", 10.0)
        mlflow.log_param("dataset", "RAVDESS_Audio_Only")
        mlflow.log_param("features", "MFCC+Chroma+Mel+Pitch(Mean)")
        
        # Train
        svm_pipeline.fit(X_train, y_train)
        
        # Evaluate
        y_pred = svm_pipeline.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        
        # Log metrics
        mlflow.log_metric("accuracy", accuracy)

        # Save the model so we can download it later!
        mlflow.sklearn.log_model(svm_pipeline, "empowerz_affect_fusion_svm")
        
        print("\n--- Classification Report ---")
        print(classification_report(y_test, y_pred))
        print(f"Final Accuracy: {accuracy * 100:.2f}%")
        
        print("\nSuccessfully logged baseline performance to DagsHub!")

# Entry point
@app.local_entrypoint()
def main():
    if not os.path.exists("ravdess_features.npz"):
        print("ERROR: 'ravdess_features.npz' not found! Please run 'python preprocess_svm.py' first.")
        return
        
    print("Submitting SVM Pipeline to Modal.com...")
    train_svm_baseline.remote()