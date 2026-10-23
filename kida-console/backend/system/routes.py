from typing import Annotated

from fastapi import APIRouter, Depends

from core.client import CoreClient, get_core_client
from system.models import (
    PowerCycleRequest,
    PowerCycleResult,
    PowerRequest,
    RebootResult,
    ShutdownResult,
    SystemHealth,
    SystemInfo,
    WakeCapabilities,
)

router = APIRouter(prefix="/api/system", tags=["SYSTEM"])
Client = Annotated[CoreClient, Depends(get_core_client)]


@router.get("/info", response_model=SystemInfo, response_model_exclude_unset=True)
async def info(client: Client):
    return await client.command("system.info", {}, SystemInfo)


@router.get("/health", response_model=SystemHealth, response_model_exclude_unset=True)
async def health(client: Client):
    return await client.command("system.health", {}, SystemHealth)


@router.get(
    "/wake-capabilities",
    response_model=WakeCapabilities,
    response_model_exclude_unset=True,
)
async def wake_capabilities(client: Client):
    return await client.command("system.wake_capabilities", {}, WakeCapabilities)


@router.post(
    "/shutdown", response_model=ShutdownResult, response_model_exclude_unset=True
)
async def shutdown(body: PowerRequest, client: Client):
    return await client.command(
        "system.shutdown", body.model_dump(), ShutdownResult, action=True
    )


@router.post("/reboot", response_model=RebootResult, response_model_exclude_unset=True)
async def reboot(body: PowerRequest, client: Client):
    return await client.command(
        "system.reboot", body.model_dump(), RebootResult, action=True
    )


@router.post(
    "/power-cycle", response_model=PowerCycleResult, response_model_exclude_unset=True
)
async def power_cycle(body: PowerCycleRequest, client: Client):
    return await client.command(
        "system.power_cycle",
        body.model_dump(exclude_unset=True),
        PowerCycleResult,
        action=True,
    )
