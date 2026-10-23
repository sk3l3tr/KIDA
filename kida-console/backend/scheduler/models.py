import math
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    RootModel,
    model_validator,
)

from core.models import CoreData


def validate_json(value):
    # Validate before field parsing so invalid keys cannot enter error locations.
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                raise ValueError("Isolated Unicode surrogates are not allowed")
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError("Non-finite JSON numbers are not allowed")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


class Input(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def valid_json(cls, value):
        return validate_json(value)


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
