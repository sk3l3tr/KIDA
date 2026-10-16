use std::{fs, io::ErrorKind, path::PathBuf};

use serde_json::json;

use super::{definition, model::*};
use crate::features::{
    backup::{error::BackupError, model::BackupJob, repository::BackupRepository},
    docker::ManagedProject,
};

const EXAMPLE: &str = include_str!("../../../../examples/backup-health/nextcloud-health.toml");
const COMPOSE: &str = include_str!("../../../../examples/backup-health/docker-compose.health.yml");

struct Fixture {
    directory: PathBuf,
    path: PathBuf,
    repository: BackupRepository,
    job_id: String,
}

impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("kida-health-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let repository = BackupRepository::new(directory.join("jobs"));
        let job_id = uuid::Uuid::new_v4().to_string();
        let fixture = Self {
            path: directory.join("health.toml"),
            directory,
            repository,
            job_id,
        };
        fixture.add_job(&fixture.job_id, "nextcloud-daily");
        fs::write(&fixture.path, EXAMPLE).unwrap();
        fs::write(fixture.directory.join("docker-compose.health.yml"), COMPOSE).unwrap();
        fixture
    }

    fn add_job(&self, id: &str, name: &str) {
        let job: BackupJob = serde_json::from_value(json!({
            "id": id, "name": name, "sources": [], "targets": [], "compression": "tar_zstd"
        }))
        .unwrap();
        self.repository.create(&job).unwrap();
    }

    fn load(&self) -> Result<ResolvedHealthDefinition, BackupError> {
        definition::load_in(&self.path, &self.repository)
    }

    fn write_value(&self, value: &toml::Value) {
        fs::write(&self.path, toml::to_string(value).unwrap()).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.directory).unwrap();
    }
}

#[test]
fn loads_example_by_name_or_id_and_resolves_paths_without_creating_resources() {
    let fixture = Fixture::new();
    for reference in ["nextcloud-daily", fixture.job_id.as_str()] {
        fs::write(&fixture.path, EXAMPLE.replace("nextcloud-daily", reference)).unwrap();
        let loaded = fixture.load().unwrap();
        assert_eq!(loaded.definition.id, "nextcloud-health");
        assert_eq!(loaded.definition.backup.version, "latest");
        assert_eq!(loaded.backup_job.id, fixture.job_id);
        assert_eq!(
            loaded.definition_path,
            fs::canonicalize(&fixture.path).unwrap()
        );
        assert_eq!(
            loaded.compose_path,
            fs::canonicalize(fixture.directory.join("docker-compose.health.yml")).unwrap()
        );
        assert!(loaded.definition_path.is_absolute());
        assert!(loaded.compose_path.is_absolute());
        assert_eq!(fs::read_dir(&fixture.directory).unwrap().count(), 3);
        assert_eq!(fs::read_to_string(&loaded.compose_path).unwrap(), COMPOSE);
    }
}

#[test]
fn accepts_absolute_compose_and_specific_artifact_uuid() {
    let fixture = Fixture::new();
    let mut value: toml::Value = toml::from_str(EXAMPLE).unwrap();
    let artifact_id = uuid::Uuid::new_v4().to_string();
    value["backup"]["version"] = artifact_id.clone().into();
    value["docker"]["compose"] = fixture
        .directory
        .join("docker-compose.health.yml")
        .to_str()
        .unwrap()
        .into();
    fixture.write_value(&value);
    assert_eq!(
        fixture.load().unwrap().definition.backup.version,
        artifact_id
    );
}

#[test]
fn relative_definition_path_uses_its_directory_for_compose() {
    let fixture = Fixture::new();
    let path = std::path::Path::new("examples/backup-health/nextcloud-health.toml");
    let loaded = definition::load_in(path, &fixture.repository).unwrap();
    assert_eq!(loaded.definition_path, fs::canonicalize(path).unwrap());
    assert_eq!(
        loaded.compose_path,
        fs::canonicalize("examples/backup-health/docker-compose.health.yml").unwrap()
    );
}

#[test]
fn rejects_missing_and_blank_required_fields() {
    let fixture = Fixture::new();
    for (table, field) in [
        (None, "id"),
        (None, "name"),
        (Some("backup"), "reference"),
        (Some("backup"), "version"),
        (Some("docker"), "compose"),
    ] {
        let original: toml::Value = toml::from_str(EXAMPLE).unwrap();
        let mut value = original.clone();
        let target = if let Some(table) = table {
            value[table].as_table_mut().unwrap()
        } else {
            value.as_table_mut().unwrap()
        };
        target.remove(field);
        fixture.write_value(&value);
        assert!(fixture.load().is_err(), "missing {table:?}.{field}");

        for blank in ["", " \t "] {
            let mut value = original.clone();
            let target = if let Some(table) = table {
                &mut value[table][field]
            } else {
                &mut value[field]
            };
            *target = blank.into();
            fixture.write_value(&value);
            assert!(
                matches!(fixture.load(), Err(BackupError::Io(e)) if e.kind() == ErrorKind::InvalidInput)
            );
        }
    }
    for table in ["backup", "docker"] {
        let mut value: toml::Value = toml::from_str(EXAMPLE).unwrap();
        value.as_table_mut().unwrap().remove(table);
        fixture.write_value(&value);
        assert!(fixture.load().is_err());
    }
}

#[test]
fn rejects_invalid_version_unknown_fields_and_malformed_toml() {
    let fixture = Fixture::new();
    for text in [
        EXAMPLE.replace("latest", "yesterday"),
        EXAMPLE.replace("latest", "LATEST"),
        EXAMPLE.replace("name =", "unexpected ="),
        EXAMPLE.replace("compose =", "dockerfile ="),
        "[broken".into(),
    ] {
        fs::write(&fixture.path, &text).unwrap();
        assert!(fixture.load().is_err());
        assert_eq!(fs::read_to_string(&fixture.path).unwrap(), text);
    }
}

#[test]
fn rejects_missing_definition_missing_compose_and_directory_as_compose() {
    let fixture = Fixture::new();
    assert!(matches!(
        definition::load_in(&fixture.directory.join("missing.toml"), &fixture.repository),
        Err(BackupError::Io(e)) if e.kind() == ErrorKind::NotFound
    ));
    fs::remove_file(fixture.directory.join("docker-compose.health.yml")).unwrap();
    assert!(matches!(fixture.load(), Err(BackupError::Io(e)) if e.kind() == ErrorKind::NotFound));
    fs::create_dir(fixture.directory.join("docker-compose.health.yml")).unwrap();
    assert!(
        matches!(fixture.load(), Err(BackupError::Io(e)) if e.kind() == ErrorKind::InvalidInput)
    );
}

#[test]
fn rejects_unknown_and_ambiguous_references_without_changing_existing_lookup() {
    let fixture = Fixture::new();
    fs::write(&fixture.path, EXAMPLE.replace("nextcloud-daily", "missing")).unwrap();
    assert!(matches!(fixture.load(), Err(BackupError::Io(e)) if e.kind() == ErrorKind::NotFound));

    fs::write(&fixture.path, EXAMPLE).unwrap();
    fixture.add_job(&uuid::Uuid::new_v4().to_string(), "nextcloud-daily");
    assert!(matches!(fixture.load(), Err(BackupError::Io(e))
        if e.kind() == ErrorKind::InvalidInput && e.to_string().contains("ambiguous")));
    assert!(fixture.repository.get("nextcloud-daily").is_ok());

    fs::write(
        &fixture.path,
        EXAMPLE.replace("nextcloud-daily", &fixture.job_id),
    )
    .unwrap();
    assert_eq!(fixture.load().unwrap().backup_job.id, fixture.job_id);
    fixture.add_job(&uuid::Uuid::new_v4().to_string(), &fixture.job_id);
    assert!(
        matches!(fixture.load(), Err(BackupError::Io(e)) if e.kind() == ErrorKind::InvalidInput)
    );
}

#[test]
fn missing_repository_is_not_created_by_definition_loading() {
    let fixture = Fixture::new();
    let missing = fixture.directory.join("missing-jobs");
    assert!(definition::load_in(&fixture.path, &BackupRepository::new(&missing)).is_err());
    assert!(!missing.exists());
    assert_eq!(fs::read_dir(&fixture.directory).unwrap().count(), 3);
}

#[test]
fn shared_execution_snapshot_roundtrips_without_a_persistence_repository() {
    let fixture = Fixture::new();
    let loaded = fixture.load().unwrap();
    let snapshot = BackupHealthExecution {
        run_id: uuid::Uuid::new_v4().to_string(),
        definition: loaded.definition,
        definition_path: loaded.definition_path,
        mode: BackupHealthMode::Manual,
        state: BackupHealthState::Stopped,
        diagnosis: HealthDiagnosis {
            result: BackupHealthResult::Degraded,
            summary: "Recovered restart".into(),
            complete: true,
            services: vec![HealthServiceDiagnosis {
                service: "app".into(),
                result: BackupHealthResult::Degraded,
                reasons: vec!["one restart".into()],
            }],
            anomalies: vec!["one restart".into()],
            evidence: vec![HealthEvidence {
                observed_at: "2026-10-16T10:00:00Z".into(),
                service: Some("app".into()),
                container_id: Some("container-id".into()),
                description: "Recovered".into(),
                logs: Some("sanitized excerpt".into()),
            }],
        },
        created_at: "2026-10-16T10:00:00Z".into(),
        started_at: Some("2026-10-16T10:01:00Z".into()),
        finished_at: None,
        artifact: Some(ResolvedBackupArtifact {
            artifact_id: uuid::Uuid::new_v4().to_string(),
            job_id: loaded.backup_job.id,
            artifact_name: "backup.tar.zst".into(),
            created_at: "2026-10-16T09:00:00Z".into(),
            path: fixture.directory.join("backup.tar.zst"),
            checksum: "a".repeat(64),
            size: 128,
        }),
        compose_path: loaded.compose_path,
        compose_checksum: Some("b".repeat(64)),
        restore_dir: fixture.directory.join("restored/run"),
        project: Some(ManagedProject {
            owner: "owner-id".into(),
            project: "kida-bh-run".into(),
        }),
        services: vec![HealthService {
            name: "app".into(),
            image: "example/app:stable".into(),
            replicas: 1,
        }],
        resources: vec![HealthResource {
            kind: "container".into(),
            identity: "container-id".into(),
        }],
        cleanup: HealthCleanup {
            state: HealthCleanupState::Pending,
            errors: Vec::new(),
        },
        report_path: None,
    };
    let value = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(value["mode"], "MANUAL");
    assert_eq!(value["state"], "STOPPED");
    assert_eq!(value["diagnosis"]["result"], "DEGRADED");
    assert_eq!(value["cleanup"]["state"], "PENDING");
    let restored: BackupHealthExecution = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(), value);
    assert!(serde_json::from_value::<BackupHealthState>(json!("DELETED")).is_err());
    assert!(!snapshot.restore_dir.exists());
}
