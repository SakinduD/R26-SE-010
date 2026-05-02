from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import models so Alembic can discover them through Base.metadata.
from app.models import analytics  # noqa: E402,F401
