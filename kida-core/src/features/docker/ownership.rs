//! Local creation evidence. Never adopt resources while loading a pending record.
use super::repository::{self, Identity, ProjectGuard, Record, err};
use super::{
    ComposeOptions, DockerService,
    lifecycle::{Runner, project_lock},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{ffi::OsString, time::Duration};
use tokio::time::{Instant, timeout_at};
const OWNER: &str = "io.kida.owner";
const PROJECT: &str = "com.docker.compose.project";
const FILES: &str = "com.docker.compose.project.config_files";
const DIRECTORY: &str = "com.docker.compose.project.working_dir";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedProject {
    pub owner: String,
    pub project: String,
}
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct RemovalReport {
    pub removed: Vec<ResourceOutcome>,
    pub absent: Vec<ResourceOutcome>,
    pub preserved: Vec<ResourceOutcome>,
    pub failed: Vec<ResourceOutcome>,
    #[serde(default)]
    pub errors: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceOutcome {
    pub kind: String,
    pub identity: String,
    pub reason: String,
}
pub(super) async fn daemon(runner: &Runner<'_>) -> Result<String, String> {
    let id = runner.text(&["info", "--format", "{{.ID}}"]).await?;
    let id = id.trim();
    if id.is_empty() {
        return Err(err("daemon ID missing"));
    }
    Ok(id.into())
}
pub(super) fn reject_reserved_labels(document: &Value) -> Result<(), String> {
    match document {
        Value::Object(object) => {
            if let Some(labels) = object.get("labels")
                && labels
                    .as_object()
                    .is_some_and(|map| map.keys().any(|key| key.starts_with("io.kida.")))
            {
                return Err(err("user supplied reserved io.kida.* labels"));
            }
            for value in object.values() {
                reject_reserved_labels(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_reserved_labels(value)?;
            }
        }
        _ => (),
    }
    Ok(())
}

#[derive(Default)]
struct Inventory {
    containers: Vec<Value>,
    networks: Vec<Value>,
    volumes: Vec<Value>,
}
impl Inventory {
    fn get(&self, kind: &str) -> &[Value] {
        match kind {
            "container" => &self.containers,
            "network" => &self.networks,
            _ => &self.volumes,
        }
    }
}
fn text_field<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| err(format!("missing {key} in inspection")))
}
fn id<'a>(kind: &str, value: &'a Value) -> Result<&'a str, String> {
    text_field(value, if kind == "volume" { "Name" } else { "Id" })
}
fn labels<'a>(kind: &str, value: &'a Value) -> &'a Value {
    if kind == "container" {
        &value["Config"]["Labels"]
    } else {
        &value["Labels"]
    }
}
fn fingerprint(kind: &str, value: &Value) -> Result<Value, String> {
    if kind != "volume" {
        return Ok(Value::Null);
    }
    for key in ["Name", "CreatedAt", "Driver", "Scope", "Mountpoint"] {
        text_field(value, key)?;
    }
    if !value
        .get("Options")
        .is_some_and(|v| v.is_null() || v.is_object())
    {
        return Err(err("missing volume options"));
    }
    Ok(
        json!({"Name": value["Name"], "CreatedAt": value["CreatedAt"], "Driver": value["Driver"], "Scope": value["Scope"], "Options": value["Options"], "Mountpoint": value["Mountpoint"], "Labels": value["Labels"]}),
    )
}
async fn inventory(runner: &Runner<'_>) -> Result<Inventory, String> {
    let mut result = Inventory::default();
    for kind in ["container", "network", "volume"] {
        let list = match kind {
            "container" => runner.text(&["ps", "-aq", "--no-trunc"]).await?,
            "network" => runner.text(&["network", "ls", "-q", "--no-trunc"]).await?,
            _ => runner.text(&["volume", "ls", "-q"]).await?,
        };
        let ids: Vec<_> = list.lines().filter(|s| !s.is_empty()).collect();
        let mut rows = vec![];
        // Separate inspection keeps output bounded and verifies every listed identity.
        for expected in ids {
            let args: Vec<OsString> = if kind == "container" {
                vec!["container".into(), "inspect".into(), expected.into()]
            } else {
                vec![kind.into(), "inspect".into(), expected.into()]
            };
            let inspected: Vec<Value> = runner.json(&args).await?;
            if inspected.len() != 1 || id(kind, &inspected[0])? != expected {
                return Err(err("incomplete or mismatched inspection"));
            }
            let row = &inspected[0];
            if kind == "container"
                && (row["State"]["Running"].as_bool().is_none()
                    || !row["Mounts"].is_array()
                    || !row["NetworkSettings"]["Networks"].is_object())
            {
                return Err(err("incomplete container usage inspection"));
            }
            if kind == "container" {
                for mount in row["Mounts"].as_array().unwrap() {
                    let mount_type = text_field(mount, "Type")?;
                    if mount_type == "volume" {
                        text_field(mount, "Name")?;
                    }
                }
                for network in row["NetworkSettings"]["Networks"]
                    .as_object()
                    .unwrap()
                    .values()
                {
                    // Never-started containers may have a network name but no endpoint ID yet.
                    if !network["NetworkID"].is_string() {
                        return Err(err("missing network identity field"));
                    }
                }
            }
            if kind == "network" {
                text_field(row, "Name")?;
            }
            if kind == "network" && !row["Containers"].is_object() {
                return Err(err("incomplete network connections"));
            }
            rows.extend(inspected);
        }
        match kind {
            "container" => result.containers = rows,
            "network" => result.networks = rows,
            _ => result.volumes = rows,
        }
    }
    Ok(result)
}
fn verify(record: &Record, identity: &Identity, value: &Value) -> Result<(), String> {
    if identity.kind != "volume"
        && (identity.id.len() != 64 || !identity.id.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(err("full Docker identity required"));
    }
    let labels = labels(&identity.kind, value);
    let native = format!(
        "com.docker.compose.{}",
        if identity.kind == "container" {
            "service"
        } else {
            &identity.kind
        }
    );
    if id(&identity.kind, value)? != identity.id
        || labels[OWNER].as_str() != Some(&record.reference.owner)
        || labels[PROJECT].as_str() != Some(&record.reference.project)
        || labels[&native].as_str() != Some(&identity.key)
        || fingerprint(&identity.kind, value)? != identity.fingerprint
    {
        return Err(err(format!(
            "contradictory identity or labels: {} {}",
            identity.kind, identity.id
        )));
    }
    if identity.kind == "container"
        && (labels[FILES].as_str() != Some(record.files().as_str())
            || labels[DIRECTORY].as_str() != Some(&record.directory))
    {
        return Err(err("container provenance mismatch"));
    }
    Ok(())
}
pub(super) async fn capture(
    runner: &Runner<'_>,
    record: &mut Record,
    guard: &ProjectGuard,
) -> Result<(), String> {
    if daemon(runner).await? != record.daemon {
        return Err(err("daemon changed"));
    }
    for kind in ["container", "network", "volume"] {
        let filter = format!("label={PROJECT}={}", record.reference.project);
        let list = match kind {
            "container" => {
                runner
                    .text(&["ps", "-aq", "--no-trunc", "--filter", &filter])
                    .await?
            }
            "network" => {
                runner
                    .text(&["network", "ls", "-q", "--no-trunc", "--filter", &filter])
                    .await?
            }
            _ => {
                runner
                    .text(&["volume", "ls", "-q", "--filter", &filter])
                    .await?
            }
        };
        for expected_id in list.lines().filter(|id| !id.is_empty()) {
            let args = [kind, "inspect", expected_id].map(OsString::from);
            let rows: Vec<Value> = runner.json(&args).await?;
            if rows.len() != 1 || id(kind, &rows[0])? != expected_id {
                return Err(err("incomplete creation inspection"));
            }
            let value = &rows[0];
            let tags = labels(kind, value);
            if tags[OWNER].as_str() != Some(&record.reference.owner) {
                continue;
            }
            let native = format!(
                "com.docker.compose.{}",
                if kind == "container" { "service" } else { kind }
            );
            let key = text_field(tags, &native)?.to_owned();
            let expected = record.expected[kind]
                .get(&key)
                .ok_or_else(|| err("unexpected created resource"))?;
            if kind != "container" && text_field(value, "Name")? != expected {
                return Err(err("created resource name mismatch"));
            }
            let identity = Identity {
                kind: kind.into(),
                id: id(kind, value)?.into(),
                key,
                fingerprint: fingerprint(kind, value)?,
                done: false,
            };
            verify(record, &identity, value)?;
            record.resources.push(identity);
            repository::save(record, runner.deadline, guard).await?;
        }
    }
    if !record.resources.iter().any(|r| r.kind == "container") {
        return Err(err("creation has no verified containers; record pending"));
    }
    for kind in ["network", "volume"] {
        if record.expected[kind].keys().any(|key| {
            !record
                .resources
                .iter()
                .any(|r| r.kind == kind && &r.key == key)
        }) {
            return Err(err("creation inventory incomplete; record pending"));
        }
    }
    Ok(())
}
fn preflight(record: &Record, snapshot: &Inventory, stopped: bool) -> Result<(), String> {
    for kind in ["container", "network", "volume"] {
        for value in snapshot.get(kind) {
            let tags = labels(kind, value);
            if tags[OWNER].as_str() == Some(&record.reference.owner)
                || tags[PROJECT].as_str() == Some(&record.reference.project)
            {
                let identity = record
                    .resources
                    .iter()
                    .find(|r| r.kind == kind && id(kind, value).ok() == Some(r.id.as_str()));
                let identity = identity
                    .ok_or_else(|| err("ambiguous unrecorded project resource; no adoption"))?;
                if identity.done {
                    return Err(err("completed identity has reappeared"));
                }
                verify(record, identity, value)?;
            }
        }
    }
    for identity in record.resources.iter().filter(|r| !r.done) {
        if let Some(value) = snapshot
            .get(&identity.kind)
            .iter()
            .find(|v| id(&identity.kind, v).ok() == Some(identity.id.as_str()))
        {
            verify(record, identity, value)?;
            if stopped
                && identity.kind == "container"
                && value["State"]["Running"].as_bool() != Some(false)
            {
                return Err(err("managed container is running"));
            }
        }
    }
    Ok(())
}
pub(super) async fn validate(
    runner: &Runner<'_>,
    record: &Record,
    stopped: bool,
) -> Result<(), String> {
    if daemon(runner).await? != record.daemon {
        return Err(err("daemon mismatch"));
    }
    if record.pending {
        return Err(err(
            "pending creation cannot start or stop; use removal with persisted identities",
        ));
    }
    preflight(record, &inventory(runner).await?, stopped)
}
fn outcome(resource: &Identity, reason: impl Into<String>) -> ResourceOutcome {
    ResourceOutcome {
        kind: resource.kind.clone(),
        identity: resource.id.clone(),
        reason: reason.into(),
    }
}
fn shared(identity: &Identity, snapshot: &Inventory) -> bool {
    if identity.kind == "network" {
        snapshot
            .networks
            .iter()
            .find(|v| id("network", v).ok() == Some(identity.id.as_str()))
            .is_some_and(|v| v["Containers"].as_object().is_none_or(|c| !c.is_empty()))
            || snapshot.containers.iter().any(|c| {
                c["NetworkSettings"]["Networks"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .any(|(name, n)| {
                        n["NetworkID"].as_str() == Some(&identity.id)
                            || snapshot.networks.iter().any(|network| {
                                network["Id"].as_str() == Some(&identity.id)
                                    && network["Name"].as_str() == Some(name)
                            })
                    })
            })
    } else if identity.kind == "volume" {
        snapshot.containers.iter().any(|c| {
            c["Mounts"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["Type"] == "volume" && m["Name"].as_str() == Some(&identity.id))
        })
    } else {
        false
    }
}
impl DockerService {
    /// Creation evidence from the registry, not a fresh daemon inventory.
    pub async fn compose_managed_resources(
        reference: &ManagedProject,
        timeout: Duration,
    ) -> Result<Vec<ResourceOutcome>, String> {
        if timeout.is_zero() {
            return Err(err("timeout must be positive"));
        }
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| err("timeout too large"))?;
        Self::validate_compose_project_name(&reference.project)?;
        let guard = std::sync::Arc::new(
            timeout_at(deadline, project_lock(&reference.project).lock_owned())
                .await
                .map_err(|_| err("project lock timeout"))?,
        );
        let reference = reference.clone();
        repository::disk(deadline, &guard, move || {
            let record = repository::records()?
                .into_iter()
                .find(|record| record.reference == reference)
                .ok_or_else(|| err("creation record missing"))?;
            Ok(record
                .resources
                .into_iter()
                .map(|resource| ResourceOutcome {
                    kind: resource.kind,
                    identity: resource.id,
                    reason: "recorded at creation".into(),
                })
                .collect())
        })
        .await
    }

    pub async fn compose_managed_project(project: &str) -> Result<ManagedProject, String> {
        let deadline = Instant::now() + Duration::from_secs(30);
        Self::validate_compose_project_name(project)?;
        repository::check_deadline(deadline)?;
        let guard = std::sync::Arc::new(
            timeout_at(deadline, project_lock(project).lock_owned())
                .await
                .map_err(|_| err("project lock timeout"))?,
        );
        let project = project.to_owned();
        repository::disk(deadline, &guard, move || {
            let records = repository::records()?;
            records
                .into_iter()
                .filter(|r| r.reference.project == project)
                .max_by(|a, b| (!a.completed, &a.created_at).cmp(&(!b.completed, &b.created_at)))
                .map(|r| r.reference)
                .ok_or_else(|| err("project is not managed"))
        })
        .await
    }
    /// Delete only stopped, individually verified resources. Does not use Compose.
    pub async fn compose_remove(
        reference: &ManagedProject,
        timeout: Duration,
    ) -> Result<RemovalReport, String> {
        if timeout.is_zero() {
            return Err(err("timeout must be positive"));
        }
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| err("timeout too large"))?;
        Self::validate_compose_project_name(&reference.project)?;
        repository::check_deadline(deadline)?;
        let project_lock = project_lock(&reference.project);
        let guard = std::sync::Arc::new(
            timeout_at(deadline, project_lock.lock_owned())
                .await
                .map_err(|_| err("project lock timeout"))?,
        );
        let reference_copy = reference.clone();
        let mut record = repository::disk(deadline, &guard, move || {
            repository::records()?
                .into_iter()
                .find(|r| r.reference == reference_copy)
                .ok_or_else(|| err("creation reference not found"))
        })
        .await?;
        let mut report = RemovalReport::default();
        if record.completed {
            for resource in &record.resources {
                report
                    .absent
                    .push(outcome(resource, "creation already completed"));
            }
            return Ok(report);
        }
        let options = ComposeOptions::new(&reference.project, "");
        let runner = Runner {
            options: &options,
            deadline,
        };
        if daemon(&runner).await? != record.daemon {
            return Err(err("daemon mismatch"));
        }
        let initial = inventory(&runner).await?;
        preflight(&record, &initial, true)?;
        let mut mounts = std::collections::BTreeSet::new();
        for container in &initial.containers {
            if !record
                .resources
                .iter()
                .any(|r| r.kind == "container" && container["Id"].as_str() == Some(r.id.as_str()))
            {
                continue;
            }
            for mount in container["Mounts"].as_array().unwrap() {
                let kind = text_field(mount, "Type")?;
                if kind == "volume" {
                    let name = text_field(mount, "Name")?;
                    if !record
                        .resources
                        .iter()
                        .any(|r| r.kind == "volume" && r.id == name)
                    {
                        mounts.insert(("volume".to_string(), name.to_string()));
                    }
                } else if kind == "bind" {
                    mounts.insert(("bind".to_string(), text_field(mount, "Source")?.to_string()));
                }
            }
        }
        for (kind, identity) in mounts {
            report.preserved.push(ResourceOutcome {
                kind,
                identity,
                reason: "mount without recorded ownership".into(),
            });
        }
        for (kind, name) in &record.external {
            report.preserved.push(ResourceOutcome {
                kind: kind.clone(),
                identity: name.clone(),
                reason: "external resource".into(),
            });
        }
        for index in 0..record.resources.len() {
            let resource = record.resources[index].clone();
            if resource.done {
                report
                    .absent
                    .push(outcome(&resource, "previously removed or confirmed absent"));
                continue;
            }
            let attempt = async {
                if daemon(&runner).await? != record.daemon {
                    return Err(err("daemon changed"));
                }
                let snapshot = inventory(&runner).await?;
                preflight(&record, &snapshot, true)?;
                let Some(value) = snapshot
                    .get(&resource.kind)
                    .iter()
                    .find(|v| id(&resource.kind, v).ok() == Some(resource.id.as_str()))
                else {
                    return Ok(("absent", "confirmed by valid inventory".to_string()));
                };
                verify(&record, &resource, value)?;
                if shared(&resource, &snapshot) {
                    return Ok(("preserved", "resource is still in use".into()));
                }
                if resource.kind == "volume"
                    && (value["Driver"] != "local"
                        || value["Scope"] != "local"
                        || value["Options"].as_object().is_some_and(|o| !o.is_empty()))
                {
                    return Ok((
                        "preserved",
                        "unsupported storage driver, scope or options".into(),
                    ));
                }
                // Narrow the inspection/deletion window after the full safety inventory.
                let inspect =
                    [resource.kind.as_str(), "inspect", resource.id.as_str()].map(OsString::from);
                let current: Vec<Value> = runner.json(&inspect).await?;
                if current.len() != 1 {
                    return Err(err("incomplete final inspection"));
                }
                verify(&record, &resource, &current[0])?;
                if resource.kind == "container"
                    && current[0]["State"]["Running"].as_bool() != Some(false)
                {
                    return Err(err("container started before removal"));
                }
                if resource.kind == "network"
                    && current[0]["Containers"]
                        .as_object()
                        .is_none_or(|c| !c.is_empty())
                {
                    return Ok((
                        "preserved",
                        "network acquired connections before removal".into(),
                    ));
                }
                let args = [resource.kind.as_str(), "rm", resource.id.as_str()].map(OsString::from);
                Box::pin(runner.run(&args, false)).await?;
                let after = inventory(&runner).await?;
                if after
                    .get(&resource.kind)
                    .iter()
                    .any(|v| id(&resource.kind, v).ok() == Some(resource.id.as_str()))
                {
                    return Err(err("removal returned success but identity remains"));
                }
                Ok(("removed", "verified removal".into()))
            }
            .await;
            match attempt {
                Ok(("removed", reason)) => {
                    report.removed.push(outcome(&resource, reason));
                    record.resources[index].done = true;
                }
                Ok(("absent", reason)) => {
                    report.absent.push(outcome(&resource, reason));
                    record.resources[index].done = true;
                }
                Ok((_, reason)) => report.preserved.push(outcome(&resource, reason)),
                Err(reason) => {
                    if reason.contains("timeout") {
                        report.errors.push(reason.clone());
                    }
                    report.failed.push(outcome(&resource, reason));
                    for remaining in record.resources.iter().skip(index + 1).filter(|r| !r.done) {
                        report.preserved.push(outcome(
                            remaining,
                            "not attempted after safety or command failure",
                        ));
                    }
                    break;
                }
            }
            if let Err(error) = repository::save(&record, deadline, &guard).await {
                report.errors.push(error);
                for remaining in record.resources.iter().skip(index + 1).filter(|r| !r.done) {
                    report.preserved.push(outcome(
                        remaining,
                        "not attempted after persistence interruption",
                    ));
                }
                return Ok(report);
            }
        }
        record.completed = record.resources.iter().all(|r| r.done);
        if report.errors.is_empty()
            && let Err(error) = repository::save(&record, deadline, &guard).await
        {
            report.errors.push(error);
        }
        Ok(report)
    }
}
