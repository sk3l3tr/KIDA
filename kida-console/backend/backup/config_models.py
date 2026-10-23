from typing import Annotated, Literal

from core.models import CoreData, Input
from pydantic import ConfigDict, Field, JsonValue, model_validator

UInt32 = Annotated[int, Field(ge=0, le=2**32 - 1)]
UInt64 = Annotated[int, Field(ge=0, le=2**64 - 1)]


class TargetRequest(Input):
    path: str
    required: bool = True
    filesystem_uuid: str | None = None


class LifecycleCommandRequest(Input):
    command: str
    params: JsonValue = None


class LifecycleRequest(Input):
    pre_backup: list[LifecycleCommandRequest] = Field(default_factory=list)
    post_backup: list[LifecycleCommandRequest] = Field(default_factory=list)


class RetentionRequest(Input):
    max_age: str | None = None
    keep_last: UInt32 | None = None
    protected_restore_points: list[str] = Field(default_factory=list)


class CreateRequest(Input):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "name": "daily",
                    "sources": ["/srv/data"],
                    "targets": [{"path": "/mnt/backups"}],
                }
            ]
        }
    )

    name: str
    sources: list[str]
    targets: list[TargetRequest]
    compression: Literal["tar_zstd"] = "tar_zstd"
    lifecycle: LifecycleRequest = Field(default_factory=LifecycleRequest)
    schedule: JsonValue = None
    retention: RetentionRequest | None = None


class Selector(Input):
    model_config = ConfigDict(
        json_schema_extra={
            "oneOf": [
                {
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}},
                    "not": {"required": ["name"]},
                },
                {
                    "required": ["name"],
                    "properties": {"name": {"type": "string"}},
                    "not": {"required": ["id"]},
                },
            ]
        }
    )

    id: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def exactly_one(self):
        if len(self.model_fields_set) != 1 or (self.id is None and self.name is None):
            raise ValueError("Provide exactly one string id or name")
        return self


class BackupTarget(CoreData):
    path: str
    required: bool
    filesystem_uuid: str | None = None


class LifecycleCommand(CoreData):
    command: str
    params: JsonValue


class Lifecycle(CoreData):
    pre_backup: list[LifecycleCommand]
    post_backup: list[LifecycleCommand]


class Retention(CoreData):
    max_age: str | None = None
    keep_last: UInt32 | None = None
    protected_restore_points: list[str]


class BackupJob(CoreData):
    id: str
    name: str
    sources: list[str]
    targets: list[BackupTarget]
    compression: str
    lifecycle: Lifecycle
    schedule: JsonValue = None
    retention: Retention | None = None


class Backups(CoreData):
    backups: list[BackupJob]


class Queued(CoreData):
    state: str
    execution_id: str
