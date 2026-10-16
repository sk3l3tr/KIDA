use super::*;
use std::os::unix::fs::symlink;
use uuid::Uuid;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("kida-restore-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("sentinel"), b"original").unwrap();
        Self(root)
    }

    fn artifact(&self, raw_tar: &[u8]) -> ResolvedBackupArtifact {
        let path = self.0.join("backup.tar.zst");
        fs::write(&path, zstd::stream::encode_all(raw_tar, 0).unwrap()).unwrap();
        self.describe(path)
    }

    fn describe(&self, path: PathBuf) -> ResolvedBackupArtifact {
        ResolvedBackupArtifact {
            artifact_id: Uuid::new_v4().to_string(),
            job_id: Uuid::new_v4().to_string(),
            artifact_name: "backup.tar.zst".into(),
            created_at: "2026-10-16T12:00:00Z".into(),
            checksum: crate::features::backup::artifacts::sha256(&path).unwrap(),
            size: fs::metadata(&path).unwrap().len(),
            path,
        }
    }

    fn destination(&self) -> PathBuf {
        self.0.join("run")
    }

    fn assert_sentinel(&self) {
        assert_eq!(fs::read(self.0.join("sentinel")).unwrap(), b"original");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Tests may restore deliberately restrictive modes.
        fn writable(path: &Path) {
            for entry in fs::read_dir(path).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    fs::set_permissions(entry.path(), Permissions::from_mode(0o700)).unwrap();
                    writable(&entry.path());
                }
            }
        }
        writable(&self.0);
        fs::remove_dir_all(&self.0).unwrap();
    }
}

// Write raw names so the test can exercise paths tar::Builder normally rejects.
fn archive(entries: &[(&str, tar::EntryType, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (name, kind, body) in entries {
        let mut header = tar::Header::new_gnu();
        header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
        header.set_entry_type(*kind);
        header.set_mode(0o6750);
        header.set_size(body.len() as u64);
        if kind.is_hard_link() || kind.is_symlink() {
            header.set_link_name("../sentinel").unwrap();
        }
        header.set_cksum();
        builder.append(&header, *body).unwrap();
    }
    builder.into_inner().unwrap()
}

#[test]
fn restores_nested_files_modes_and_directory_provenance() {
    let fixture = Fixture::new();
    let bytes = archive(&[
        ("data", tar::EntryType::Directory, b""),
        ("data/file", tar::EntryType::Regular, b"restored"),
        ("empty", tar::EntryType::Regular, b""),
    ]);
    let artifact = fixture.artifact(&bytes);
    let restored = restore(&artifact, &fixture.destination()).unwrap();
    assert_eq!(restored.path, fixture.destination());
    let metadata = fs::symlink_metadata(&restored.path).unwrap();
    let identity = restored.identity.unwrap();
    assert_eq!(
        (identity.device, identity.inode),
        (metadata.dev(), metadata.ino())
    );
    assert_eq!(
        fs::read(restored.path.join("data/file")).unwrap(),
        b"restored"
    );
    assert_eq!(fs::metadata(restored.path.join("empty")).unwrap().len(), 0);
    assert_eq!(
        fs::metadata(restored.path.join("data/file"))
            .unwrap()
            .mode()
            & 0o7777,
        0o750
    );
    assert_eq!(
        fs::metadata(restored.path.join("data")).unwrap().mode() & 0o7777,
        0o750
    );
    fixture.assert_sentinel();
}

#[test]
fn checksum_size_and_non_regular_sources_fail_before_creating_destination() {
    let fixture = Fixture::new();
    let artifact = fixture.artifact(&archive(&[("data", tar::EntryType::Regular, b"data")]));
    let mut bad = artifact.clone();
    bad.checksum = "0".repeat(64);
    assert!(
        restore(&bad, &fixture.destination())
            .unwrap_err()
            .partial
            .is_none()
    );
    bad = artifact.clone();
    bad.size += 1;
    assert!(
        restore(&bad, &fixture.destination())
            .unwrap_err()
            .partial
            .is_none()
    );
    let link = fixture.0.join("link");
    symlink(&artifact.path, &link).unwrap();
    bad.path = link;
    assert!(
        restore(&bad, &fixture.destination())
            .unwrap_err()
            .partial
            .is_none()
    );
    bad.path = fixture.0.clone();
    assert!(
        restore(&bad, &fixture.destination())
            .unwrap_err()
            .partial
            .is_none()
    );
    assert!(!fixture.destination().exists());
    fixture.assert_sentinel();
}

#[test]
fn preserves_existing_destinations_including_dangling_symlinks() {
    for kind in ["directory", "file", "symlink", "dangling"] {
        let fixture = Fixture::new();
        let artifact = fixture.artifact(&archive(&[("data", tar::EntryType::Regular, b"data")]));
        let destination = fixture.destination();
        match kind {
            "directory" => fs::create_dir(&destination).unwrap(),
            "file" => fs::write(&destination, b"original").unwrap(),
            "symlink" => symlink(fixture.0.join("sentinel"), &destination).unwrap(),
            _ => symlink(fixture.0.join("absent"), &destination).unwrap(),
        }
        assert!(
            restore(&artifact, &destination)
                .unwrap_err()
                .partial
                .is_none()
        );
        assert!(fs::symlink_metadata(&destination).is_ok());
        if kind == "file" {
            assert_eq!(fs::read(&destination).unwrap(), b"original");
        }
        if kind == "directory" {
            assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        }
        assert!(!fixture.0.join("absent").exists());
        fixture.assert_sentinel();
    }
}

#[test]
fn rejects_absolute_traversal_links_and_special_entries_preserving_partial_evidence() {
    for (name, kind) in [
        ("../sentinel", tar::EntryType::Regular),
        ("data/../../sentinel", tar::EntryType::Regular),
        ("/sentinel", tar::EntryType::Regular),
        ("alias", tar::EntryType::Symlink),
        ("alias", tar::EntryType::Link),
        ("device", tar::EntryType::Char),
        ("device", tar::EntryType::Block),
        ("pipe", tar::EntryType::Fifo),
        ("sparse", tar::EntryType::GNUSparse),
    ] {
        let fixture = Fixture::new();
        let bytes = archive(&[
            ("first", tar::EntryType::Regular, b"partial"),
            (name, kind, b""),
        ]);
        let error = restore(&fixture.artifact(&bytes), &fixture.destination()).unwrap_err();
        let partial = error.partial.unwrap();
        assert_eq!(partial.path, fixture.destination());
        assert!(partial.identity.is_some());
        assert_eq!(fs::read(partial.path.join("first")).unwrap(), b"partial");
        assert_eq!(fs::read_dir(&partial.path).unwrap().count(), 1);
        fixture.assert_sentinel();
    }
}

#[test]
fn absolute_paths_targeting_an_actual_external_sentinel_are_rejected() {
    let fixture = Fixture::new();
    let sentinel = fixture.0.join("sentinel");
    let bytes = archive(&[(
        sentinel.to_str().unwrap(),
        tar::EntryType::Regular,
        b"overwrite",
    )]);
    assert!(restore(&fixture.artifact(&bytes), &fixture.destination()).is_err());
    fixture.assert_sentinel();
}

#[test]
fn duplicate_files_do_not_overwrite_previously_extracted_data() {
    let fixture = Fixture::new();
    let bytes = archive(&[
        ("file", tar::EntryType::Regular, b"first"),
        ("file", tar::EntryType::Regular, b"second"),
    ]);
    let error = restore(&fixture.artifact(&bytes), &fixture.destination()).unwrap_err();
    assert!(error.partial.is_some());
    assert_eq!(
        fs::read(fixture.destination().join("file")).unwrap(),
        b"first"
    );
    fixture.assert_sentinel();
}

#[test]
fn truncated_zstd_frames_and_tar_bodies_fail_even_with_matching_metadata() {
    let fixture = Fixture::new();
    let bytes = archive(&[("file", tar::EntryType::Regular, b"partial")]);
    let artifact = fixture.artifact(&bytes);
    let mut compressed = fs::read(&artifact.path).unwrap();
    compressed.pop();
    fs::write(&artifact.path, compressed).unwrap();
    let truncated = fixture.describe(artifact.path);
    assert!(
        restore(&truncated, &fixture.destination())
            .unwrap_err()
            .partial
            .is_some()
    );
    let tar_truncated = fixture.artifact(&bytes[..515]);
    assert!(
        restore(&tar_truncated, &fixture.0.join("second"))
            .unwrap_err()
            .partial
            .is_some()
    );
    fixture.assert_sentinel();
}

#[test]
fn reads_verified_descriptor_even_if_source_path_is_replaced() {
    let fixture = Fixture::new();
    let artifact = fixture.artifact(&archive(&[("file", tar::EntryType::Regular, b"verified")]));
    let input = open_verified(&artifact).unwrap();
    fs::rename(&artifact.path, fixture.0.join("original.tar.zst")).unwrap();
    fixture.artifact(&archive(&[(
        "../sentinel",
        tar::EntryType::Regular,
        b"other",
    )]));
    fs::create_dir(fixture.destination()).unwrap();
    extract(input, &fixture.destination()).unwrap();
    assert_eq!(
        fs::read(fixture.destination().join("file")).unwrap(),
        b"verified"
    );
    fixture.assert_sentinel();
}

#[test]
fn concurrent_restores_only_one_can_reserve_the_run_directory() {
    let fixture = Fixture::new();
    let artifact = fixture.artifact(&archive(&[("file", tar::EntryType::Regular, b"data")]));
    let destination = fixture.destination();
    let results = std::thread::scope(|scope| {
        let a = scope.spawn(|| restore(&artifact, &destination));
        let b = scope.spawn(|| restore(&artifact, &destination));
        [a.join().unwrap(), b.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(
        results
            .into_iter()
            .find_map(Result::err)
            .unwrap()
            .partial
            .is_none()
    );
    assert_eq!(fs::read(destination.join("file")).unwrap(), b"data");
    fixture.assert_sentinel();
}

#[test]
fn validates_destination_and_rejects_non_padding_after_tar_terminator() {
    let fixture = Fixture::new();
    let mut bytes = archive(&[("file", tar::EntryType::Regular, b"data")]);
    bytes.extend_from_slice(b"unexpected");
    let artifact = fixture.artifact(&bytes);
    for path in [
        PathBuf::from("relative"),
        fixture.0.join("../run"),
        PathBuf::from("/"),
    ] {
        assert!(restore(&artifact, &path).unwrap_err().partial.is_none());
    }
    assert!(
        restore(&artifact, &fixture.destination())
            .unwrap_err()
            .partial
            .is_some()
    );
    fixture.assert_sentinel();
}

#[test]
fn validates_effective_gnu_long_paths_after_tar_decodes_them() {
    let fixture = Fixture::new();
    let long = format!("data/{}/file", "nested/".repeat(25));
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_mode(0o644);
    header.set_size(4);
    builder
        .append_data(&mut header, &long, &b"data"[..])
        .unwrap();
    let valid = fixture.artifact(&builder.into_inner().unwrap());
    restore(&valid, &fixture.destination()).unwrap();
    assert_eq!(fs::read(fixture.destination().join(long)).unwrap(), b"data");

    // A GNU extension can replace an otherwise harmless following header path.
    let effective = format!("{}\0", fixture.0.join("sentinel").display());
    let hostile = archive(&[
        (
            "././@LongLink",
            tar::EntryType::GNULongName,
            effective.as_bytes(),
        ),
        ("harmless", tar::EntryType::Regular, b"overwrite"),
    ]);
    assert!(restore(&fixture.artifact(&hostile), &fixture.0.join("second")).is_err());
    fixture.assert_sentinel();
}
