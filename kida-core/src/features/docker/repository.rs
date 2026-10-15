//! Versioned local creation evidence and blocking repository operations.
use super::{DockerService, lifecycle::Resolved, ownership::ManagedProject};
use crate::infrastructure::{
    conf,
    storage::{JsonStorage, Storage},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{sync::OwnedMutexGuard, time::Instant};
const OWNER: &str = "io.kida.owner";
pub(super) type ProjectGuard = Arc<OwnedMutexGuard<()>>;

pub(super) fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        Err("Compose timeout: operation deadline exceeded".into())
    } else {
        Ok(())
    }
}

// Never abandon started disk work. Its copy of the guard also survives consumer cancellation.
pub(super) async fn disk<T: Send + 'static>(
    deadline: Instant,
    guard: &ProjectGuard,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    check_deadline(deadline)?;
    let guard = guard.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _guard = guard;
        check_deadline(deadline)?;
        work()
    })
    .await
    .map_err(err)?;
    if let Err(timeout) = check_deadline(deadline) {
        return Err(match result {
            Err(error) => format!("{error}; {timeout}"),
            Ok(_) => timeout,
        });
    }
    result
}

pub(super) async fn input_file(
    input: PathBuf,
    deadline: Instant,
    guard: &ProjectGuard,
) -> Result<PathBuf, String> {
    disk(deadline, guard, move || {
        let input_error = |e: std::io::Error| format!("Compose input error: {e}");
        let file = fs::canonicalize(input).map_err(input_error)?;
        if !fs::metadata(&file).map_err(input_error)?.is_file() {
            return Err("Compose input error: Compose input must be a regular file".into());
        }
        Ok(file)
    })
    .await
}

pub(super) async fn save(
    record: &Record,
    deadline: Instant,
    guard: &ProjectGuard,
) -> Result<(), String> {
    let record = record.clone();
    disk(deadline, guard, move || record.save()).await
}

pub(super) async fn reserve_async(
    project: String,
    daemon: String,
    model: Resolved,
    file: PathBuf,
    deadline: Instant,
    guard: &ProjectGuard,
) -> Result<Record, String> {
    disk(deadline, guard, move || {
        reserve(&project, daemon, &model, &file, deadline)
    })
    .await
}

fn reserved(labels: &BTreeMap<String, String>) -> bool {
    labels.keys().any(|key| key.starts_with("io.kida."))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Identity {
    pub(super) kind: String,
    pub(super) id: String,
    pub(super) key: String,
    pub(super) fingerprint: Value,
    // Persist success/confirmed absence before proceeding to another resource.
    pub(super) done: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Record {
    pub(super) version: u32,
    pub(super) reference: ManagedProject,
    pub(super) daemon: String,
    pub(super) created_at: String,
    pub(super) file: PathBuf,
    pub(super) file_hash: String,
    pub(super) overlay: PathBuf,
    pub(super) overlay_hash: String,
    pub(super) directory: String,
    pub(super) external: Vec<(String, String)>,
    pub(super) expected: BTreeMap<String, BTreeMap<String, String>>,
    pub(super) resources: Vec<Identity>,
    pub(super) pending: bool,
    pub(super) completed: bool,
}
pub(super) fn err(e: impl std::fmt::Display) -> String {
    format!("Docker ownership: {e}")
}
fn directory() -> Result<PathBuf, String> {
    Ok(PathBuf::from(
        &conf::get().map_err(err)?.docker.ownership_dir,
    ))
}
fn record_path(owner: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(owner).map_err(err)?;
    Ok(directory()?.join(format!("{owner}.json")))
}
pub(super) fn records() -> Result<Vec<Record>, String> {
    let dir = directory()?;
    let entries = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(err(e)),
    };
    let mut result = vec![];
    for entry in entries {
        let path = entry.map_err(err)?.path();
        if path.extension().is_some_and(|e| e == "json") {
            let record: Record = JsonStorage::new(&path).load().map_err(err)?;
            if record.version != 1 || record_path(&record.reference.owner)? != path {
                return Err(err("invalid record version or identity"));
            }
            DockerService::validate_compose_project_name(&record.reference.project).map_err(err)?;
            if record.daemon.is_empty()
                || !record.file.is_absolute()
                || !record.overlay.is_absolute()
                || record.expected.len() != 3
                || ["container", "network", "volume"]
                    .iter()
                    .any(|kind| !record.expected.contains_key(*kind))
                || record.completed && record.resources.iter().any(|r| !r.done)
            {
                return Err(err("invalid record metadata"));
            }
            let mut identities = std::collections::BTreeSet::new();
            for resource in &record.resources {
                if !identities.insert((&resource.kind, &resource.id))
                    || !record
                        .expected
                        .get(&resource.kind)
                        .is_some_and(|keys| keys.contains_key(&resource.key))
                    || resource.id.is_empty()
                {
                    return Err(err("invalid or duplicate recorded resource"));
                }
            }
            result.push(record);
        }
    }
    let mut projects = std::collections::BTreeSet::new();
    if result
        .iter()
        .filter(|r| !r.completed)
        .any(|r| !projects.insert(&r.reference.project))
    {
        return Err(err("conflicting active records"));
    }
    Ok(result)
}
pub(super) fn active(project: &str) -> Result<Option<Record>, String> {
    let mut matches: Vec<_> = records()?
        .into_iter()
        .filter(|r| r.reference.project == project && !r.completed)
        .collect();
    if matches.len() > 1 {
        return Err(err("conflicting records for project"));
    }
    Ok(matches.pop())
}
fn hash(path: &Path) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(fs::read(path).map_err(err)?)
    ))
}
impl Record {
    pub(super) fn save(&self) -> Result<(), String> {
        #[cfg(test)]
        test_io::before_save(&self.reference.project)?;
        JsonStorage::new(record_path(&self.reference.owner)?)
            .save(self)
            .map_err(err)
    }
    pub(super) fn files(&self) -> String {
        format!("{},{}", self.file.display(), self.overlay.display())
    }
    pub(super) fn check_files(&self, file: &Path) -> Result<(), String> {
        if self.file != file
            || hash(file)? != self.file_hash
            || hash(&self.overlay)? != self.overlay_hash
        {
            return Err(err("Compose provenance changed"));
        }
        Ok(())
    }
}
pub(super) fn creation_paths(root: &Path, owner: &str) -> Result<(PathBuf, PathBuf), String> {
    uuid::Uuid::parse_str(owner).map_err(err)?;
    let root = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir().map_err(err)?.join(root)
    };
    let path = root.join(format!("{owner}.json"));
    let overlay = root.join(format!("{owner}.compose.yaml"));
    if path.exists() || overlay.exists() {
        return Err(err("UUID collision"));
    }
    if overlay.to_str().is_none_or(|s| s.contains(',')) {
        return Err(err("invalid overlay path"));
    }
    Ok((path, overlay))
}
fn reserve(
    project: &str,
    daemon: String,
    model: &Resolved,
    file: &Path,
    deadline: Instant,
) -> Result<Record, String> {
    if model.services.values().any(|s| reserved(&s.labels))
        || model
            .networks
            .values()
            .chain(model.volumes.values())
            .any(|r| reserved(&r.labels))
    {
        return Err(err("user supplied reserved io.kida.* labels"));
    }
    let owner = uuid::Uuid::new_v4().to_string();
    let (_, overlay) = creation_paths(&directory()?, &owner)?;
    fs::create_dir_all(directory()?).map_err(err)?;
    let mut extra = json!({"services": {}, "networks": {}, "volumes": {}});
    let mut expected = BTreeMap::new();
    let mut services = BTreeMap::new();
    for key in model.services.keys() {
        extra["services"][key] = json!({"labels": {OWNER: owner}});
        services.insert(key.clone(), key.clone());
    }
    expected.insert("container".into(), services);
    let mut external = vec![];
    for (kind, section, resources) in [
        ("network", "networks", &model.networks),
        ("volume", "volumes", &model.volumes),
    ] {
        let mut names = BTreeMap::new();
        for (key, resource) in resources {
            if resource.external {
                external.push((kind.into(), resource.name.clone()));
            } else {
                extra[section][key] = json!({"labels": {OWNER: owner}});
                names.insert(key.clone(), resource.name.clone());
            }
        }
        expected.insert(kind.into(), names);
    }
    let mut record = Record {
        version: 1,
        reference: ManagedProject {
            owner,
            project: project.to_owned(),
        },
        daemon,
        created_at: chrono::Utc::now().to_rfc3339(),
        file: file.into(),
        file_hash: hash(file)?,
        overlay,
        overlay_hash: String::new(),
        directory: file.parent().unwrap().to_string_lossy().into(),
        external,
        expected,
        resources: vec![],
        pending: true,
        completed: false,
    };
    // Reserve first. A crash even before writing the overlay leaves a blocking record.
    check_deadline(deadline)?;
    record.save()?;
    check_deadline(deadline)?;
    use std::io::Write;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&record.overlay)
        .map_err(err)?;
    output
        .write_all(&serde_json::to_vec_pretty(&extra).map_err(err)?)
        .map_err(err)?;
    output.sync_all().map_err(err)?;
    check_deadline(deadline)?;
    record.overlay_hash = hash(&record.overlay)?;
    check_deadline(deadline)?;
    record.save()?;
    Ok(record)
}

// One-shot save barriers/failures scoped by project; never compiled into production.
#[cfg(test)]
pub(super) mod test_io {
    use super::*;
    use std::sync::{Mutex, OnceLock, mpsc};
    struct Hook {
        skip: usize,
        started: tokio::sync::oneshot::Sender<()>,
        release: mpsc::Receiver<()>,
        fail: bool,
    }
    fn hooks() -> &'static Mutex<BTreeMap<String, Hook>> {
        static HOOKS: OnceLock<Mutex<BTreeMap<String, Hook>>> = OnceLock::new();
        HOOKS.get_or_init(Mutex::default)
    }
    pub fn install(
        project: &str,
        skip: usize,
        fail: bool,
    ) -> (tokio::sync::oneshot::Receiver<()>, mpsc::Sender<()>) {
        let (started, receiver) = tokio::sync::oneshot::channel();
        let (release, barrier) = mpsc::channel();
        assert!(
            hooks()
                .lock()
                .unwrap()
                .insert(
                    project.into(),
                    Hook {
                        skip,
                        started,
                        release: barrier,
                        fail
                    }
                )
                .is_none()
        );
        (receiver, release)
    }
    pub fn before_save(project: &str) -> Result<(), String> {
        let hook = {
            let mut hooks = hooks().lock().unwrap();
            match hooks.get_mut(project) {
                Some(hook) if hook.skip > 0 => {
                    hook.skip -= 1;
                    None
                }
                Some(_) => hooks.remove(project),
                None => None,
            }
        };
        if let Some(hook) = hook {
            let _ = hook.started.send(());
            hook.release.recv().map_err(err)?;
            if hook.fail {
                return Err(err("injected save failure"));
            }
        }
        Ok(())
    }
}
