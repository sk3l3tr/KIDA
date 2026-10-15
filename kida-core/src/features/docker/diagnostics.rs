//! Read-only current observations through the same cancellable Docker runner as lifecycle.
use super::{
    ComposeContainerDiagnostics, ComposeDiagnostics, ComposeOptions, ContainerDiagnosticError,
    ContainerDiagnostics, ContainerLogs, DockerService, lifecycle::Runner, service::map_container,
};
use serde_json::Value;
use std::{ffi::OsString, time::Duration};
use tokio::time::Instant;

const PROJECT: &str = "com.docker.compose.project";
const SERVICE: &str = "com.docker.compose.service";
const LOG_LIMIT: usize = 1024 * 1024;

fn deadline(timeout: Duration) -> Result<Instant, String> {
    if timeout.is_zero() {
        return Err("Docker diagnostics: timeout must be positive".into());
    }
    Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| "Docker diagnostics: timeout is too large".into())
}

fn reference(container: &str) -> Result<(), String> {
    // Docker names or hexadecimal ID prefixes. Reject options and ambiguous whitespace.
    if container.is_empty()
        || !container.bytes().next().unwrap().is_ascii_alphanumeric()
        || !container
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err("Docker diagnostics: invalid container reference".into());
    }
    Ok(())
}

fn full_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn invalid(field: &str) -> String {
    format!("Docker diagnostics: missing or invalid {field}")
}

/// Validate all technical observations before calling the permissive legacy mapper.
fn validate(value: &Value, requested: &str, exact: bool) -> Result<ContainerDiagnostics, String> {
    let id = value["Id"]
        .as_str()
        .filter(|id| full_id(id))
        .ok_or_else(|| invalid("Id"))?;
    let name = value["Name"]
        .as_str()
        .filter(|s| !s.trim_start_matches('/').is_empty())
        .ok_or_else(|| invalid("Name"))?;
    if (exact && id != requested)
        || (!exact
            && name.trim_start_matches('/') != requested
            && !(requested.bytes().all(|b| b.is_ascii_hexdigit()) && id.starts_with(requested)))
    {
        return Err("Docker diagnostics: container identity mismatch".into());
    }
    for path in [
        "/Config/Image",
        "/State/Status",
        "/State/StartedAt",
        "/State/FinishedAt",
        "/HostConfig/RestartPolicy/Name",
    ] {
        if value.pointer(path).and_then(Value::as_str).is_none() {
            return Err(invalid(path));
        }
    }
    if value["State"]["Running"].as_bool().is_none() {
        return Err(invalid("State.Running"));
    }
    if value["State"]["ExitCode"].as_i64().is_none() {
        return Err(invalid("State.ExitCode"));
    }
    if value["RestartCount"].as_u64().is_none() {
        return Err(invalid("RestartCount"));
    }
    if let Some(health) = value["State"].get("Health") {
        if !matches!(
            health["Status"].as_str(),
            Some("healthy" | "unhealthy" | "starting")
        ) {
            return Err(invalid("State.Health.Status"));
        }
    }
    for (key, is_valid) in [
        ("OOMKilled", value["State"]["OOMKilled"].is_boolean()),
        ("Error", value["State"]["Error"].is_string()),
    ] {
        if value["State"].get(key).is_some() && !is_valid {
            return Err(invalid(key));
        }
    }
    if !value["NetworkSettings"].is_object() {
        return Err(invalid("NetworkSettings"));
    }
    for key in ["Ports", "Networks"] {
        let field = value["NetworkSettings"]
            .get(key)
            .ok_or_else(|| invalid(key))?;
        if !field.is_null() && !field.is_object() {
            return Err(invalid(key));
        }
    }
    if let Some(ports) = value["NetworkSettings"]["Ports"].as_object() {
        for (key, bindings) in ports {
            let valid_key = key.split_once('/').is_some_and(|(port, protocol)| {
                port.parse::<u16>().is_ok() && !protocol.is_empty()
            });
            if !valid_key {
                return Err(invalid("NetworkSettings.Ports key"));
            }
            if bindings.is_null() {
                continue;
            }
            let bindings = bindings
                .as_array()
                .ok_or_else(|| invalid("port bindings"))?;
            for binding in bindings {
                if binding["HostIp"].as_str().is_none() || binding["HostPort"].as_str().is_none() {
                    return Err(invalid("port binding"));
                }
            }
        }
    }
    if let Some(networks) = value["NetworkSettings"]["Networks"].as_object() {
        for network in networks.values() {
            if !network.is_object() {
                return Err(invalid("network"));
            }
            for key in ["IPAddress", "Gateway", "MacAddress"] {
                if network.get(key).is_some_and(|field| !field.is_string()) {
                    return Err(invalid(key));
                }
            }
        }
    }
    Ok(ContainerDiagnostics {
        container: map_container(value),
        oom_killed: value["State"]["OOMKilled"].as_bool(),
        docker_error: value["State"]["Error"].as_str().map(str::to_owned),
    })
}

async fn inspect(runner: &Runner<'_>, container: &str) -> Result<Value, String> {
    let args: Vec<OsString> = ["container", "inspect", container].map(Into::into).into();
    let mut values: Vec<Value> = runner.json(&args).await?;
    if values.len() != 1 {
        return Err(invalid("inspection count"));
    }
    Ok(values.remove(0))
}

impl DockerService {
    /// Current state only; neither reconstructs history nor infers OOM from exit codes.
    pub async fn inspect_container(
        container: &str,
        timeout: Duration,
    ) -> Result<ContainerDiagnostics, String> {
        let deadline = deadline(timeout)?;
        reference(container)?;
        let options = ComposeOptions::new("", "");
        let runner = Runner {
            options: &options,
            deadline,
        };
        validate(&inspect(&runner, container).await?, container, false)
    }

    /// Partial results for all currently present containers, including stopped replicas.
    /// One shared deadline covers enumeration and all inspections.
    pub async fn diagnose_compose_project(
        project: &str,
        timeout: Duration,
    ) -> Result<ComposeDiagnostics, String> {
        let deadline = deadline(timeout)?;
        Self::validate_compose_project_name(project)?;
        let options = ComposeOptions::new(project, "");
        let runner = Runner {
            options: &options,
            deadline,
        };
        let filter = format!("label={PROJECT}={project}");
        let ids = runner
            .text(&["ps", "-aq", "--no-trunc", "--filter", &filter])
            .await?;
        let ids: Vec<_> = ids.lines().filter(|id| !id.is_empty()).collect();
        let mut seen = std::collections::BTreeSet::new();
        if ids.iter().any(|id| !full_id(id) || !seen.insert(*id)) {
            return Err(invalid("enumerated container IDs"));
        }
        let mut result = ComposeDiagnostics {
            project: project.into(),
            containers: vec![],
            errors: vec![],
        };
        for id in ids {
            let observation = async {
                if Instant::now() >= deadline {
                    return Err("Docker diagnostics: timeout; container not inspected".into());
                }
                let value = inspect(&runner, id).await?;
                let diagnostics = validate(&value, id, true)?;
                let labels = &value["Config"]["Labels"];
                if labels[PROJECT].as_str() != Some(project) {
                    return Err(invalid("Compose project identity"));
                }
                let service = match labels.get(SERVICE) {
                    None => None,
                    Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
                    _ => return Err(invalid("Compose service label")),
                };
                Ok(ComposeContainerDiagnostics {
                    service,
                    diagnostics,
                })
            }
            .await;
            match observation {
                Ok(container) => result.containers.push(container),
                Err(error) => result.errors.push(ContainerDiagnosticError {
                    id: id.into(),
                    error,
                }),
            }
        }
        Ok(result)
    }

    /// Last 1..=10,000 lines, no follow; at most 1 MiB per raw channel.
    /// Logs may contain credentials or personal data. This method does not print or persist them.
    pub async fn container_logs(
        container: &str,
        tail: u32,
        timeout: Duration,
    ) -> Result<ContainerLogs, String> {
        let deadline = deadline(timeout)?;
        reference(container)?;
        if !(1..=10_000).contains(&tail) {
            return Err("Docker logs: tail must be between 1 and 10000".into());
        }
        let options = ComposeOptions::new("", "");
        let runner = Runner {
            options: &options,
            deadline,
        };
        let args =
            ["container", "logs", "--tail", &tail.to_string(), container].map(OsString::from);
        let (stdout, stderr) = runner.capture(&args, true, Some(LOG_LIMIT)).await?;
        Ok(ContainerLogs {
            container: container.into(),
            tail,
            stdout,
            stderr,
            warning:
                "Logs may contain sensitive information, including credentials and personal data."
                    .into(),
        })
    }
}
