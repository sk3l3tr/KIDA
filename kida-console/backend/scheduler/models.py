from typing import Annotated, Literal

from core.models import CoreData, Input
from pydantic import (
    ConfigDict,
    Field,
    JsonValue,
    RootModel,
)

Seconds = Annotated[int, Field(ge=0, le=2**64 - 1)]


class OnceRequest(Input):
    type: Literal["once"]
    at: str


class IntervalRequest(Input):
    type: Literal["interval"]
    seconds: Seconds


class CronRequest(Input):
    type: Literal["cron"]
    expression: str
    timezone: str = "UTC"


class AddRequest(Input):
    command: str
    params: JsonValue
    schedule: Annotated[
        OnceRequest | IntervalRequest | CronRequest, Field(discriminator="type")
    ]


class DeleteRequest(Input):
    id: str


OriginFilter = Literal["USER", "INTERNAL", "ALL"]


class OnceRule(CoreData):
    type: Literal["once"]
    at: str


class IntervalRule(CoreData):
    type: Literal["interval"]
    seconds: Seconds


class CronRule(CoreData):
    type: Literal["cron"]
    expression: str
    timezone: str


class Schedule(CoreData):
    id: str
    origin: str
    command: str
    params: JsonValue
    schedule: Annotated[OnceRule | IntervalRule | CronRule, Field(discriminator="type")]


class ListedSchedule(Schedule):
    next_enqueue_at: str


class Schedules(RootModel[list[ListedSchedule]]):
    model_config = ConfigDict(strict=True)
