from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.client import CoreClient, get_core_client
from docker.models import (
    ComposeProject,
    ComposeProjects,
    ComposeVersion,
    ContainerRequest,
    ContainerResult,
    DockerContainers,
    Identifier,
)

router = APIRouter(prefix="/api/docker", tags=["DOCKER"])
Client = Annotated[CoreClient, Depends(get_core_client)]


@router.get(
    "/containers", response_model=DockerContainers, response_model_exclude_unset=True
)
async def containers(client: Client):
    return await client.command("docker.containers.list", {}, DockerContainers)


@router.get(
    "/compose/version", response_model=ComposeVersion, response_model_exclude_unset=True
)
async def compose_version(client: Client):
    return await client.command("docker.compose.version", {}, ComposeVersion)


@router.get(
    "/compose/projects",
    response_model=ComposeProjects,
    response_model_exclude_unset=True,
)
async def compose_projects(client: Client):
    return await client.command("docker.compose.projects.list", {}, ComposeProjects)


@router.get(
    "/compose/projects/inspect",
    response_model=ComposeProject,
    response_model_exclude_unset=True,
)
async def compose_project(client: Client, project: Annotated[Identifier, Query()]):
    return await client.command(
        "docker.compose.project.inspect", {"project": project}, ComposeProject
    )


@router.post(
    "/containers/start",
    response_model=ContainerResult,
    response_model_exclude_unset=True,
)
async def start(body: ContainerRequest, client: Client):
    return await client.command(
        "docker.container.start", body.model_dump(), ContainerResult, action=True
    )


@router.post(
    "/containers/stop",
    response_model=ContainerResult,
    response_model_exclude_unset=True,
)
async def stop(body: ContainerRequest, client: Client):
    return await client.command(
        "docker.container.stop", body.model_dump(), ContainerResult, action=True
    )


@router.post(
    "/containers/restart",
    response_model=ContainerResult,
    response_model_exclude_unset=True,
)
async def restart(body: ContainerRequest, client: Client):
    return await client.command(
        "docker.container.restart", body.model_dump(), ContainerResult, action=True
    )


@router.post(
    "/containers/delete",
    response_model=ContainerResult,
    response_model_exclude_unset=True,
)
async def delete(body: ContainerRequest, client: Client):
    return await client.command(
        "docker.container.delete", body.model_dump(), ContainerResult, action=True
    )
