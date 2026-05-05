import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON as GenericJSON
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_db
from app.db.base import Base
from app.main import app
from app.models.training_plan import AdjustmentHistory, TrainingPlan

TEST_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    # SQLite doesn't support JSONB. Override at test-runtime only.
    # TODO(post-may-11): replace with testcontainers Postgres for type fidelity.
    for col_name in ("strategy_json", "recommended_scenario_ids", "primary_scenario_json"):
        TrainingPlan.__table__.c[col_name].type = GenericJSON()
    for col_name in ("previous_strategy", "new_strategy", "signals_summary"):
        AdjustmentHistory.__table__.c[col_name].type = GenericJSON()

    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
