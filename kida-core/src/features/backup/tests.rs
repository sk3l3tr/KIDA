// Must implement tests cases here! Do not implement tests inside source files!

#[cfg(test)]
mod repository_tests {
    use super::super::{
        model::{BackupJob, NewBackupJob},
        repository::{BackupRepository, StoredBackupJob},
        service::BackupService,
    };
    use serde_json::{Value, json};

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
