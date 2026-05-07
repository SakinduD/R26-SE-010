from fastapi import APIRouter

router = APIRouter()

from app.api.v1.analytics.router import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.mca.router import mca_router
from app.api.v1.pedagogy import router as pedagogy_router
from app.api.v1.survey import router as survey_router
from app.api.v1.rpe.router import rpe_router

router.include_router(auth_router)
router.include_router(analytics_router, prefix="/analytics")
router.include_router(mca_router, prefix="/mca")
router.include_router(survey_router, prefix="/survey")
router.include_router(rpe_router, prefix="/rpe", tags=["Role-Play Engine"])
router.include_router(pedagogy_router, prefix="/apa")
