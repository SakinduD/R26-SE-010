from fastapi import APIRouter

router = APIRouter()

# Import and include endpoint routers
from app.api.v1.analytics.router import router as analytics_router
from app.api.v1.mca.router import mca_router
from app.api.v1.rpe.router import rpe_router

router.include_router(analytics_router, prefix="/analytics")
router.include_router(mca_router, prefix="/mca")
router.include_router(rpe_router, prefix="/rpe", tags=["Role-Play Engine"])
