import os
import numpy as np
import joblib
from scipy.stats import loguniform
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.model_selection import train_test_split, StratifiedKFold, RandomizedSearchCV
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

DATA_PATH = "combined_features.npz"
OUTPUT_MODEL = "svm_model.pkl"

def main():
    if not os.path.exists(DATA_PATH):
        print(f"ERROR: '{DATA_PATH}' not found. Run preprocess_combined.py first.")
        return

    print("Loading preprocessed feature matrix...")
    data = np.load(DATA_PATH)
    X, y_labels = data['X'], data['y']
    print(f"Loaded: {X.shape[0]} samples, {X.shape[1]} features, {len(set(y_labels))} classes")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_labels, test_size=0.2, random_state=42, stratify=y_labels
    )

    # Random Oversample minority classes to fix imbalance
    # fearful (3%) and surprised (3%) are drastically underrepresented
    from collections import Counter
    class_counts = Counter(y_train)
    target_count = int(np.median(list(class_counts.values())))
    print(f"\nClass distribution BEFORE oversampling:")
    label_names = ['neutral','happy','sad','angry','fearful','disgust','surprised']
    for cls_idx in sorted(class_counts.keys()):
        print(f"  {label_names[cls_idx]:<12}: {class_counts[cls_idx]}")

    X_resampled, y_resampled = [X_train], [y_train]
    rng = np.random.RandomState(42)
    for cls_idx, count in class_counts.items():
        if count < target_count:
            # Find all samples of this class and duplicate randomly
            cls_mask = y_train == cls_idx
            X_cls = X_train[cls_mask]
            n_needed = target_count - count
            idx = rng.choice(len(X_cls), n_needed, replace=True)
            X_resampled.append(X_cls[idx])
            y_resampled.append(np.full(n_needed, cls_idx))

    X_train = np.vstack(X_resampled)
    y_train = np.concatenate(y_resampled)

    # Shuffle the resampled data
    shuffle_idx = rng.permutation(len(X_train))
    X_train = X_train[shuffle_idx]
    y_train = y_train[shuffle_idx]

    class_counts_after = Counter(y_train)
    print(f"\nClass distribution AFTER oversampling:")
    for cls_idx in sorted(class_counts_after.keys()):
        print(f"  {label_names[cls_idx]:<12}: {class_counts_after[cls_idx]}")
    print(f"  Total: {len(y_train)} samples")

    # PHASE 1: Full hyperparameter search on ALL training data
    param_dist = {
        'svm__C': loguniform(0.01, 10),
        'svm__gamma': loguniform(1e-5, 1e-1),
        'svm__kernel': ['rbf', 'linear']
    }

    search_pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('svm', SVC(probability=False, class_weight='balanced'))
    ])

    print(f"\n[PHASE 1/2] Searching on {len(X_train)} samples (n_iter=30, 5-Fold CV)...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    search = RandomizedSearchCV(
        search_pipeline,
        param_distributions=param_dist,
        n_iter=30,
        cv=cv,
        n_jobs=-1,
        verbose=2,
        scoring="f1_macro",
        refit=True,
        random_state=42
    )
    search.fit(X_train, y_train)
    best_params = search.best_params_
    print(f"Best params: {best_params}")
    print(f"Best CV F1 (subsample): {search.best_score_:.4f}")

    # PHASE 2: Final fit on FULL training data with winning params
    print("\n[PHASE 2/2] Final fit on full training data with probability=True...")
    svc_kwargs = {
        'C': best_params['svm__C'],
        'kernel': best_params['svm__kernel'],
        'probability': True,
        'class_weight': 'balanced'
    }
    if best_params['svm__kernel'] != 'linear':
        svc_kwargs['gamma'] = best_params['svm__gamma']

    final_pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('svm', SVC(**svc_kwargs))
    ])
    final_pipeline.fit(X_train, y_train)

    # EVALUATE
    y_pred = final_pipeline.predict(X_test)
    y_pred_train = final_pipeline.predict(X_train)
    accuracy = accuracy_score(y_test, y_pred)
    train_accuracy = accuracy_score(y_train, y_pred_train)

    print("\n--- Classification Report (7-Class Harmonized) ---")
    print(classification_report(y_test, y_pred,
          target_names=['neutral','happy','sad','angry','fearful','disgust','surprised']))
    print(f"Test  Accuracy : {accuracy * 100:.2f}%")
    print(f"Train Accuracy : {train_accuracy * 100:.2f}%")
    print(f"Overfit Gap    : {(train_accuracy - accuracy) * 100:.2f}% (< 5% is healthy)")
    print(f"Best Parameters: {best_params}")

    # SAVE MODEL
    joblib.dump(final_pipeline, OUTPUT_MODEL)
    print(f"\nModel saved to: {OUTPUT_MODEL}")
    print("Copy this file to Backend/app/api/v1/mca/models/svm_model.pkl")

if __name__ == "__main__":
    main()
