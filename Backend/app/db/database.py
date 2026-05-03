import time
from typing import TypedDict

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
    connect_args={"sslmode": "require"},
    echo=settings.debug,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class DBStatus(TypedDict):
    connected: bool
    error: str | None


_db_status_cache: DBStatus = {"connected": False, "error": "not checked yet"}
_db_status_checked_at: float = 0.0
_DB_STATUS_TTL: float = 15.0


def check_database_connection() -> DBStatus:
    """Never raises — cached for 15 s to avoid a SELECT 1 on every /health call."""
    global _db_status_cache, _db_status_checked_at
    if time.monotonic() - _db_status_checked_at < _DB_STATUS_TTL:
        return _db_status_cache
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        _db_status_cache = {"connected": True, "error": None}
    except Exception as exc:
        _db_status_cache = {"connected": False, "error": str(exc)}
    _db_status_checked_at = time.monotonic()
    return _db_status_cache
