from fastapi import APIRouter

router = APIRouter()

# Import and include endpoint routers
from app.api.v1.mca.router import mca_router
router.include_router(mca_router, prefix="/mca")
