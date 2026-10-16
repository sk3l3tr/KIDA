use std::{fs, path::PathBuf};

use super::{ConfigManager, KidaConfig, tests::TempDir};

#[test]
fn health_defaults_partial_override_and_custom_values() {
    let partial: KidaConfig = toml::from_str("[backup_health]\nmax_active_runs = 3\n").unwrap();
    assert_eq!(partial.backup_health.max_active_runs, 3);
    assert_eq!(partial.backup_health.manual_ttl_hours, 4);

    let temp = TempDir::new();
    let mut config = KidaConfig::default();
    config.backup_health.restore_root = temp.0.join("restored");
    config.backup_health.data_root = temp.0.join("data");
    config.backup_health.manual_ttl_hours = 2;
    config.backup_health.health_timeout_seconds = 20;
    config.backup_health.report_retention_days = 30;
    config.backup_health.max_active_runs = 3;
    let path = temp.0.join("kida.toml");
    fs::write(&path, toml::to_string(&config).unwrap()).unwrap();
    let manager = ConfigManager::load_or_create(&path).unwrap();
    let health = &manager.get().backup_health;
    assert_eq!(health.restore_root, config.backup_health.restore_root);
    assert_eq!(health.data_root, config.backup_health.data_root);
    assert_eq!(health.manual_ttl_hours, 2);
    assert_eq!(health.health_timeout_seconds, 20);
    assert_eq!(health.report_retention_days, 30);
    assert_eq!(health.max_active_runs, 3);
    assert!(!health.restore_root.exists());
    assert!(!health.data_root.exists());
}

#[test]
fn rejects_zero_negative_overflow_and_wrong_types() {
    let temp = TempDir::new();
    for field in [
        "manual_ttl_hours",
        "health_timeout_seconds",
        "report_retention_days",
        "max_active_runs",
    ] {
        for value in ["0", "-1", "'invalid'", "18446744073709551616"] {
            let path = temp.0.join("invalid.toml");
            let content = format!("[backup_health]\n{field} = {value}\n");
            fs::write(&path, &content).unwrap();
            assert!(
                ConfigManager::load_or_create(&path).is_err(),
                "{field}={value}"
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
    }
    let mut config = KidaConfig::default();
    config.backup_health.manual_ttl_hours = u64::MAX;
    assert!(config.backup_health.validate().is_err());
    config.backup_health.manual_ttl_hours = 4;
    config.backup_health.report_retention_days = u64::MAX;
    assert!(config.backup_health.validate().is_err());
    config.backup_health.report_retention_days = 90;
    config.backup_health.max_active_runs = tokio::sync::Semaphore::MAX_PERMITS + 1;
    assert!(config.backup_health.validate().is_err());
}

#[test]
fn rejects_empty_relative_equal_nested_and_normalized_overlapping_roots() {
    let temp = TempDir::new();
    for (restore, data) in [
        (PathBuf::new(), temp.0.join("data")),
        (PathBuf::from("relative"), temp.0.join("data")),
        (temp.0.join("restore"), PathBuf::new()),
        (temp.0.join("restore"), PathBuf::from("relative")),
        (temp.0.clone(), temp.0.clone()),
        (temp.0.clone(), temp.0.join("data")),
        (temp.0.join("restore"), temp.0.clone()),
        (temp.0.join("missing/../data"), temp.0.join("data/child")),
    ] {
        let mut config = KidaConfig::default();
        config.backup_health.restore_root = restore;
        config.backup_health.data_root = data;
        assert!(config.backup_health.validate().is_err());
    }
    let mut config = KidaConfig::default();
    config.backup_health.restore_root = temp.0.join("data");
    config.backup_health.data_root = temp.0.join("data-other");
    config.backup_health.validate().unwrap();
    assert_eq!(fs::read_dir(&temp.0).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn detects_symlink_overlap_and_non_directory_ancestors_without_creating_roots() {
    let temp = TempDir::new();
    fs::create_dir(temp.0.join("real")).unwrap();
    std::os::unix::fs::symlink(temp.0.join("real"), temp.0.join("alias")).unwrap();
    let mut config = KidaConfig::default();
    config.backup_health.restore_root = temp.0.join("real/new");
    config.backup_health.data_root = temp.0.join("alias/new/data");
    assert!(config.backup_health.validate().is_err());
    assert!(!temp.0.join("real/new").exists());

    fs::write(temp.0.join("file"), "untouched").unwrap();
    config.backup_health.data_root = temp.0.join("file/child");
    assert!(config.backup_health.validate().is_err());
    assert_eq!(
        fs::read_to_string(temp.0.join("file")).unwrap(),
        "untouched"
    );
}

#[test]
fn manager_rejects_invalid_health_update_before_changing_snapshot_or_file() {
    let temp = TempDir::new();
    let path = temp.0.join("kida.toml");
    let mut manager = ConfigManager::load_or_create(&path).unwrap();
    let original = fs::read_to_string(&path).unwrap();
    for overlapping_roots in [false, true] {
        let mut config = manager.get().clone();
        if overlapping_roots {
            config.backup_health.data_root = config.backup_health.restore_root.clone();
        } else {
            config.backup_health.manual_ttl_hours = 0;
        }
        assert!(manager.update(config).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert_eq!(manager.get().backup_health.manual_ttl_hours, 4);
        assert_ne!(
            manager.get().backup_health.restore_root,
            manager.get().backup_health.data_root
        );
    }
}
