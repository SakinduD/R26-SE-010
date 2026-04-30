from fastapi import APIRouter

router = APIRouter()

# Import and include endpoint routers here as you create them:
from app.api.v1.mca.router import mca_router
router.include_router(mca_router, prefix="/mca")
