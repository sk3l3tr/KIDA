from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.client import CoreClient, get_core_client
from scheduler.models import (
    AddRequest,
    DeleteRequest,
    OriginFilter,
    Schedule,
    Schedules,
)

router = APIRouter(prefix="/api/scheduler", tags=["SCHEDULER"])
Client = Annotated[CoreClient, Depends(get_core_client)]


@router.get("", response_model=Schedules, response_model_exclude_unset=True)
async def schedules(
    client: Client, origin: Annotated[OriginFilter | None, Query()] = None
):
    params = {} if origin is None else {"origin": origin}
    return await client.command("scheduler.list", params, Schedules)


@router.post("/add", response_model=Schedule, response_model_exclude_unset=True)
async def add(body: AddRequest, client: Client):
    return await client.command(
        "scheduler.add", body.model_dump(exclude_unset=True), Schedule, action=True
    )


@router.post("/delete", response_model=Schedule, response_model_exclude_unset=True)
async def delete(body: DeleteRequest, client: Client):
    return await client.command(
        "scheduler.delete", body.model_dump(), Schedule, action=True
    )
