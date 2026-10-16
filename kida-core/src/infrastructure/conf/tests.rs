use std::{fs, path::PathBuf};

use super::*;
use crate::{
    features::backup::{error::BackupError, model::BackupTargetStatus, service::BackupService},
    infrastructure::storage::StorageError,
};

pub(crate) fn init_test_config() -> &'static KidaConfig {
    CONFIG.get_or_init(|| {
        let mut config = KidaConfig::default();
        config.queue.capacity = 3;
        config.scheduler.path = std::env::temp_dir()
            .join(format!("kida-scheduler-test-{}.toml", uuid::Uuid::new_v4()))
            .to_str()
            .unwrap()
            .into();
        config
    })
}

pub(super) struct TempDir(pub(super) PathBuf);

impl TempDir {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("kida-conf-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn assert_defaults(config: &KidaConfig) {
    assert_eq!(config.unix.socket_path, DEFAULT_UNIX_SOCKET_PATH);
    assert_eq!(config.http.host, DEFAULT_HTTP_HOST);
    assert_eq!(config.http.port, DEFAULT_HTTP_PORT);
    assert_eq!(config.backup.backup_dir, DEFAULT_BACKUP_DIRECTORY);
    assert_eq!(config.scheduler.path, DEFAULT_SCHEDULER_PATH);
    assert_eq!(config.docker.ownership_dir, DEFAULT_DOCKER_OWNERSHIP_DIR);
    assert_eq!(config.queue.capacity, DEFAULT_QUEUE_CAPACITY);
    assert_eq!(
        config.queue.max_concurrent_jobs,
        DEFAULT_MAX_CONCURRENT_JOBS
    );
    assert_eq!(
        config.backup_health.restore_root,
        PathBuf::from(DEFAULT_HEALTH_RESTORE_ROOT)
    );
    assert_eq!(
        config.backup_health.data_root,
        PathBuf::from(DEFAULT_HEALTH_DATA_ROOT)
    );
    assert_eq!(
        config.backup_health.manual_ttl_hours,
        DEFAULT_HEALTH_MANUAL_TTL_HOURS
    );
    assert_eq!(
        config.backup_health.health_timeout_seconds,
        DEFAULT_HEALTH_TIMEOUT_SECONDS
    );
    assert_eq!(
        config.backup_health.report_retention_days,
        DEFAULT_HEALTH_REPORT_RETENTION_DAYS
    );
    assert_eq!(
        config.backup_health.max_active_runs,
        DEFAULT_HEALTH_MAX_ACTIVE_RUNS
    );
}

#[test]
fn toml_defaults_and_custom_values() {
    assert_defaults(&toml::from_str::<KidaConfig>("").unwrap());
    assert_defaults(
        &toml::from_str::<KidaConfig>("[unix]\n[http]\n[backup]\n[scheduler]\n[queue]\n").unwrap(),
    );

    let partial: KidaConfig = toml::from_str("[http]\nport = 9000\n").unwrap();
    assert_eq!(partial.http.port, 9000);
    assert_eq!(partial.http.host, DEFAULT_HTTP_HOST);
    assert_eq!(partial.unix.socket_path, DEFAULT_UNIX_SOCKET_PATH);
    assert_eq!(partial.backup.backup_dir, DEFAULT_BACKUP_DIRECTORY);
    assert_eq!(partial.scheduler.path, DEFAULT_SCHEDULER_PATH);
    assert_eq!(partial.queue.capacity, DEFAULT_QUEUE_CAPACITY);

    let old: KidaConfig = toml::from_str(
        "[unix]\nsocket_path = '/tmp/old.sock'\n[http]\nhost = '0.0.0.0'\nport = 9001\n",
    )
    .unwrap();
    assert_eq!(old.unix.socket_path, "/tmp/old.sock");
    assert_eq!(old.http.host, "0.0.0.0");
    assert_eq!(old.http.port, 9001);
    assert_eq!(old.backup.backup_dir, DEFAULT_BACKUP_DIRECTORY);
    assert_eq!(old.scheduler.path, DEFAULT_SCHEDULER_PATH);
    assert_eq!(old.queue.capacity, DEFAULT_QUEUE_CAPACITY);
    assert_eq!(old.queue.max_concurrent_jobs, DEFAULT_MAX_CONCURRENT_JOBS);

    let old_queue: KidaConfig = toml::from_str("[queue]\ncapacity = 3\n").unwrap();
    assert_eq!(old_queue.queue.capacity, 3);
    assert_eq!(
        old_queue.queue.max_concurrent_jobs,
        DEFAULT_MAX_CONCURRENT_JOBS
    );

    let concurrent: KidaConfig = toml::from_str("[queue]\nmax_concurrent_jobs = 4\n").unwrap();
    assert_eq!(concurrent.queue.capacity, DEFAULT_QUEUE_CAPACITY);
    assert_eq!(concurrent.queue.max_concurrent_jobs, 4);

    let custom: KidaConfig = toml::from_str(
        "[unix]\nsocket_path = '/tmp/custom.sock'\n[http]\nhost = '::1'\nport = 9002\n[backup]\nbackup_dir = '/tmp/custom-backups'\n[scheduler]\npath = '/tmp/custom-scheduler.toml'\n[queue]\ncapacity = 3\n",
    )
    .unwrap();
    assert_eq!(custom.unix.socket_path, "/tmp/custom.sock");
    assert_eq!(custom.http.host, "::1");
    assert_eq!(custom.http.port, 9002);
    assert_eq!(custom.backup.backup_dir, "/tmp/custom-backups");
    assert_eq!(custom.scheduler.path, "/tmp/custom-scheduler.toml");
    assert_eq!(custom.queue.capacity, 3);
}

#[test]
fn manager_creates_missing_file_and_preserves_update_api() {
    let temp = TempDir::new();
    let path = temp.0.join("nested/kida.toml");
    let mut manager = ConfigManager::load_or_create(&path).unwrap();
    assert_defaults(manager.get());
    assert_defaults(&toml::from_str::<KidaConfig>(&fs::read_to_string(&path).unwrap()).unwrap());

    let mut updated = manager.get().clone();
    updated.backup.backup_dir = "/tmp/updated-backups".into();
    updated.scheduler.path = "/tmp/updated-scheduler.toml".into();
    updated.queue.capacity = 3;
    updated.queue.max_concurrent_jobs = 4;
    manager.update(updated).unwrap();
    assert_eq!(manager.get().backup.backup_dir, "/tmp/updated-backups");
    assert_eq!(manager.get().scheduler.path, "/tmp/updated-scheduler.toml");
    assert_eq!(manager.get().queue.capacity, 3);
    assert_eq!(manager.get().queue.max_concurrent_jobs, 4);
    assert_eq!(
        ConfigManager::load_or_create(&path)
            .unwrap()
            .get()
            .queue
            .max_concurrent_jobs,
        4
    );
    assert_eq!(
        ConfigManager::load_or_create(&path)
            .unwrap()
            .get()
            .queue
            .capacity,
        3
    );
    assert_eq!(
        ConfigManager::load_or_create(&path)
            .unwrap()
            .get()
            .backup
            .backup_dir,
        "/tmp/updated-backups"
    );
    assert_eq!(
        ConfigManager::load_or_create(&path)
            .unwrap()
            .get()
            .scheduler
            .path,
        "/tmp/updated-scheduler.toml"
    );
}

#[test]
fn invalid_concurrency_is_rejected_without_changing_configuration() {
    let temp = TempDir::new();
    let path = temp.0.join("kida.toml");
    let mut manager = ConfigManager::load_or_create(&path).unwrap();
    let original = fs::read_to_string(&path).unwrap();

    for limit in [0, tokio::sync::Semaphore::MAX_PERMITS + 1] {
        let mut invalid = manager.get().clone();
        invalid.queue.max_concurrent_jobs = limit;
        assert!(manager.update(invalid).is_err());
        assert_defaults(manager.get());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);

        let content = format!("[queue]\nmax_concurrent_jobs = {limit}\n");
        let invalid_path = temp.0.join("invalid-limit.toml");
        fs::write(&invalid_path, &content).unwrap();
        assert!(ConfigManager::load_or_create(&invalid_path).is_err());
        assert_eq!(fs::read_to_string(&invalid_path).unwrap(), content);
    }

    let mut invalid = manager.get().clone();
    invalid.queue.capacity = usize::MAX;
    assert!(manager.update(invalid).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
}

// A separate process preserves the uninitialized singleton checks.
#[tokio::test]
async fn singleton_and_backup_service_use_the_published_snapshot() {
    const CHILD_ENV: &str = "KIDA_CONF_SINGLETON_TEST";
    if std::env::var_os(CHILD_ENV).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "infrastructure::conf::tests::singleton_and_backup_service_use_the_published_snapshot",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("running 1 test"));
        return;
    }

    let temp = TempDir::new();
    assert_eq!(get().unwrap_err(), "configuration not initialized");
    assert!(
        crate::features::backup::health::definition::load("missing.toml")
            .unwrap_err()
            .to_string()
            .contains("configuration not initialized")
    );
    for error in [
        BackupService::list().unwrap_err(),
        BackupService::create(
            serde_json::from_value(
                serde_json::json!({"name":"unused", "sources":[], "targets":[]}),
            )
            .unwrap(),
        )
        .unwrap_err(),
        BackupService::delete("missing").unwrap_err(),
        BackupService::run("missing").await.unwrap_err(),
    ] {
        assert!(matches!(error, BackupError::Io(ref source)
            if source.kind() == std::io::ErrorKind::Other
                && source.to_string() == "configuration not initialized"));
    }

    let invalid = temp.0.join("invalid.toml");
    fs::write(&invalid, "[invalid").unwrap();
    let error = init(&invalid).unwrap_err();
    assert!(matches!(
        error.downcast_ref::<StorageError>(),
        Some(StorageError::TomlDeserialize { .. })
    ));
    assert_eq!(fs::read_to_string(&invalid).unwrap(), "[invalid");
    assert!(get().is_err());

    let error = init(&temp.0).unwrap_err();
    assert!(matches!(
        error.downcast_ref::<StorageError>(),
        Some(StorageError::Io(_))
    ));
    assert!(get().is_err());

    let backups = temp.0.join("jobs");
    let path = temp.0.join("kida.toml");
    let mut config = KidaConfig::default();
    config.backup.backup_dir = backups.to_str().unwrap().into();
    config.backup_health.restore_root = temp.0.join("restore");
    config.backup_health.data_root = temp.0.join("health-data");
    fs::write(&path, toml::to_string(&config).unwrap()).unwrap();
    init(&path).unwrap();
    let published = get().unwrap();
    assert_eq!(published.backup.backup_dir, backups.to_str().unwrap());

    let second_path = temp.0.join("second.toml");
    assert_eq!(
        init(&second_path).unwrap_err().to_string(),
        "configuration already initialized"
    );
    assert!(!second_path.exists());
    assert!(std::ptr::eq(published, get().unwrap()));
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(move || {
                assert!(std::ptr::eq(published, get().unwrap()));
                assert_eq!(
                    get().unwrap().backup.backup_dir,
                    published.backup.backup_dir
                );
            });
        }
    });

    let mut manager = ConfigManager::load_or_create(&path).unwrap();
    let mut changed = manager.get().clone();
    changed.backup.backup_dir = temp.0.join("other-jobs").to_str().unwrap().into();
    changed.backup_health.max_active_runs = 7;
    manager.update(changed).unwrap();
    assert_ne!(manager.get().backup.backup_dir, published.backup.backup_dir);
    assert_eq!(get().unwrap().backup.backup_dir, backups.to_str().unwrap());
    assert_eq!(
        get().unwrap().backup_health.max_active_runs,
        DEFAULT_HEALTH_MAX_ACTIVE_RUNS
    );
    fs::remove_file(&path).unwrap();
    assert!(std::ptr::eq(published, get().unwrap()));

    assert!(BackupService::list().unwrap().is_empty());
    let source = temp.0.join("source.txt");
    fs::write(&source, "backup payload").unwrap();
    let target = temp.0.join("target");
    fs::create_dir(&target).unwrap();
    let job_path = temp.0.join("job.toml");
    fs::write(
        &job_path,
        format!(
            "name = 'configured-backup'\nsources = ['{}']\n[[targets]]\npath = '{}'\n",
            source.display(),
            target.display()
        ),
    )
    .unwrap();
    let job =
        BackupService::create(toml::from_str(&fs::read_to_string(&job_path).unwrap()).unwrap())
            .unwrap();
    let stored_job = backups.join(format!("{}.toml", job.id));
    assert!(stored_job.is_file());
    let health_path = temp.0.join("health.toml");
    fs::write(
        &health_path,
        format!(
            "id = 'health'\nname = 'Health'\n[backup]\nreference = '{}'\nversion = 'latest'\n[docker]\ncompose = './compose.yml'\n",
            job.id
        ),
    ).unwrap();
    fs::write(temp.0.join("compose.yml"), "services: {}\n").unwrap();
    let definition = crate::features::backup::health::definition::load(&health_path).unwrap();
    assert_eq!(definition.backup_job.id, job.id);
    assert!(!published.backup_health.restore_root.exists());
    assert!(!published.backup_health.data_root.exists());
    assert!(!temp.0.join("other-jobs").exists());
    let listed = BackupService::list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, job.id);

    let result = BackupService::run(&job.name).await.unwrap();
    assert_eq!(result.job_id, job.id);
    assert!(result.size > 0);
    assert_eq!(result.targets.len(), 1);
    assert!(matches!(result.targets[0].status, BackupTargetStatus::Ok));
    let decoder =
        zstd::Decoder::new(fs::File::open(target.join(&result.artifact_name)).unwrap()).unwrap();
    let mut archive = tar::Archive::new(decoder);
    let restored = temp.0.join("restored");
    archive.unpack(&restored).unwrap();
    assert_eq!(
        fs::read_to_string(restored.join(source.strip_prefix("/").unwrap())).unwrap(),
        "backup payload"
    );

    assert_eq!(BackupService::delete(&job.id).unwrap().id, job.id);
    assert!(!stored_job.exists());
    assert!(BackupService::list().unwrap().is_empty());
}

#[test]
fn docker_ownership_config_defaults_and_override() {
    let defaults: KidaConfig = toml::from_str("[docker]\n").unwrap();
    assert_eq!(defaults.docker.ownership_dir, DEFAULT_DOCKER_OWNERSHIP_DIR);
    let custom: KidaConfig =
        toml::from_str("[docker]\nownership_dir = '/tmp/private-docker'\n").unwrap();
    assert_eq!(custom.docker.ownership_dir, "/tmp/private-docker");
}
