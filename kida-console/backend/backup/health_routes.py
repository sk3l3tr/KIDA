from typing import Annotated

from core.client import CoreClient, get_core_client
from fastapi import APIRouter, Depends, Query

from backup.health_models import (
    DeletedReport,
    Execution,
    HealthCreateRequest,
    HealthQueued,
    History,
    Report,
    Reports,
    RunIdRequest,
    RunRequest,
)

router = APIRouter(prefix="/health")
Client = Annotated[CoreClient, Depends(get_core_client)]


@router.get("", response_model=History, response_model_exclude_unset=True)
async def history(client: Client):
    """Lista historial aplanado, incluida procedencia de restauración y estado del informe. Requiere sesión."""
    return await client.command("backup.health.list", {}, History)


@router.get("/get", response_model=Execution, response_model_exclude_unset=True)
async def get(client: Client, run_id: Annotated[str, Query()]):
    """Consulta una ejecución por run_id. El diagnóstico técnico requiere validación funcional del administrador. Requiere sesión."""
    return await client.command("backup.health.get", {"run_id": run_id}, Execution)


@router.post("/create", response_model=Execution, response_model_exclude_unset=True)
async def create(body: HealthCreateRequest, client: Client):
    """Crea Health con definición del host CORE y modo AUTOMATIC o MANUAL. Console no abre ficheros. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.create",
        body.model_dump(exclude_unset=True),
        Execution,
        action=True,
    )


@router.post("/start", response_model=HealthQueued, response_model_exclude_unset=True)
async def start(body: RunIdRequest, client: Client):
    """Inicia Health. run_id y execution_id son distintos; la admisión no confirma finalización. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.start",
        body.model_dump(exclude_unset=True),
        HealthQueued,
        action=True,
    )


@router.post("/run", response_model=HealthQueued, response_model_exclude_unset=True)
async def run(body: RunRequest, client: Client):
    """Solicita Health automático desde una definición en CORE. run_id y execution_id son distintos. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.run",
        body.model_dump(exclude_unset=True),
        HealthQueued,
        action=True,
    )


@router.post("/stop", response_model=Execution, response_model_exclude_unset=True)
async def stop(body: RunIdRequest, client: Client):
    """Detiene Health conservando las reglas de limpieza de CORE. Revisar cleanup. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.stop",
        body.model_dump(exclude_unset=True),
        Execution,
        action=True,
    )


@router.post("/delete", response_model=Execution, response_model_exclude_unset=True)
async def delete(body: RunIdRequest, client: Client):
    """Elimina Health conservando las reglas de limpieza y procedencia de CORE. Revisar cleanup. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.delete",
        body.model_dump(exclude_unset=True),
        Execution,
        action=True,
    )


@router.get("/reports", response_model=Reports, response_model_exclude_unset=True)
async def reports(client: Client):
    """Lista IDs de informes disponibles; puede devolver []. Requiere sesión."""
    return await client.command("backup.health.report.list", {}, Reports)


@router.get("/reports/get", response_model=Report, response_model_exclude_unset=True)
async def report(client: Client, run_id: Annotated[str, Query()]):
    """Devuelve {run_id,markdown} como JSON, sin renderizar HTML. Requiere sesión."""
    return await client.command("backup.health.report.get", {"run_id": run_id}, Report)


@router.post(
    "/reports/delete", response_model=DeletedReport, response_model_exclude_unset=True
)
async def delete_report(body: RunIdRequest, client: Client):
    """Elimina el informe y devuelve {run_id,deleted}. Requiere sesión, Origin y CSRF. Ante timeout o pérdida de respuesta no se pudo confirmar la ejecución; no reintentar automáticamente."""
    return await client.command(
        "backup.health.report.delete",
        body.model_dump(exclude_unset=True),
        DeletedReport,
        action=True,
    )
