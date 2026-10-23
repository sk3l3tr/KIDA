import unicodedata
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, RootModel

from core.models import CoreData


def identifier(value: str) -> str:
    if any(unicodedata.category(char) in {"Cc", "Cs"} for char in value):
        raise ValueError(
            "Identifiers must not contain control characters or Unicode surrogates"
        )
    value = value.strip()
    if not value:
        raise ValueError("Identifiers must not be empty")
    return value


def container_identifier(value: str) -> str:
    if value.startswith("-"):
        raise ValueError("Container identifiers must not start with '-'")
    return value


Identifier = Annotated[str, AfterValidator(identifier)]
ContainerIdentifier = Annotated[Identifier, AfterValidator(container_identifier)]


class ContainerRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    container: ContainerIdentifier


class DockerPort(CoreData):
    container_port: Annotated[int, Field(ge=0, le=2**16 - 1)] | None
    protocol: str
    host_ip: str | None
    host_port: str | None


class DockerNetwork(CoreData):
    name: str
    ip_address: str | None
    gateway: str | None
    mac_address: str | None


class DockerContainer(CoreData):
    id: str
    name: str
    image: str
    online: bool
    status: str
    health: str | None
    started_at: str | None
    finished_at: str | None
    exit_code: Annotated[int, Field(ge=-(2**63), le=2**63 - 1)] | None
    restart_count: Annotated[int, Field(ge=0, le=2**64 - 1)]
    restart_policy: str | None
    ports: list[DockerPort]
    networks: list[DockerNetwork]


class DockerContainers(CoreData):
    total: Annotated[int, Field(ge=0)]
    running: Annotated[int, Field(ge=0)]
    containers: list[DockerContainer]


class ComposeVersion(CoreData):
    version: str


class ComposeService(CoreData):
    name: str | None
    containers: list[DockerContainer]


class ComposeProject(CoreData):
    name: str
    services: list[ComposeService]


class ComposeProjects(RootModel[list[ComposeProject]]):
    model_config = ConfigDict(strict=True)


class ContainerResult(CoreData):
    container: str
    status: str
