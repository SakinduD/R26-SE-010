from fastapi import APIRouter

router = APIRouter()

from app.api.v1.analytics.router import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.mca.router import mca_router

router.include_router(auth_router)
router.include_router(analytics_router, prefix="/analytics")
router.include_router(mca_router, prefix="/mca")
