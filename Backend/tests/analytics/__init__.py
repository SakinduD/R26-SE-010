"""Tests for the Feedback System & Predictive Analytics component.

`repo_root()` is here because two tests reach outside Backend/ for the training
datasets and model artifacts, which live in the repo-root `training/` package.
They used to find it by counting parent directories, which was correct while they
sat one level higher and silently wrong the moment they were moved into this
package - one test skipped itself and two passed without asserting anything.

Searching upward for a known directory survives being moved again.
"""
from pathlib import Path


def repo_root() -> Path:
    """The directory holding `training/`, found by walking up from here."""
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "training" / "feedback_analytics").is_dir():
            return candidate
    raise RuntimeError(
        "Could not locate the repo root: no parent of this file contains "
        "training/feedback_analytics."
    )
