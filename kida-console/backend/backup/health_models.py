from typing import Literal

from core.models import CoreData, Input
from pydantic import ConfigDict, RootModel

from backup.config_models import Queued, UInt32, UInt64


class RunIdRequest(Input):
    run_id: str


class RunRequest(Input):
    definition_path: str


class HealthCreateRequest(RunRequest):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"definition_path": "/srv/health/app.toml", "mode": "MANUAL"}]
        }
    )

    mode: Literal["AUTOMATIC", "MANUAL"]


class HealthQueued(Queued):
    run_id: str


class BackupReference(CoreData):
    reference: str
    version: str


class HealthDocker(CoreData):
    compose: str


class Definition(CoreData):
    id: str
    name: str
    backup: BackupReference
    docker: HealthDocker


class Artifact(CoreData):
    artifact_id: str
    job_id: str
    artifact_name: str
    created_at: str
    path: str
    checksum: str
    size: UInt64


class HealthService(CoreData):
    name: str
    image: str
    replicas: UInt32


class HealthResource(CoreData):
    kind: str
    identity: str


class Evidence(CoreData):
    observed_at: str
    service: str | None
    container_id: str | None
    description: str
    logs: str | None


class ServiceDiagnosis(CoreData):
    service: str
    result: str
    reasons: list[str]


class Diagnosis(CoreData):
    result: str
    summary: str
    complete: bool
    services: list[ServiceDiagnosis]
    anomalies: list[str]
    evidence: list[Evidence]


class Cleanup(CoreData):
    state: str
    errors: list[str]


class ManagedProject(CoreData):
    owner: str
    project: str


class Execution(CoreData):
    run_id: str
    definition: Definition
    definition_path: str
    mode: str
    state: str
    diagnosis: Diagnosis
    created_at: str
    started_at: str | None
    finished_at: str | None
    artifact: Artifact | None
    compose_path: str
    compose_checksum: str | None
    restore_dir: str
    project: ManagedProject | None
    services: list[HealthService]
    resources: list[HealthResource]
    cleanup: Cleanup
    report_path: str | None


class DirectoryIdentity(CoreData):
    device: UInt64
    inode: UInt64


class RestoredDirectory(CoreData):
    path: str
    identity: DirectoryIdentity | None


class HistoryRecord(Execution):
    record_version: UInt32
    restore_provenance: RestoredDirectory | None
    report_status: str


class History(RootModel[list[HistoryRecord]]):
    model_config = ConfigDict(strict=True)


class Reports(RootModel[list[str]]):
    model_config = ConfigDict(strict=True)


class Report(CoreData):
    run_id: str
    markdown: str


class DeletedReport(CoreData):
    run_id: str
    deleted: bool
