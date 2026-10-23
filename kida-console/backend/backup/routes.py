from fastapi import APIRouter

from backup.config_routes import router as config_router
from backup.health_routes import router as health_router

router = APIRouter(prefix="/api/backup", tags=["BACKUP"])
router.include_router(config_router)
router.include_router(health_router)
