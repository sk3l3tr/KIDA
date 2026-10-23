import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.models import CoreData

Clock = Annotated[str, Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
Seconds = Annotated[int, Field(ge=120, le=2**64 - 1)]


class Input(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class PowerRequest(Input):
    when: str

    @model_validator(mode="after")
    def valid_when(self):
        if not re.fullmatch(
            r"now|\+[0-9]+|(?:[01]?[0-9]|2[0-3]):[0-5]?[0-9]", self.when
        ):
            raise ValueError("when must be now, +N or a valid 24-hour time")
        return self


class PowerCycleRequest(Input):
    wake_time: Clock | None = None
    wake_after_seconds: Seconds | None = None
    shutdown_time: Clock | None = None

    @model_validator(mode="after")
    def valid_selection(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Explicit null values are not allowed")
        if (self.wake_time is None) == (self.wake_after_seconds is None):
            raise ValueError("Specify exactly one of wake_time or wake_after_seconds")
        return self


class OsInfo(CoreData):
    name: str | None
    version: str | None
    long_version: str | None


class KernelInfo(CoreData):
    version: str | None
    long_version: str | None


class HardwareInfo(CoreData):
    model: str | None
    vendor: str | None


class CpuInfo(CoreData):
    brand: str | None
    vendor: str | None
    logical_cores: int
    physical_cores: int | None


class MemoryInfo(CoreData):
    total_bytes: int
    available_bytes: int
    used_bytes: int


class DiskInfo(CoreData):
    name: str
    mount_point: str
    file_system: str
    total_bytes: int
    available_bytes: int
    removable: bool


class SystemInfo(CoreData):
    hostname: str | None
    os: OsInfo
    kernel: KernelInfo
    architecture: str
    hardware: HardwareInfo
    cpu: CpuInfo
    memory: MemoryInfo
    graphics: list[str]
    disks: list[DiskInfo]


class Sensor(CoreData):
    type: str
    device: str
    label: str
    value: int | float
    unit: str
    alarm: bool
    status: str
    max: int | float | None = None
    critical: int | float | None = None
    fault: bool | None = None


class SystemHealth(CoreData):
    overall: str
    sensors: list[Sensor]


class WakeCapabilities(CoreData):
    rtc_device: str | None
    rtcwake_available: bool | None
    rtc_alarm_available: bool | None
    s5_wake_status: str
    warnings: list[str]


class ShutdownResult(CoreData):
    scheduled: bool
    when: str


class RebootResult(ShutdownResult):
    pass


class PowerCycleResult(CoreData):
    shutdown_at: str | None = None
    wake_at: str
    shutdown_scheduled: bool
    s5_wake_status: str
