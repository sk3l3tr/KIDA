use super::*;

struct Fixture {
    root: PathBuf,
    repository: ArtifactRepository,
    job_id: String,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("kida-artifacts-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self {
            repository: ArtifactRepository::new(&root),
            root,
            job_id: Uuid::new_v4().to_string(),
        }
    }

    fn artifact(&self, id: &str, date: &str, payload: &[u8]) -> StoredArtifact {
        let name = format!("test-{id}.tar.zst");
        let path = self.root.join(&name);
        fs::write(&path, payload).unwrap();
        StoredArtifact {
            artifact_id: id.into(),
            job_id: self.job_id.clone(),
            artifact_name: name,
            created_at: date.into(),
            checksum: sha256(&path).unwrap(),
            size: payload.len() as u64,
            destinations: vec![path],
        }
    }

    fn path(&self, id: &str) -> PathBuf {
        self.repository.path(&self.job_id, id).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn latest_orders_by_instant_then_uuid_and_explicit_selection_keeps_identity() {
    let fixture = Fixture::new();
    let low = "00000000-0000-4000-8000-000000000001";
    let high = "00000000-0000-4000-8000-000000000002";
    let a = fixture.artifact(low, "2026-10-16T10:00:00.000Z", b"first");
    let b = fixture.artifact(high, "2026-10-16T10:00:00+00:00", b"second");
    fixture.repository.create(&b).unwrap();
    fixture.repository.create(&a).unwrap();
    assert_eq!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .unwrap()
            .artifact_id,
        high
    );
    assert_eq!(
        fixture
            .repository
            .resolve(&fixture.job_id, low)
            .unwrap()
            .checksum,
        a.checksum
    );
    let mut newer = a.clone();
    // A later instant beats a higher ID; rebuild a fresh catalog for this case.
    fs::remove_file(fixture.path(low)).unwrap();
    newer.created_at = "2026-10-16T10:00:01Z".into();
    fixture.repository.create(&newer).unwrap();
    assert_eq!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .unwrap()
            .artifact_id,
        low
    );
}

#[test]
fn resolves_only_registered_versions_and_never_falls_back_to_older_artifacts() {
    let fixture = Fixture::new();
    let old = fixture.artifact(&Uuid::new_v4().to_string(), "2026-10-15T10:00:00Z", b"old");
    let new = fixture.artifact(&Uuid::new_v4().to_string(), "2026-10-16T10:00:00Z", b"new");
    // Existing backup files alone are not a catalog.
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
    fixture.repository.create(&old).unwrap();
    fixture.repository.create(&new).unwrap();
    fs::remove_file(&new.destinations[0]).unwrap();
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
    assert_eq!(
        fixture
            .repository
            .resolve(&fixture.job_id, &old.artifact_id)
            .unwrap()
            .artifact_id,
        old.artifact_id
    );
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, &Uuid::new_v4().to_string())
            .is_err()
    );
    fs::write(
        fixture
            .root
            .join("artifacts")
            .join(&fixture.job_id)
            .join("ignored.tmp"),
        b"partial",
    )
    .unwrap();
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
}

#[test]
fn tries_replicas_in_registered_order_and_verifies_size_checksum_and_file_type() {
    let fixture = Fixture::new();
    let mut artifact = fixture.artifact(
        &Uuid::new_v4().to_string(),
        "2026-10-16T10:00:00Z",
        b"payload",
    );
    let good = artifact.destinations[0].clone();
    let mut destinations = Vec::new();
    for (name, content) in [
        ("wrong-size", b"short".as_slice()),
        ("wrong-checksum", b"PAYLOAD".as_slice()),
    ] {
        let parent = fixture.root.join(name);
        fs::create_dir(&parent).unwrap();
        let path = parent.join(&artifact.artifact_name);
        fs::write(&path, content).unwrap();
        destinations.push(path);
    }
    let directory = fixture.root.join("directory").join(&artifact.artifact_name);
    fs::create_dir_all(&directory).unwrap();
    destinations.push(directory);
    destinations.push(fixture.root.join("absent").join(&artifact.artifact_name));
    destinations.push(good.clone());
    artifact.destinations = destinations;
    fixture.repository.create(&artifact).unwrap();
    let resolved = fixture
        .repository
        .resolve(&fixture.job_id, "latest")
        .unwrap();
    assert_eq!(resolved.path, good);
    assert_eq!(resolved.size, 7);
    fs::remove_file(&good).unwrap();
    let error = fixture
        .repository
        .resolve(&fixture.job_id, "latest")
        .unwrap_err()
        .to_string();
    assert!(error.contains("size"));
    assert!(error.contains("checksum"));
    assert!(error.contains("regular file"));
}

#[test]
fn rejects_corrupt_metadata_and_mismatched_catalog_identity() {
    let fixture = Fixture::new();
    let artifact = fixture.artifact(
        &Uuid::new_v4().to_string(),
        "2026-10-16T10:00:00Z",
        b"payload",
    );
    fixture.repository.create(&artifact).unwrap();
    let path = fixture.path(&artifact.artifact_id);
    for (field, invalid_value) in [
        ("job_id", serde_json::json!(Uuid::new_v4().to_string())),
        ("artifact_id", serde_json::json!(Uuid::new_v4().to_string())),
        ("artifact_name", serde_json::json!("../escape.tar.zst")),
        ("created_at", serde_json::json!("not a date")),
        ("created_at", serde_json::json!("2026-10-16T10:00:00+02:00")),
        ("checksum", serde_json::json!("invalid")),
        ("size", serde_json::json!(0)),
        ("destinations", serde_json::json!([])),
        ("destinations", serde_json::json!(["relative.tar.zst"])),
    ] {
        let mut malformed = serde_json::to_value(&artifact).unwrap();
        malformed[field] = invalid_value;
        fs::write(&path, serde_json::to_vec(&malformed).unwrap()).unwrap();
        assert!(
            fixture
                .repository
                .resolve(&fixture.job_id, &artifact.artifact_id)
                .is_err()
        );
    }
    fs::write(&path, "{broken").unwrap();
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
}

#[test]
fn explicit_selection_ignores_other_corrupt_records_and_queries_do_not_create_directories() {
    let fixture = Fixture::new();
    let absent = fixture.root.join("not-created");
    assert!(
        ArtifactRepository::new(&absent)
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
    assert!(!absent.exists());
    for version in ["../outside", "", "/absolute"] {
        assert!(
            fixture
                .repository
                .resolve(&fixture.job_id, version)
                .is_err()
        );
    }
    assert!(fixture.repository.resolve("../job", "latest").is_err());
    let artifact = fixture.artifact(
        &Uuid::new_v4().to_string(),
        "2026-10-16T10:00:00Z",
        b"payload",
    );
    fixture.repository.create(&artifact).unwrap();
    fs::write(fixture.path(&Uuid::new_v4().to_string()), "broken").unwrap();
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, &artifact.artifact_id)
            .is_ok()
    );
    assert!(
        fixture
            .repository
            .resolve(&fixture.job_id, "latest")
            .is_err()
    );
}

#[test]
fn registration_is_immutable_even_under_concurrent_uuid_collisions() {
    let fixture = Fixture::new();
    let artifact = fixture.artifact(
        &Uuid::new_v4().to_string(),
        "2026-10-16T10:00:00Z",
        b"payload",
    );
    let mut other = artifact.clone();
    other.created_at = "2026-10-16T11:00:00Z".into();
    let barrier = std::sync::Barrier::new(2);
    let outcomes = std::thread::scope(|scope| {
        let handles: Vec<_> = [&artifact, &other]
            .into_iter()
            .map(|record| {
                let barrier = &barrier;
                let repository = &fixture.repository;
                scope.spawn(move || {
                    barrier.wait();
                    repository.create(record)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
    let original = fs::read(fixture.path(&artifact.artifact_id)).unwrap();
    assert!(fixture.repository.create(&other).is_err());
    assert_eq!(
        fs::read(fixture.path(&artifact.artifact_id)).unwrap(),
        original
    );
    assert_eq!(
        fs::read_dir(fixture.root.join("artifacts").join(&fixture.job_id))
            .unwrap()
            .count(),
        1
    );
    fs::write(fixture.path(&artifact.artifact_id), "corrupt").unwrap();
    assert!(fixture.repository.create(&artifact).is_err());
    assert_eq!(
        fs::read_to_string(fixture.path(&artifact.artifact_id)).unwrap(),
        "corrupt"
    );
}
