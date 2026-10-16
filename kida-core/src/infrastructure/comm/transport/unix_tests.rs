use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

use super::*;

struct Endpoint {
    directory: PathBuf,
    path: PathBuf,
}

impl Endpoint {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("kida-unix-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        Self {
            path: directory.join("server.sock"),
            directory,
        }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&self.directory).unwrap();
    }
}

async fn assert_reachable(listener: &UnixListener, path: &Path) {
    let mut client = UnixStream::connect(path).await.unwrap();
    let (mut server, _) = listener.accept().await.unwrap();
    client.write_all(b"still alive").await.unwrap();
    let mut bytes = [0; 11];
    tokio::io::AsyncReadExt::read_exact(&mut server, &mut bytes)
        .await
        .unwrap();
    assert_eq!(&bytes, b"still alive");
}

#[tokio::test]
async fn absent_and_stale_socket_are_bound_and_lock_is_released() {
    let endpoint = Endpoint::new();
    let bound = bind(&endpoint.path).await.unwrap();
    assert_reachable(&bound.0, &endpoint.path).await;
    drop(bound);
    assert!(
        fs::symlink_metadata(&endpoint.path)
            .unwrap()
            .file_type()
            .is_socket()
    );
    let rebound = bind(&endpoint.path).await.unwrap();
    assert_reachable(&rebound.0, &endpoint.path).await;
}

#[tokio::test]
async fn active_socket_without_reservation_is_preserved() {
    let endpoint = Endpoint::new();
    let listener = UnixListener::bind(&endpoint.path).unwrap();
    let original = fs::symlink_metadata(&endpoint.path).unwrap().ino();
    assert_eq!(
        bind(&endpoint.path).await.unwrap_err().kind(),
        ErrorKind::AddrInUse
    );
    // Drain the connection made by the activity probe.
    drop(listener.accept().await.unwrap());
    assert_eq!(
        fs::symlink_metadata(&endpoint.path).unwrap().ino(),
        original
    );
    assert_reachable(&listener, &endpoint.path).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_starters_keep_exactly_one_listener() {
    let endpoint = Endpoint::new();
    drop(UnixListener::bind(&endpoint.path).unwrap());
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let start = || {
        let path = endpoint.path.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            bind(&path).await
        })
    };
    let (first, second) = tokio::join!(start(), start());
    let (first, second) = (first.unwrap(), second.unwrap());
    let winner = match (first, second) {
        (Ok(winner), Err(error)) | (Err(error), Ok(winner)) => {
            assert_eq!(error.kind(), ErrorKind::AddrInUse);
            winner
        }
        results => panic!("Expected exactly one listener: {results:?}"),
    };
    assert_eq!(
        bind(&endpoint.path).await.unwrap_err().kind(),
        ErrorKind::AddrInUse
    );
    assert_reachable(&winner.0, &endpoint.path).await;
}

#[tokio::test]
async fn files_directories_and_symlinks_are_preserved() {
    for kind in ["file", "directory", "symlink", "dangling_symlink"] {
        let endpoint = Endpoint::new();
        let target = endpoint.directory.join("target");
        fs::write(&target, "valuable data").unwrap();
        match kind {
            "file" => fs::write(&endpoint.path, "original file").unwrap(),
            "directory" => fs::create_dir(&endpoint.path).unwrap(),
            "symlink" => std::os::unix::fs::symlink(&target, &endpoint.path).unwrap(),
            _ => std::os::unix::fs::symlink(endpoint.directory.join("missing"), &endpoint.path)
                .unwrap(),
        }
        let original = fs::symlink_metadata(&endpoint.path).unwrap();
        assert_eq!(
            bind(&endpoint.path).await.unwrap_err().kind(),
            ErrorKind::AlreadyExists
        );
        let current = fs::symlink_metadata(&endpoint.path).unwrap();
        assert_eq!(current.ino(), original.ino());
        assert_eq!(current.file_type(), original.file_type());
        assert_eq!(fs::read_to_string(target).unwrap(), "valuable data");
        if kind == "file" {
            assert_eq!(fs::read_to_string(&endpoint.path).unwrap(), "original file");
        }
    }
}

#[tokio::test]
async fn lock_symlink_is_rejected_without_touching_target() {
    let endpoint = Endpoint::new();
    let target = endpoint.directory.join("target");
    fs::write(&target, "valuable data").unwrap();
    std::os::unix::fs::symlink(&target, endpoint.path.with_extension("sock.lock")).unwrap();
    assert!(bind(&endpoint.path).await.is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "valuable data");
    assert!(!endpoint.path.exists());
}

#[tokio::test]
async fn permission_errors_preserve_stale_socket() {
    // Root bypasses mode bits; run the same assertions in an unprivileged child.
    if unsafe { libc::geteuid() } == 0 {
        use std::os::unix::process::CommandExt;
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "infrastructure::comm::transport::unix::tests::permission_errors_preserve_stale_socket", "--nocapture"])
            .uid(65534)
            .gid(65534)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        return;
    }
    let endpoint = Endpoint::new();
    drop(bind(&endpoint.path).await.unwrap());
    let original = fs::symlink_metadata(&endpoint.path).unwrap().ino();
    fs::set_permissions(&endpoint.path, fs::Permissions::from_mode(0o000)).unwrap();
    assert_eq!(
        bind(&endpoint.path).await.unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::symlink_metadata(&endpoint.path).unwrap().ino(),
        original
    );
    fs::set_permissions(&endpoint.path, fs::Permissions::from_mode(0o600)).unwrap();
    fs::set_permissions(&endpoint.directory, fs::Permissions::from_mode(0o500)).unwrap();
    assert_eq!(
        bind(&endpoint.path).await.unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::symlink_metadata(&endpoint.path).unwrap().ino(),
        original
    );
}
