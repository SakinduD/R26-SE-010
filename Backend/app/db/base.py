from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import models so Alembic and test fixtures can discover them through Base.metadata.
from app.models import analytics  # noqa: E402,F401
from app.models import session_result  # noqa: E402,F401
from app.models import personality_profile  # noqa: E402,F401
from app.models import training_plan  # noqa: E402,F401
from app.models import user  # noqa: E402,F401
