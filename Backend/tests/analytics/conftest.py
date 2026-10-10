import pytest
from fastapi import HTTPException

from app.api.v1.analytics.access import get_analytics_access
from app.main import app


class _UnrestrictedAccess:
    """Lets these tests drive the analytics logic with made-up learner ids.

    Who may call the routes at all is tested in tests/test_analytics_auth.py,
    against the real dependency.
    """

    user_id = "test-user"

    def require_user(self, user_id):
        pass

    def require_session(self, session_id):
        pass

    def require_row(self, row, detail):
        if row is None:
            raise HTTPException(status_code=404, detail=detail)


@pytest.fixture(autouse=True)
def _analytics_access_unrestricted():
    app.dependency_overrides[get_analytics_access] = _UnrestrictedAccess
    yield
    app.dependency_overrides.pop(get_analytics_access, None)
