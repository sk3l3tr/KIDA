//! Internal Compose lifecycle. All daemon access uses the caller's Docker context.
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::{Instant, timeout_at},
};

use super::{DockerService, repository};

const STDOUT_LIMIT: usize = 8 * 1024 * 1024;
const STDERR_LIMIT: usize = 64 * 1024;

const PROJECT: &str = "com.docker.compose.project";
const FILES: &str = "com.docker.compose.project.config_files";
const DIRECTORY: &str = "com.docker.compose.project.working_dir";

/// One local Compose input, explicit project and child-only interpolation variables.
#[derive(Debug, Clone)]
pub struct ComposeOptions {
    pub project: String,
    pub file: PathBuf,
    pub variables: BTreeMap<String, String>,
    /// Budget for starting and continuing work, including locks and checks.
    /// Started disk I/O finishes safely even after expiry; response time is not strictly bounded.
    pub timeout: Duration,
}

impl ComposeOptions {
    pub fn new(project: impl Into<String>, file: impl Into<PathBuf>) -> Self {
        Self {
            project: project.into(),
            file: file.into(),
            variables: BTreeMap::new(),
            timeout: Duration::from_secs(300),
        }
    }
}

impl DockerService {
    /// Create stopped containers, rejecting existing project resources and occupied names.
    pub async fn compose_create(options: &ComposeOptions) -> Result<(), String> {
        lifecycle(options, "create").await
    }

    /// Start existing containers whose native Compose provenance matches this input.
    /// Does not wait for health checks.
    pub async fn compose_start(options: &ComposeOptions) -> Result<(), String> {
        lifecycle(options, "start").await
    }

    /// Stop existing containers without removing containers, networks or volumes.
    pub async fn compose_stop(options: &ComposeOptions) -> Result<(), String> {
        lifecycle(options, "stop").await
    }
}

type ProjectLocks = Mutex<BTreeMap<String, Weak<tokio::sync::Mutex<()>>>>;
pub(super) fn project_lock(project: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<ProjectLocks> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(project).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(project.to_owned(), Arc::downgrade(&lock));
    lock
}

fn input_error(message: impl std::fmt::Display) -> String {
    format!("Compose input error: {message}")
}
fn timeout_error() -> String {
    "Compose timeout: operation deadline exceeded".into()
}

async fn lifecycle(options: &ComposeOptions, action: &str) -> Result<(), String> {
    let entered = Instant::now();
    DockerService::validate_compose_project_name(&options.project).map_err(input_error)?;
    for (key, value) in &options.variables {
        let valid = !key.is_empty()
            && key.bytes().enumerate().all(|(i, b)| {
                b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit())
            });
        if !valid
            || value.contains('\0')
            || matches!(key.as_str(), "PATH" | "HOME" | "XDG_CONFIG_HOME")
            || ["DOCKER_", "COMPOSE_", "LD_", "DYLD_"]
                .iter()
                .any(|prefix| key.starts_with(prefix))
        {
            return Err(input_error(format!(
                "invalid or reserved environment variable {key:?}"
            )));
        }
    }
    if options.timeout.is_zero() {
        return Err(input_error("timeout must be positive"));
    }
    let deadline = entered
        .checked_add(options.timeout)
        .ok_or_else(|| input_error("timeout is too large"))?;
    repository::check_deadline(deadline)?;
    let lock = project_lock(&options.project);
    let guard = Arc::new(
        timeout_at(deadline, lock.lock_owned())
            .await
            .map_err(|_| timeout_error())?,
    );
    let file = repository::input_file(options.file.clone(), deadline, &guard).await?;
    // Compose stores file lists as comma-separated labels, with no escaping.
    let file_text = file
        .to_str()
        .filter(|s| !s.contains(','))
        .ok_or_else(|| input_error("Compose file path must be UTF-8 and contain no comma"))?;
    let directory = file
        .parent()
        .ok_or_else(|| input_error("Compose file has no parent"))?;
    let directory_text = directory
        .to_str()
        .ok_or_else(|| input_error("project directory must be UTF-8"))?;
    let runner = Runner { options, deadline };
    let mut compose: Vec<OsString> = [
        "compose",
        "--project-name",
        &options.project,
        "--file",
        file_text,
        "--project-directory",
        directory_text,
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    let project = options.project.clone();
    let mut managed =
        repository::disk(deadline, &guard, move || repository::active(&project)).await?;
    if action == "create" && managed.is_some() {
        return Err("Compose conflict: project has a pending or active ownership record".into());
    }
    let mut provenance = file_text.to_owned();
    if let Some(record) = &managed {
        let copy = record.clone();
        let input = file.clone();
        repository::disk(deadline, &guard, move || copy.check_files(&input)).await?;
        compose.extend([
            OsString::from("--file"),
            record.overlay.clone().into_os_string(),
        ]);
        provenance = record.files();
    }
    if action == "stop" {
        check_provenance(&runner, &provenance, directory_text).await?;
    } else {
        let mut config_args = compose.clone();
        config_args.extend(["config", "--format", "json"].map(Into::into));
        let document: Value = runner.json(&config_args).await.map_err(|error| {
            if error.starts_with("Compose command failed (") {
                input_error(error)
            } else {
                error
            }
        })?;
        if action == "create" {
            super::ownership::reject_reserved_labels(&document)?;
        }
        let model: Resolved = serde_json::from_value(document)
            .map_err(|error| format!("Compose invalid output: {error}"))?;
        if model.services.is_empty() {
            return Err("Compose invalid output: resolved document has no services".into());
        }
        if action == "create" {
            check_create(&runner, &model).await?;
        } else {
            check_provenance(&runner, &provenance, directory_text).await?;
        }
        check_resources(&runner, &model, action == "create").await?;
        if action == "create" {
            let record = repository::reserve_async(
                options.project.clone(),
                super::ownership::daemon(&runner).await?,
                model,
                file.clone(),
                deadline,
                &guard,
            )
            .await?;
            compose.extend([
                OsString::from("--file"),
                record.overlay.clone().into_os_string(),
            ]);
            managed = Some(record);
        }
    }
    compose.push(action.into());
    if action == "create" {
        compose.push("--no-recreate".into());
    }
    if action != "create" {
        if let Some(record) = &managed {
            super::ownership::validate(&runner, record, false).await?;
        }
    }
    let result = Box::pin(runner.run(&compose, false)).await;
    if action == "create" {
        let record = managed.as_mut().unwrap();
        let captured = super::ownership::capture(&runner, record, &guard).await;
        if let Err(error) = result {
            return Err(format!(
                "{error}; resources may be partial; ownership remains pending; capture: {captured:?}"
            ));
        }
        captured?;
        record.pending = false;
        repository::save(record, deadline, &guard).await?;
    } else {
        result?;
    }
    Ok(())
}

// Decode Compose's resolved JSON contract, not the source Compose document.
#[derive(Deserialize)]
pub(super) struct Resolved {
    pub(super) services: BTreeMap<String, Service>,
    #[serde(default)]
    pub(super) networks: BTreeMap<String, Resource>,
    #[serde(default)]
    pub(super) volumes: BTreeMap<String, Resource>,
}
#[derive(Deserialize)]
pub(super) struct Service {
    #[serde(default)]
    pub(super) labels: BTreeMap<String, String>,
    container_name: Option<String>,
    #[serde(default)]
    profiles: Vec<String>,
}
#[derive(Deserialize)]
pub(super) struct Resource {
    #[serde(default)]
    pub(super) labels: BTreeMap<String, String>,
    pub(super) name: String,
    #[serde(default)]
    pub(super) external: bool,
}

async fn check_create(runner: &Runner<'_>, model: &Resolved) -> Result<(), String> {
    let filter = format!("label={PROJECT}={}", runner.options.project);
    for args in [
        vec!["ps", "-aq", "--filter", &filter],
        vec!["network", "ls", "-q", "--filter", &filter],
        vec!["volume", "ls", "-q", "--filter", &filter],
    ] {
        if !runner.text(&args).await?.trim().is_empty() {
            return Err(format!(
                "Compose conflict: project '{}' already has resources",
                runner.options.project
            ));
        }
    }
    let names = runner.text(&["ps", "-a", "--format", "{{.Names}}"]).await?;
    for service in model.services.values().filter(|s| s.profiles.is_empty()) {
        if let Some(name) = &service.container_name {
            if names.lines().any(|existing| existing == name) {
                return Err(format!(
                    "Compose conflict: container name '{name}' is occupied"
                ));
            }
        }
    }
    Ok(())
}

async fn check_resources(
    runner: &Runner<'_>,
    model: &Resolved,
    creating: bool,
) -> Result<(), String> {
    for (kind, resources) in [("network", &model.networks), ("volume", &model.volumes)] {
        if !creating && !resources.values().any(|r| r.external) {
            continue;
        }
        let names = runner.text(&[kind, "ls", "--format", "{{.Name}}"]).await?;
        for resource in resources.values().filter(|r| creating || r.external) {
            let exists = names.lines().any(|name| name == resource.name);
            if exists != resource.external {
                return Err(format!(
                    "Compose conflict: {kind} '{}' {}",
                    resource.name,
                    if resource.external {
                        "is external but missing"
                    } else {
                        "is occupied"
                    }
                ));
            }
        }
    }
    Ok(())
}

async fn check_provenance(runner: &Runner<'_>, file: &str, directory: &str) -> Result<(), String> {
    let filter = format!("label={PROJECT}={}", runner.options.project);
    let ids = runner
        .text(&["ps", "-aq", "--no-trunc", "--filter", &filter])
        .await?;
    let ids: Vec<_> = ids.lines().filter(|id| !id.is_empty()).collect();
    if ids.is_empty() {
        return Err("Compose conflict: project has no containers".into());
    }
    let mut args: Vec<OsString> = vec!["inspect".into()];
    args.extend(ids.iter().map(OsString::from));
    let containers: Vec<Value> = runner.json(&args).await?;
    if containers.len() != ids.len() {
        return Err("Compose invalid output: incomplete container inspection".into());
    }
    for (id, container) in ids.iter().zip(&containers) {
        if container["Id"].as_str() != Some(*id) {
            return Err("Compose invalid output: container inspection ID mismatch".into());
        }
        let labels = &container["Config"]["Labels"];
        if labels[PROJECT].as_str() != Some(&runner.options.project)
            || labels[FILES].as_str() != Some(file)
            || labels[DIRECTORY].as_str() != Some(directory)
        {
            return Err("Compose conflict: missing, ambiguous or mismatched container provenance (project/config_files/working_dir); exactly one matching file is required".into());
        }
    }
    Ok(())
}

pub(super) struct Runner<'a> {
    pub(super) options: &'a ComposeOptions,
    pub(super) deadline: Instant,
}
impl Runner<'_> {
    pub(super) async fn text(&self, args: &[&str]) -> Result<String, String> {
        let arguments = args.iter().map(OsString::from).collect::<Vec<_>>();
        let bytes = Box::pin(self.run(&arguments, true)).await?;
        String::from_utf8(bytes).map_err(|e| format!("Compose invalid output: {e}"))
    }
    pub(super) async fn json<T: serde::de::DeserializeOwned>(
        &self,
        args: &[OsString],
    ) -> Result<T, String> {
        serde_json::from_slice(&Box::pin(self.run(args, true)).await?)
            .map_err(|e| format!("Compose invalid output: {e}"))
    }
    pub(super) async fn run(
        &self,
        args: &[OsString],
        capture_stdout: bool,
    ) -> Result<Vec<u8>, String> {
        if Instant::now() >= self.deadline {
            return Err(timeout_error());
        }
        let mut command = Command::new("docker");
        command
            .args(args)
            .envs(&self.options.variables)
            // Explicitly keep default profiles and prevent ambient automatic orphan removal.
            .env("COMPOSE_PROFILES", "")
            .env("COMPOSE_REMOVE_ORPHANS", "false")
            .stdin(Stdio::null())
            .stdout(if capture_stdout {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("Compose unavailable: Docker executable missing: {e}")
            } else {
                format!("Compose command failed: cannot execute Docker: {e}")
            }
        })?;
        let _group = ProcessGroup(child.id());
        let stdout = child.stdout.take();
        let stderr = child.stderr.take().unwrap();
        let result = timeout_at(self.deadline, async {
            tokio::try_join!(
                child.wait(),
                async {
                    match stdout {
                        Some(stdout) => read_capped(stdout, STDOUT_LIMIT, true).await,
                        None => Ok((Vec::new(), false)),
                    }
                },
                read_capped(stderr, STDERR_LIMIT, false)
            )
        })
        .await;
        let (status, (out, _), (err, truncated)) = match result {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => {
                _group.kill();
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(if e.kind() == std::io::ErrorKind::InvalidData {
                    format!("Compose invalid output: {e}")
                } else {
                    format!("Compose command failed: process I/O: {e}")
                });
            }
            Err(_) => {
                _group.kill();
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(timeout_error());
            }
        };
        if !status.success() {
            let mut detail = String::from_utf8_lossy(&err).into_owned();
            if truncated {
                detail.push_str("\n[stderr truncated]");
            }
            let lower = detail.to_ascii_lowercase();
            let category = if lower.contains("is not a docker command")
                || lower.contains("unknown command")
                || lower.contains("plugin") && lower.contains("not found")
            {
                "unavailable: Compose plugin missing"
            } else if lower.contains("cannot connect")
                || lower.contains("daemon unavailable")
                || lower.contains("connection refused")
                || lower.contains("permission denied")
            {
                "daemon inaccessible"
            } else {
                "command failed"
            };
            return Err(format!("Compose {category} ({status}): {}", detail.trim()));
        }
        repository::check_deadline(self.deadline)?;
        Ok(out)
    }
}

// Queries fail on overflow; diagnostics keep draining after their prefix is full.
async fn read_capped(
    mut reader: impl AsyncRead + Unpin,
    limit: usize,
    fail_on_overflow: bool,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    let mut block = [0; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut block).await?;
        if count == 0 {
            return Ok((bytes, truncated));
        }
        let keep = count.min(limit - bytes.len());
        bytes.extend_from_slice(&block[..keep]);
        if keep < count {
            if fail_on_overflow {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("stdout exceeds {limit} byte limit"),
                ));
            }
            truncated = true;
        }
    }
}

// Also kill the plugin's process group if the operation future is cancelled.
struct ProcessGroup(Option<u32>);
impl ProcessGroup {
    fn kill(&self) {
        #[cfg(unix)]
        if let Some(pid) = self.0 {
            // SAFETY: this is the private process group created for our Docker child.
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod capture_tests {
    use super::{STDERR_LIMIT, STDOUT_LIMIT, read_capped};

    #[tokio::test]
    async fn query_output_accepts_limit_and_rejects_one_extra_byte() {
        let data = vec![b'x'; STDOUT_LIMIT + 1];
        let (bytes, truncated) = read_capped(&data[..STDOUT_LIMIT], STDOUT_LIMIT, true)
            .await
            .unwrap();
        assert_eq!(bytes.len(), STDOUT_LIMIT);
        assert!(!truncated);
        let error = read_capped(data.as_slice(), STDOUT_LIMIT, true)
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn diagnostic_output_drains_beyond_the_retained_prefix() {
        for size in [STDERR_LIMIT, STDERR_LIMIT + 1, STDERR_LIMIT * 3] {
            let data = vec![b'x'; size];
            let mut reader = data.as_slice();
            let (bytes, truncated) = read_capped(&mut reader, STDERR_LIMIT, false).await.unwrap();
            assert_eq!(bytes, data[..STDERR_LIMIT]);
            assert_eq!(truncated, size > STDERR_LIMIT);
            assert!(reader.is_empty());
        }
    }
}
