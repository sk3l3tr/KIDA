// Must implement tests cases here! Do not implement tests inside source files!

#[cfg(test)]
mod repository_tests {
    use super::super::error::BackupError;
    use super::super::{
        model::{BackupJob, NewBackupJob},
        repository::{BackupRepository, StoredBackupJob},
        service::BackupService,
    };
    use crate::infrastructure::storage::StorageError;
    use serde_json::{Value, json};
    use std::{
        fs,
        io::ErrorKind,
        path::{Path, PathBuf},
    };

    struct Directory(PathBuf);

    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("kida-lookup-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Directory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn write_job(path: &Path, id: &str, name: &str) {
        let job: BackupJob = serde_json::from_value(json!({
            "id": id, "name": name, "sources": [], "targets": [], "compression": "tar_zstd"
        }))
        .unwrap();
        fs::write(path, toml::to_string(&StoredBackupJob(job)).unwrap()).unwrap();
    }

    fn assert_missing(error: BackupError, identifier: &str) {
        match error {
            BackupError::Io(error) => {
                assert_eq!(error.kind(), ErrorKind::NotFound);
                assert_eq!(
                    error.to_string(),
                    format!("Backup job not found: {identifier}")
                );
            }
            error => panic!("Unexpected error: {error}"),
        }
    }

    fn assert_corrupt(error: BackupError, expected: &Path) {
        match error {
            BackupError::Storage(StorageError::TomlDeserialize { path, .. }) => {
                assert_eq!(path, expected);
            }
            error => panic!("Unexpected error: {error}"),
        }
    }

    #[test]
    fn lookup_and_delete_preserve_missing_directory_and_missing_job_errors() {
        let directory = Directory::new();
        for path in [directory.0.join("absent"), directory.0.clone()] {
            let existed = path.exists();
            let repository = BackupRepository::new(&path);
            assert_missing(repository.get("missing").unwrap_err(), "missing");
            assert_missing(repository.delete("missing").unwrap_err(), "missing");
            assert_eq!(path.exists(), existed);
        }
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
    }

    #[test]
    fn lookup_and_delete_use_stored_selectors_and_ignore_other_extensions() {
        for selector in ["stored-id", "stored-name"] {
            let directory = Directory::new();
            let repository = BackupRepository::new(&directory.0);
            let path = directory.0.join("different-filename.toml");
            write_job(&path, "stored-id", "stored-name");
            for name in ["ignored.TOML", "ignored.json", "no-extension"] {
                fs::write(directory.0.join(name), "invalid[").unwrap();
            }
            assert_eq!(repository.get(selector).unwrap().id, "stored-id");
            let deleted = repository.delete(selector).unwrap();
            assert_eq!(deleted.id, "stored-id");
            assert_eq!(deleted.name, "stored-name");
            assert!(!path.exists());
            assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 3);
            for name in ["ignored.TOML", "ignored.json", "no-extension"] {
                assert_eq!(
                    fs::read_to_string(directory.0.join(name)).unwrap(),
                    "invalid["
                );
            }
            assert_missing(repository.get(selector).unwrap_err(), selector);
            assert_missing(repository.delete(selector).unwrap_err(), selector);
        }
    }

    #[test]
    fn corrupt_toml_aborts_lookup_and_delete_without_changing_the_file() {
        let directory = Directory::new();
        let repository = BackupRepository::new(&directory.0);
        let path = directory.0.join("broken.toml");
        fs::write(&path, "invalid[").unwrap();
        assert_corrupt(repository.get("missing").unwrap_err(), &path);
        assert_corrupt(repository.delete("missing").unwrap_err(), &path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "invalid[");
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[test]
    fn duplicate_names_and_id_name_collisions_keep_first_directory_match() {
        for id_name_collision in [false, true] {
            let directory = Directory::new();
            for name in ["z.toml", "a.toml"] {
                fs::write(directory.0.join(name), "").unwrap();
            }
            // Derive expectations from filesystem iteration, not lexical file/name order.
            let paths: Vec<_> = fs::read_dir(&directory.0)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            write_job(&paths[0], "first-id", "shared");
            let (second_id, second_name) = if id_name_collision {
                ("shared", "other-name")
            } else {
                ("second-id", "shared")
            };
            write_job(&paths[1], second_id, second_name);
            let repository = BackupRepository::new(&directory.0);
            assert_eq!(repository.get("shared").unwrap().id, "first-id");
            assert_eq!(repository.delete("shared").unwrap().id, "first-id");
            assert!(!paths[0].exists());
            assert!(paths[1].exists());
            assert_eq!(repository.get("shared").unwrap().id, second_id);
            assert_eq!(repository.delete("shared").unwrap().id, second_id);
            assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
        }
    }

    #[test]
    fn traversal_reports_corruption_before_match_and_stops_after_match() {
        for corrupt_first in [false, true] {
            let directory = Directory::new();
            for name in ["one.toml", "two.toml"] {
                fs::write(directory.0.join(name), "").unwrap();
            }
            let paths: Vec<_> = fs::read_dir(&directory.0)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            let (corrupt, valid) = if corrupt_first {
                (&paths[0], &paths[1])
            } else {
                (&paths[1], &paths[0])
            };
            fs::write(corrupt, "invalid[").unwrap();
            write_job(valid, "id", "name");
            let original = fs::read(valid).unwrap();
            let repository = BackupRepository::new(&directory.0);
            if corrupt_first {
                assert_corrupt(repository.get("id").unwrap_err(), corrupt);
                assert_corrupt(repository.delete("id").unwrap_err(), corrupt);
                assert_eq!(fs::read(valid).unwrap(), original);
            } else {
                assert_eq!(repository.get("id").unwrap().name, "name");
                assert_eq!(repository.delete("id").unwrap().name, "name");
                assert!(!valid.exists());
            }
            assert_eq!(fs::read_to_string(corrupt).unwrap(), "invalid[");
        }
    }

    #[test]
    fn typed_creation_round_trips_free_json_and_repository_operations() {
        let directory = std::env::temp_dir().join(format!("kida-backup-{}", uuid::Uuid::new_v4()));
        let repository = BackupRepository::new(&directory);
        let fixture: Value =
            serde_json::from_str(include_str!("../../../../tests/fixtures/backup.json")).unwrap();
        let input: NewBackupJob = serde_json::from_value(fixture.clone()).unwrap();
        let job = BackupService::create_in(input, &repository).unwrap();
        assert_eq!(uuid::Uuid::parse_str(&job.id).unwrap().get_version_num(), 4);
        let mut value = serde_json::to_value(&job).unwrap();
        value.as_object_mut().unwrap().remove("id");
        assert_eq!(value, fixture);
        let toml_input: NewBackupJob =
            toml::from_str(include_str!("../../../../tests/fixtures/backup.toml")).unwrap();
        let toml_job = BackupService::create_in(toml_input, &repository).unwrap();
        let mut toml_value = serde_json::to_value(&toml_job).unwrap();
        toml_value.as_object_mut().unwrap().remove("id");
        assert_eq!(toml_value, fixture);
        repository.delete(&toml_job.id).unwrap();
        assert!(repository.create(&job).is_err());
        for loaded in [
            repository.get(&job.id).unwrap(),
            repository.get(&job.name).unwrap(),
            repository.list().unwrap().pop().unwrap(),
        ] {
            assert_eq!(
                serde_json::to_value(loaded).unwrap(),
                serde_json::to_value(&job).unwrap()
            );
        }
        assert_eq!(repository.delete(&job.name).unwrap().id, job.id);
        assert!(repository.list().unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_legacy_toml_without_reinterpreting_strings() {
        let text = format!(
            "id = 'legacy'\n{}",
            include_str!("../../../../tests/fixtures/backup.toml")
        );
        let stored: StoredBackupJob = toml::from_str(&text).unwrap();
        assert_eq!(stored.0.lifecycle.pre_backup[0].params, Value::Null);
        assert_eq!(stored.0.lifecycle.post_backup[0].params, json!("null"));
        let minimal: StoredBackupJob = toml::from_str("id='old'\nname='old'\nsources=[]\ntargets=[]\ncompression='tar_zstd'\nschedule='[null]'\n").unwrap();
        assert_eq!(minimal.0.schedule, Some(json!("[null]")));
        assert!(minimal.0.lifecycle.pre_backup.is_empty());
    }

    #[test]
    fn scalar_and_nested_json_values_round_trip() {
        for value in [
            json!(null),
            json!("null"),
            json!(true),
            json!(42),
            json!([null, {}, [1]]),
            json!({"nested":{"null":null}}),
        ] {
            let mut job: BackupJob = serde_json::from_value(json!({"id":"id", "name":"name", "sources":[], "targets":[], "compression":"tar_zstd", "lifecycle":{"pre_backup":[{"command":"c", "params":value}]}})).unwrap();
            job.schedule = Some(value.clone());
            let encoded = toml::to_string(&StoredBackupJob(job)).unwrap();
            let loaded: StoredBackupJob = toml::from_str(&encoded).unwrap();
            // An explicit null schedule has the public Option<Value> semantics.
            assert_eq!(
                loaded.0.schedule,
                if value.is_null() {
                    None
                } else {
                    Some(value.clone())
                }
            );
            assert_eq!(loaded.0.lifecycle.pre_backup[0].params, value);
        }
        assert!(toml::from_str::<StoredBackupJob>("id='id'\nname='n'\nsources=[]\ntargets=[]\ncompression='tar_zstd'\nschedule_json='{'\n").is_err());
    }
}
