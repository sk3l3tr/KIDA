use super::*;
use crate::features::docker::{
    ComposeContainerDiagnostics, ContainerDiagnosticError, ContainerDiagnostics, DockerContainer,
};

fn service(name: &str, replicas: u32) -> HealthService {
    HealthService {
        name: name.into(),
        image: "example:1".into(),
        replicas,
    }
}
fn session(expected: Vec<HealthService>) -> DiagnosticSession {
    DiagnosticSession::new(
        "test-project".into(),
        expected,
        EvidencePolicy::new(vec!["secret-token".into()], true),
    )
}
fn row(name: &str, id: &str, health: Option<&str>) -> ComposeContainerDiagnostics {
    ComposeContainerDiagnostics {
        service: Some(name.into()),
        diagnostics: ContainerDiagnostics {
            container: DockerContainer {
                id: id.into(),
                name: id.into(),
                image: "example:1".into(),
                online: true,
                status: "running".into(),
                health: health.map(str::to_owned),
                started_at: None,
                finished_at: None,
                exit_code: Some(0),
                restart_count: 0,
                restart_policy: Some("no".into()),
                ports: vec![],
                networks: vec![],
            },
            oom_killed: Some(false),
            docker_error: None,
        },
    }
}
fn snapshot(rows: Vec<ComposeContainerDiagnostics>) -> ComposeDiagnostics {
    ComposeDiagnostics {
        project: "test-project".into(),
        containers: rows,
        errors: vec![],
    }
}

#[test]
fn every_pair_obeys_the_full_result_priority() {
    let order = [
        ResultKind::Failed,
        ResultKind::Unhealthy,
        ResultKind::Unknown,
        ResultKind::Degraded,
        ResultKind::Healthy,
    ];
    for (a, first) in order.iter().enumerate() {
        for (b, second) in order.iter().enumerate() {
            assert_eq!(aggregate([*first, *second]), order[a.min(b)]);
        }
    }
    assert_eq!(aggregate([]), ResultKind::Unknown);
}

#[test]
fn all_required_replicas_need_successful_healthchecks() {
    for (health, expected) in [
        (None, ResultKind::Unknown),
        (Some("starting"), ResultKind::Unknown),
        (Some("unhealthy"), ResultKind::Unhealthy),
        (Some("healthy"), ResultKind::Healthy),
    ] {
        let mut session = session(vec![service("app", 2)]);
        let result = session.evaluate(
            Ok(&snapshot(vec![
                row("app", "1", health),
                row("app", "2", Some("healthy")),
            ])),
            EvaluationPhase::Observing,
            "now",
        );
        assert_eq!(result.result, expected);
        assert_eq!(result.complete, expected != ResultKind::Unknown);
    }
    let mut session = session(vec![service("app", 2)]);
    let missing = session.evaluate(
        Ok(&snapshot(vec![row("app", "1", Some("healthy"))])),
        EvaluationPhase::Observing,
        "now",
    );
    assert_eq!(missing.result, ResultKind::Failed);
}

#[test]
fn partial_inspection_cannot_prove_absence_or_health() {
    let mut session = session(vec![service("app", 2)]);
    let mut observation = snapshot(vec![row("app", "1", Some("healthy"))]);
    observation.errors.push(ContainerDiagnosticError {
        id: "2".into(),
        error: "secret-token".into(),
    });
    assert_eq!(
        session
            .evaluate(Ok(&observation), EvaluationPhase::Observing, "now")
            .result,
        ResultKind::Unknown
    );
    observation.containers[0].diagnostics.container.status = "exited".into();
    assert_eq!(
        session
            .evaluate(Ok(&observation), EvaluationPhase::Observing, "now")
            .result,
        ResultKind::Failed
    );
}

#[test]
fn exit_zero_and_docker_errors_are_failures_while_requested_stops_are_not() {
    let mut stopped = snapshot(vec![row("app", "1", Some("healthy"))]);
    stopped.containers[0].diagnostics.container.status = "exited".into();
    stopped.containers[0].diagnostics.container.online = false;
    for phase in [EvaluationPhase::RequestedStop, EvaluationPhase::Interrupted] {
        assert_eq!(
            session(vec![service("app", 1)])
                .evaluate(Ok(&stopped), phase, "now")
                .result,
            ResultKind::Unknown
        );
        let mut completed = session(vec![service("app", 1)]);
        completed.evaluate(
            Ok(&snapshot(vec![row("app", "1", Some("healthy"))])),
            EvaluationPhase::Observing,
            "before-stop",
        );
        assert_eq!(
            completed.evaluate(Ok(&stopped), phase, "now").result,
            ResultKind::Healthy
        );
    }
    let mut session = session(vec![service("app", 1)]);
    assert_eq!(
        session
            .evaluate(Ok(&stopped), EvaluationPhase::Observing, "now")
            .result,
        ResultKind::Failed
    );
    assert_eq!(
        session
            .evaluate(Err("interrupted"), EvaluationPhase::Interrupted, "now")
            .result,
        ResultKind::Failed
    );
    let mut broken = snapshot(vec![row("app", "1", Some("healthy"))]);
    broken.containers[0].diagnostics.docker_error = Some("start failed".into());
    assert_eq!(
        session
            .evaluate(Ok(&broken), EvaluationPhase::Observing, "now")
            .result,
        ResultKind::Failed
    );
}

#[test]
fn recovered_oom_and_restarts_remain_degraded_without_affecting_other_services() {
    let mut session = session(vec![service("app", 1), service("db", 1)]);
    let mut observation = snapshot(vec![
        row("app", "1", Some("starting")),
        row("db", "2", Some("healthy")),
    ]);
    observation.containers[0].diagnostics.oom_killed = Some(true);
    observation.containers[0]
        .diagnostics
        .container
        .restart_count = 2;
    assert_eq!(
        session
            .evaluate(Ok(&observation), EvaluationPhase::Observing, "now")
            .result,
        ResultKind::Unknown
    );
    observation.containers[0] = row("app", "3", Some("healthy"));
    let result = session.evaluate(Ok(&observation), EvaluationPhase::Observing, "later");
    assert_eq!(result.result, ResultKind::Degraded);
    assert_eq!(result.services[0].result, ResultKind::Degraded);
    assert_eq!(result.services[1].result, ResultKind::Healthy);
    assert_eq!(result.anomalies.len(), 1);
    assert_eq!(
        session
            .evaluate(Ok(&observation), EvaluationPhase::Observing, "later")
            .anomalies
            .len(),
        1
    );
}

#[test]
fn unknown_projects_duplicates_extra_services_and_empty_inventories_never_pass() {
    for variant in [
        "wrong-project",
        "duplicate",
        "extra",
        "offline",
        "paused",
        "zero",
        "empty",
    ] {
        let mut observation = snapshot(vec![row("app", "1", Some("healthy"))]);
        let expected = match variant {
            "empty" => vec![],
            "zero" => vec![service("app", 0)],
            _ => vec![service("app", 1)],
        };
        match variant {
            "wrong-project" => observation.project = "foreign".into(),
            "duplicate" => observation
                .containers
                .push(row("app", "1", Some("healthy"))),
            "extra" => observation
                .containers
                .push(row("other", "2", Some("healthy"))),
            "offline" => observation.containers[0].diagnostics.container.online = false,
            "paused" => observation.containers[0].diagnostics.container.status = "paused".into(),
            _ => (),
        }
        assert_eq!(
            session(expected)
                .evaluate(Ok(&observation), EvaluationPhase::TimedOut, "now")
                .result,
            ResultKind::Unknown,
            "{variant}"
        );
    }
}

#[tokio::test]
async fn polls_until_checks_pass_or_global_deadline_expires() {
    assert!(
        session(vec![service("app", 1)])
            .diagnose(Duration::ZERO)
            .await
            .is_err()
    );
    let mut count = 0;
    let result = session(vec![service("app", 1)])
        .observe_until(Duration::from_secs(1), Duration::from_millis(1), |_| {
            count += 1;
            std::future::ready(Ok(snapshot(vec![row(
                "app",
                "1",
                Some(if count == 1 { "starting" } else { "healthy" }),
            )])))
        })
        .await
        .unwrap();
    assert_eq!(result.result, ResultKind::Healthy);
    assert_eq!(count, 2);
    let start = tokio::time::Instant::now();
    let result = session(vec![service("app", 1)])
        .observe_until(
            Duration::from_millis(20),
            Duration::from_millis(1),
            |_| async { std::future::pending::<Result<ComposeDiagnostics, String>>().await },
        )
        .await
        .unwrap();
    assert_eq!(result.result, ResultKind::Unknown);
    assert!(result.complete);
    assert!(start.elapsed() < Duration::from_secs(1));
    let result = session(vec![service("app", 1)])
        .observe_until(Duration::from_millis(10), Duration::from_millis(1), |_| {
            std::future::ready(Ok(snapshot(vec![row("app", "1", None)])))
        })
        .await
        .unwrap();
    assert_eq!(result.result, ResultKind::Unknown);
    assert!(result.complete);
}

#[test]
fn failures_and_evidence_are_redacted_bounded_and_never_interpret_logs() {
    let mut session = session(vec![service("app", 1)]);
    assert_eq!(
        session
            .fail("Compose failed with secret-token", "now")
            .result,
        ResultKind::Failed
    );
    let logs = ContainerLogs {
        container: "id".into(),
        tail: 100,
        stdout: ("secret-token ERROR healthy ".repeat(4000)).into_bytes(),
        stderr: vec![],
        warning: String::new(),
    };
    for _ in 0..10 {
        session.capture_logs("now", Some("app"), &logs);
    }
    let encoded = serde_json::to_string(&session.diagnosis).unwrap();
    assert!(!encoded.contains("secret-token"));
    assert!(encoded.contains("[REDACTED]"));
    assert!(
        session
            .diagnosis
            .evidence
            .iter()
            .filter_map(|evidence| evidence.logs.as_ref())
            .map(String::len)
            .sum::<usize>()
            <= super::super::evidence::TOTAL_LOG_BYTES
    );
    assert_eq!(session.diagnosis.result, ResultKind::Failed);
    let mut policy = EvidencePolicy::default();
    assert!(policy.logs(&logs).is_err());
    let mut policy = EvidencePolicy::new(vec![], true);
    let invalid = ContainerLogs {
        stdout: vec![255],
        ..logs
    };
    assert!(policy.logs(&invalid).is_err());
    for _ in 0..200 {
        session.capture_logs("now", None, &invalid);
    }
    assert_eq!(session.diagnosis.evidence.len(), 128);
}
