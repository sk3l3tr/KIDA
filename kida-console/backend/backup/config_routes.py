from typing import Annotated

from core.client import CoreClient, get_core_client
from fastapi import APIRouter, Depends

from backup.config_models import BackupJob, Backups, CreateRequest, Queued, Selector

router = APIRouter()
Client = Annotated[CoreClient, Depends(get_core_client)]


@router.get("/config", response_model=Backups, response_model_exclude_unset=True)
async def configs(client: Client):
    """Lista configuraciones como {backups:[]}. Schedule y retention son metadatos. Requiere sesión."""
    return await client.command("backup.config.list", {}, Backups)


@router.post(
    "/config/create", response_model=BackupJob, response_model_exclude_unset=True
)
async def create(body: CreateRequest, client: Client):
    """Crea una configuración. Los campos omitidos conservan los predeterminados de CORE. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.config.create",
        body.model_dump(exclude_unset=True),
        BackupJob,
        action=True,
    )


@router.post(
    "/config/delete", response_model=BackupJob, response_model_exclude_unset=True
)
async def delete(body: Selector, client: Client):
    """Elimina una configuración por id o name; no borra sus archivos de backup. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.config.delete",
        body.model_dump(exclude_unset=True),
        BackupJob,
        action=True,
    )


@router.post("/run", response_model=Queued, response_model_exclude_unset=True)
async def run(body: Selector, client: Client):
    """Solicita backup.run. QUEUED confirma admisión, no finalización. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.run", body.model_dump(exclude_unset=True), Queued, action=True
    )
