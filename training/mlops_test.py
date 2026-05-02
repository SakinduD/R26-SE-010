import modal
import os

# Define the cloud environment (install MLflow and Scikit-Learn)
image = modal.Image.debian_slim().pip_install(
    "mlflow", 
    "scikit-learn", 
    "numpy"
)

# Initialize the Modal App
app = modal.App("empowerz-mlops-pipeline")

# Define the cloud function
# We request a GPU (like a T4) and inject our DagsHub secrets!
@app.function(image=image, secrets=[modal.Secret.from_name("dagshub-mlflow")], gpu="T4")
def run_dummy_experiment():
    
    # PUT IMPORTS HERE! 
    # This forces them to run on the cloud GPU, bypassing your laptop's Python errors.
    import mlflow
    import random

    print("Cloud GPU started! Connecting to DagsHub MLflow...")
    
    # MLflow will automatically use the environment variables from Modal Secrets
    mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
    mlflow.set_experiment("EmpowerZ_Model_Tests")
    
    # Start logging a run
    with mlflow.start_run(run_name="Pipeline_Test_Run"):
        # Log dummy parameters (Hyperparameters)
        mlflow.log_param("model_type", "Dummy_Test")
        mlflow.log_param("learning_rate", 0.01)
        
        # Log a dummy metric (Accuracy)
        mock_accuracy = random.uniform(0.7, 0.95)
        mlflow.log_metric("accuracy", mock_accuracy)
        
        print(f"Successfully logged dummy accuracy: {mock_accuracy:.2f} to DagsHub!")

# Entry point to trigger Modal
@app.local_entrypoint()
def main():
    print("Submitting job to Modal.com...")
    run_dummy_experiment.remote()
