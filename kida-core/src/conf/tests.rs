use std::{fs, path::PathBuf};

use super::*;
use crate::{
    backup::{error::BackupError, model::BackupTargetStatus, service::BackupService},
    storage::StorageError,
};

pub(crate) fn init_test_config() -> &'static KidaConfig {
    CONFIG.get_or_init(|| {
        let mut config = KidaConfig::default();
        config.queue.capacity = 3;
        config
    })
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
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
    assert_eq!(config.queue.capacity, DEFAULT_QUEUE_CAPACITY);
}

#[test]
fn toml_defaults_and_custom_values() {
    assert_defaults(&toml::from_str::<KidaConfig>("").unwrap());
    assert_defaults(&toml::from_str::<KidaConfig>("[unix]\n[http]\n[backup]\n[queue]\n").unwrap());

    let partial: KidaConfig = toml::from_str("[http]\nport = 9000\n").unwrap();
    assert_eq!(partial.http.port, 9000);
    assert_eq!(partial.http.host, DEFAULT_HTTP_HOST);
    assert_eq!(partial.unix.socket_path, DEFAULT_UNIX_SOCKET_PATH);
    assert_eq!(partial.backup.backup_dir, DEFAULT_BACKUP_DIRECTORY);
    assert_eq!(partial.queue.capacity, DEFAULT_QUEUE_CAPACITY);

    let old: KidaConfig = toml::from_str(
        "[unix]\nsocket_path = '/tmp/old.sock'\n[http]\nhost = '0.0.0.0'\nport = 9001\n",
    )
    .unwrap();
    assert_eq!(old.unix.socket_path, "/tmp/old.sock");
    assert_eq!(old.http.host, "0.0.0.0");
    assert_eq!(old.http.port, 9001);
    assert_eq!(old.backup.backup_dir, DEFAULT_BACKUP_DIRECTORY);
    assert_eq!(old.queue.capacity, DEFAULT_QUEUE_CAPACITY);

    let custom: KidaConfig = toml::from_str(
        "[unix]\nsocket_path = '/tmp/custom.sock'\n[http]\nhost = '::1'\nport = 9002\n[backup]\nbackup_dir = '/tmp/custom-backups'\n[queue]\ncapacity = 3\n",
    )
    .unwrap();
    assert_eq!(custom.unix.socket_path, "/tmp/custom.sock");
    assert_eq!(custom.http.host, "::1");
    assert_eq!(custom.http.port, 9002);
    assert_eq!(custom.backup.backup_dir, "/tmp/custom-backups");
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
    updated.queue.capacity = 3;
    manager.update(updated).unwrap();
    assert_eq!(manager.get().backup.backup_dir, "/tmp/updated-backups");
    assert_eq!(manager.get().queue.capacity, 3);
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
}

// A separate process preserves the uninitialized singleton checks.
#[tokio::test]
async fn singleton_and_backup_service_use_the_published_snapshot() {
    const CHILD_ENV: &str = "KIDA_CONF_SINGLETON_TEST";
    if std::env::var_os(CHILD_ENV).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "conf::tests::singleton_and_backup_service_use_the_published_snapshot",
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
        return;
    }

    let temp = TempDir::new();
    assert_eq!(get().unwrap_err(), "configuration not initialized");
    for error in [
        BackupService::list().unwrap_err(),
        BackupService::create(&temp.0.join("missing-job.toml")).unwrap_err(),
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
    manager.update(changed).unwrap();
    assert_ne!(manager.get().backup.backup_dir, published.backup.backup_dir);
    assert_eq!(get().unwrap().backup.backup_dir, backups.to_str().unwrap());
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
    let job = BackupService::create(&job_path).unwrap();
    let stored_job = backups.join(format!("{}.toml", job.id));
    assert!(stored_job.is_file());
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
