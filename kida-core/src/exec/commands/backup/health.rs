use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    exec::executor,
    features::backup::health::{model::BackupHealthMode, service},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    definition_path: PathBuf,
    mode: BackupHealthMode,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Run {
    definition_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunId {
    run_id: String,
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| format!("invalid health parameters: {error}"))
}

fn run_id(params: Value) -> Result<String, String> {
    let input: RunId = parse(params)?;
    Uuid::parse_str(&input.run_id).map_err(|_| "invalid run_id UUID".to_string())?;
    Ok(input.run_id)
}

fn empty(params: &Value) -> Result<(), String> {
    if params.is_null() || params.as_object().is_some_and(|object| object.is_empty()) {
        Ok(())
    } else {
        Err("health operation accepts no parameters".into())
    }
}

fn enqueue(request: &CommandRequest, run_id: &str) -> Result<String, String> {
    executor::command_queue()
        .map_err(str::to_string)?
        .enqueue_health(
            CommandRequest {
                id: request.id.clone(),
                command: request.command.clone(),
                params: Value::Null,
            },
            run_id,
        )
        .map_err(|error| match error {
            crate::exec::queue::QueueError::Full => "Execution queue is full".into(),
            crate::exec::queue::QueueError::Closed => "Execution queue is closed".into(),
        })
}

pub async fn exec(request: CommandRequest, inline: Option<String>) -> CommandResponse {
    let result = dispatch(&request, inline.as_deref()).await;
    response(request.id, result)
}

async fn dispatch(request: &CommandRequest, inline: Option<&str>) -> Result<Value, String> {
    // Validate before service initialization or touching persistence.
    let params = request.params.clone();
    match request.command.as_str() {
        "backup.health.create" => {
            let input: Create = parse(params)?;
            let service = service::get_service().await?;
            Ok(json!(
                service.create(&input.definition_path, input.mode).await?
            ))
        }
        "backup.health.run" => {
            let input: Run = parse(params)?;
            let service = service::get_service().await?;
            let (execution, execution_id) = service
                .run(&input.definition_path, |run_id| {
                    if let Some(execution_id) = inline {
                        Ok(execution_id.to_owned())
                    } else {
                        enqueue(request, run_id)
                    }
                })
                .await?;
            if inline.is_some() {
                service.execute(&execution.run_id).await?;
            }
            Ok(
                json!({"run_id": execution.run_id, "state": execution.state, "execution_id": execution_id}),
            )
        }
        "backup.health.start" => {
            let run_id = run_id(params)?;
            let service = service::get_service().await?;
            let (execution, execution_id) = service
                .start(&run_id, |run_id| enqueue(request, run_id))
                .await?;
            Ok(
                json!({"run_id": execution.run_id, "state": execution.state, "execution_id": execution_id}),
            )
        }
        "backup.health.get" | "backup.health.stop" | "backup.health.delete" => {
            let run_id = run_id(params)?;
            let service = service::get_service().await?;
            Ok(json!(match request.command.as_str() {
                "backup.health.get" => service.get(&run_id).await?,
                "backup.health.stop" => service.stop(&run_id).await?,
                _ => service.delete(&run_id).await?,
            }))
        }
        "backup.health.list" => {
            empty(&params)?;
            Ok(json!(service::get_service().await?.list().await?))
        }
        "backup.health.report.list" => {
            empty(&params)?;
            Ok(json!(service::get_service().await?.report_list().await?))
        }
        "backup.health.report.get" | "backup.health.report.delete" => {
            let run_id = run_id(params)?;
            let service = service::get_service().await?;
            if request.command == "backup.health.report.get" {
                let markdown = service.report_get(&run_id).await?;
                Ok(json!({"run_id": run_id, "markdown": markdown}))
            } else {
                service.report_delete(&run_id).await?;
                Ok(json!({"run_id": run_id, "deleted": true}))
            }
        }
        _ => Err(format!("Unknown command: {}", request.command)),
    }
}

pub async fn maintenance(request: CommandRequest) -> CommandResponse {
    let result = async {
        if request.params != json!({}) {
            return Err("internal health operation requires empty parameters".into());
        }
        let service = service::get_service().await?;
        let result = match request.command.as_str() {
            "backup.health.expire" => {
                crate::features::backup::health::maintenance::expire(service, chrono::Utc::now())
                    .await?
            }
            "backup.health.retain" => {
                crate::features::backup::health::maintenance::retain(service, chrono::Utc::now())
                    .await?
            }
            _ => return Err("Unknown internal health command".into()),
        };
        Ok(json!(result))
    }
    .await;
    response(request.id, result)
}

pub(crate) fn response(id: String, result: Result<Value, String>) -> CommandResponse {
    match result {
        Ok(data) => CommandResponse {
            id,
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        },
        Err(error) => CommandResponse {
            id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}
