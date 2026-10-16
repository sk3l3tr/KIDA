use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize, Serializer, ser::Error};

use super::{StorageError, StorageFactory, StorageFormat, atomic_write};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Record {
    #[serde(serialize_with = "serialize_value")]
    value: String,
}

fn serialize_value<S: Serializer>(value: &str, serializer: S) -> Result<S::Ok, S::Error> {
    if value == "reject" {
        return Err(S::Error::custom("injected serialization failure"));
    }
    serializer.serialize_str(value)
}

fn record(value: &str) -> Record {
    Record {
        value: value.into(),
    }
}

struct Directory(PathBuf);

impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("kida-storage-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn entries(&self) -> Vec<PathBuf> {
        let mut paths: Vec<_> = fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        paths.sort();
        paths
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn both_formats_create_read_and_replace_without_temporary_files() {
    for format in [StorageFormat::Json, StorageFormat::Toml] {
        let directory = Directory::new();
        let parent = directory.0.join("nested").join("data");
        let path = parent.join("record");
        let storage = StorageFactory::create::<Record>(format, &path);
        storage.save(&record("first")).unwrap();
        assert_eq!(storage.load().unwrap(), record("first"));
        storage.save(&record("second")).unwrap();
        assert_eq!(storage.load().unwrap(), record("second"));
        let entries: Vec<_> = fs::read_dir(parent).unwrap().collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].as_ref().unwrap().path(), path);
    }
}

#[test]
fn both_formats_preserve_corrupt_files_and_report_the_format_and_path() {
    for format in [StorageFormat::Json, StorageFormat::Toml] {
        let directory = Directory::new();
        let path = directory.0.join("record");
        let corrupt = b"invalid[";
        fs::write(&path, corrupt).unwrap();
        let storage = StorageFactory::create::<Record>(format, &path);
        for error in [
            storage.load().unwrap_err(),
            storage.save(&record("valid")).unwrap_err(),
        ] {
            match (format, error) {
                (
                    StorageFormat::Json,
                    StorageError::JsonDeserialize {
                        path: failed_path, ..
                    },
                )
                | (
                    StorageFormat::Toml,
                    StorageError::TomlDeserialize {
                        path: failed_path, ..
                    },
                ) => {
                    assert_eq!(failed_path, path);
                }
                (_, error) => panic!("Unexpected error for {format:?}: {error}"),
            }
        }
        assert_eq!(fs::read(&path).unwrap(), corrupt);
        assert_eq!(directory.entries(), vec![path]);
    }
}

#[test]
fn both_formats_report_missing_files_without_creating_directories() {
    for format in [StorageFormat::Json, StorageFormat::Toml] {
        let directory = Directory::new();
        let path = directory.0.join("missing").join("record");
        let storage = StorageFactory::create::<Record>(format, &path);
        assert!(
            matches!(storage.load(), Err(StorageError::NotFound { path: failed_path }) if failed_path == path)
        );
        assert!(directory.entries().is_empty());
    }
}

#[test]
fn serialization_errors_do_not_create_directories_or_modify_existing_files() {
    for format in [StorageFormat::Json, StorageFormat::Toml] {
        for existing in [false, true] {
            let directory = Directory::new();
            let parent = directory.0.join("nested");
            let path = parent.join("record");
            let storage = StorageFactory::create::<Record>(format, &path);
            let original = if existing {
                storage.save(&record("original")).unwrap();
                Some(fs::read(&path).unwrap())
            } else {
                None
            };
            let error = storage.save(&record("reject")).unwrap_err();
            assert!(error.to_string().contains("injected serialization failure"));
            assert!(matches!(
                (format, error),
                (StorageFormat::Json, StorageError::JsonSerialize(_))
                    | (StorageFormat::Toml, StorageError::TomlSerialize(_))
            ));
            if let Some(original) = original {
                assert_eq!(fs::read(&path).unwrap(), original);
                assert_eq!(fs::read_dir(parent).unwrap().count(), 1);
            } else {
                assert!(directory.entries().is_empty());
            }
        }
    }
}

#[test]
fn failed_replacement_cleans_its_temporary_and_preserves_unrelated_files() {
    let directory = Directory::new();
    let path = directory.0.join("destination");
    fs::create_dir(&path).unwrap();
    let protected = path.join("protected");
    fs::write(&protected, b"valuable data").unwrap();
    let old_temporary = directory.0.join("old.tmp");
    fs::write(&old_temporary, b"administrator owned").unwrap();

    let error = atomic_write(&path, b"replacement").unwrap_err();
    assert!(matches!(error, StorageError::Io(_)));
    assert_eq!(fs::read(protected).unwrap(), b"valuable data");
    assert_eq!(fs::read(&old_temporary).unwrap(), b"administrator owned");
    let mut expected = vec![path, old_temporary];
    expected.sort();
    assert_eq!(directory.entries(), expected);
}
