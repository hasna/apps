from fastapi import APIRouter

from . import downloads, drives, files, meta, permissions, watch, webhooks

router = APIRouter()
router.include_router(drives.router, prefix="/drives", tags=["drives"])
router.include_router(downloads.router, prefix="/downloads", tags=["downloads"])
router.include_router(files.router, prefix="/files", tags=["files"])
router.include_router(permissions.router, prefix="/permissions", tags=["permissions"])
router.include_router(watch.router, prefix="/watch", tags=["watch"])
router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
router.include_router(meta.router, prefix="/_meta", tags=["meta"])

__all__ = ["router"]
