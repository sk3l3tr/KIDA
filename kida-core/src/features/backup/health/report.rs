use std::fmt::Write;

use super::history::HealthHistoryRecord;

pub(super) fn render(record: &HealthHistoryRecord) -> String {
    let run = &record.execution;
    let mut out = format!("# Backup Health · {}\n\n", escape(&run.run_id));
    field(
        &mut out,
        "Definition",
        &format!("{} ({})", run.definition.name, run.definition.id),
    );
    field(
        &mut out,
        "Backup reference / requested version",
        &format!(
            "{} / {}",
            run.definition.backup.reference, run.definition.backup.version
        ),
    );
    field(
        &mut out,
        "Mode / operational state",
        &format!("{:?} / {:?}", run.mode, run.state),
    );
    field(
        &mut out,
        "Technical result",
        &format!("{:?}", run.diagnosis.result).to_uppercase(),
    );
    field(&mut out, "Summary", &run.diagnosis.summary);
    field(&mut out, "Created", &run.created_at);
    field(
        &mut out,
        "Started",
        run.started_at.as_deref().unwrap_or("not started"),
    );
    field(
        &mut out,
        "Finished",
        run.finished_at.as_deref().unwrap_or("unknown"),
    );
    if let (Some(start), Some(end)) = (&run.started_at, &run.finished_at)
        && let (Ok(start), Ok(end)) = (
            chrono::DateTime::parse_from_rfc3339(start),
            chrono::DateTime::parse_from_rfc3339(end),
        )
    {
        field(
            &mut out,
            "Duration (seconds)",
            &(end - start).num_seconds().to_string(),
        );
    }
    out.push_str("\n## Concrete backup\n\n");
    if let Some(artifact) = &run.artifact {
        field(
            &mut out,
            "Artifact / job",
            &format!("{} / {}", artifact.artifact_id, artifact.job_id),
        );
        field(&mut out, "Artifact created", &artifact.created_at);
        field(
            &mut out,
            "Artifact path",
            &artifact.path.display().to_string(),
        );
        field(&mut out, "SHA-256", &artifact.checksum);
        field(&mut out, "Bytes", &artifact.size.to_string());
    } else {
        out.push_str("Artifact could not be resolved; only partial evidence is available.\n");
    }
    out.push_str("\n## Compose and services\n\n");
    field(
        &mut out,
        "Compose path",
        &run.compose_path.display().to_string(),
    );
    field(
        &mut out,
        "Compose SHA-256",
        run.compose_checksum.as_deref().unwrap_or("unavailable"),
    );
    for service in &run.services {
        field(
            &mut out,
            &format!("Service {}", service.name),
            &format!(
                "image={}, replicas={}",
                if service.image.is_empty() {
                    "unavailable (build)"
                } else {
                    &service.image
                },
                service.replicas
            ),
        );
    }
    for service in &run.diagnosis.services {
        field(
            &mut out,
            &format!("Result {}", service.service),
            &format!("{:?}: {}", service.result, service.reasons.join("; ")),
        );
    }
    out.push_str("\n## Anomalies and evidence\n\n");
    for anomaly in &run.diagnosis.anomalies {
        let _ = writeln!(out, "- {}", escape(anomaly));
    }
    for evidence in &run.diagnosis.evidence {
        field(
            &mut out,
            &evidence.observed_at,
            &format!(
                "service={}, container={}: {}",
                evidence.service.as_deref().unwrap_or("-"),
                evidence.container_id.as_deref().unwrap_or("-"),
                evidence.description
            ),
        );
        if let Some(logs) = &evidence.logs {
            // A longer fence prevents log content from injecting Markdown/HTML.
            let longest = logs
                .split(|character| character != '`')
                .map(str::len)
                .max()
                .unwrap_or(0);
            let fence = "`".repeat((longest + 1).max(3));
            let _ = writeln!(out, "\n{fence}text\n{logs}\n{fence}\n");
        }
    }
    out.push_str("\n## Resources and cleanup\n\n");
    if let Some(project) = &run.project {
        field(
            &mut out,
            "Managed project / owner",
            &format!("{} / {}", project.project, project.owner),
        );
    }
    field(
        &mut out,
        "Restored directory",
        &run.restore_dir.display().to_string(),
    );
    if let Some(provenance) = &record.restore_provenance {
        field(
            &mut out,
            "Directory creation identity",
            &format!("{:?}", provenance.identity),
        );
    }
    for resource in &run.resources {
        field(&mut out, &resource.kind, &resource.identity);
    }
    field(
        &mut out,
        "Cleanup result",
        &format!("{:?}", run.cleanup.state),
    );
    for error in &run.cleanup.errors {
        field(&mut out, "Cleanup error", error);
    }
    out.push_str("\nThe administrator must validate the accessibility, logical integrity and functional correctness of the restored data. This report only evaluates technical backup health.\n");
    out
}

fn field(out: &mut String, key: &str, value: &str) {
    let _ = writeln!(out, "- **{}:** {}", escape(key), escape(value));
}

fn escape(value: &str) -> String {
    let mut out = String::new();
    for character in value.chars() {
        match character {
            '\n' | '\r' => out.push(' '),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '\\' | '`' | '*' | '_' | '[' | ']' | '|' | '#' => {
                out.push('\\');
                out.push(character);
            }
            _ => out.push(character),
        }
    }
    out
}
