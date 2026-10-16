use super::*;
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

const RUN: &str = "00000000-0000-4000-8000-000000000004";

#[test]
fn compose_health_with_isolated_fake_docker() {
    let root = std::env::temp_dir().join(format!("kida-health-compose-{}", Uuid::new_v4()));
    fs::create_dir_all(root.join("restore")).unwrap();
    fs::write(
        root.join("docker"),
        include_str!("../../docker/fake_docker.py"),
    )
    .unwrap();
    fs::set_permissions(root.join("docker"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(root.join("compose with spaces.yaml"), "services: {}\n").unwrap();
    fs::write(root.join("scenario"), "normal").unwrap();
    fs::write(
        root.join("config.toml"),
        format!(
            "[docker]\nownership_dir = {:?}\n",
            root.join("ownership").to_str().unwrap()
        ),
    )
    .unwrap();
    let mut paths = vec![root.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::backup::health::compose::tests::compose_health_child",
            "--ignored",
            "--nocapture",
        ])
        .env("KIDA_LIFECYCLE_DIR", &root)
        .env("KIDA_TEST_PROJECT", format!("kida-bh-{RUN}"))
        .env("KIDA_RESTORE_DIR", "ambient-restore")
        .env("COMPOSE_PROFILES", "optional")
        .env("COMPOSE_REMOVE_ORPHANS", "true")
        .env("PATH", std::env::join_paths(paths).unwrap())
        .output()
        .unwrap();
    fs::remove_dir_all(root).unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

fn model() -> Value {
    json!({
        "services": {
            "web": {"image": "example/web:1", "restart": "no", "scale": 2},
            "db": {"image": "example/db:1", "deploy": {"replicas": 1, "restart_policy": {"condition": "none"}}},
            "optional": {"profiles": ["optional"], "restart": "always"}
        },
        "networks": {"default": {"name": format!("kida-bh-{RUN}_default")}},
        "volumes": {"data": {"name": format!("kida-bh-{RUN}_data")}, "external": {"name": "shared", "external": true}}
    })
}

fn write_model(root: &Path, model: &Value) {
    fs::write(
        root.join("health-model.json"),
        serde_json::to_vec(model).unwrap(),
    )
    .unwrap();
}

async fn prepare(root: &Path) -> Result<HealthCompose, String> {
    HealthCompose::prepare(
        RUN,
        &root.join("compose with spaces.yaml"),
        &root.join("restore"),
        Duration::from_secs(10),
    )
    .await
}

fn state(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join("state")).unwrap()).unwrap()
}

fn mutations(root: &Path) -> usize {
    fs::read_to_string(root.join("calls"))
        .unwrap_or_default()
        .lines()
        .filter(|line| {
            let value: Value = serde_json::from_str(line).unwrap();
            value["args"]
                .as_array()
                .unwrap()
                .iter()
                .any(|arg| matches!(arg.as_str(), Some("create" | "start" | "stop" | "rm")))
        })
        .count()
}

#[tokio::test]
#[ignore = "fixture child; invoked by compose_health_with_isolated_fake_docker"]
async fn compose_health_child() {
    let root = PathBuf::from(std::env::var_os("KIDA_LIFECYCLE_DIR").unwrap());
    crate::infrastructure::conf::init(root.join("config.toml")).unwrap();
    let good = model();
    write_model(&root, &good);

    // Reject effective restart from either Compose spelling, before any mutation.
    for restart in [
        json!("always"),
        json!("unless-stopped"),
        json!("on-failure"),
    ] {
        let mut invalid = good.clone();
        invalid["services"]["web"]["restart"] = restart;
        write_model(&root, &invalid);
        assert!(
            prepare(&root)
                .await
                .err()
                .unwrap()
                .contains("automatic restart")
        );
    }
    for policy in [
        json!({}),
        json!({"condition": "any"}),
        json!({"condition": "on-failure"}),
    ] {
        let mut invalid = good.clone();
        invalid["services"]["db"]["deploy"]["restart_policy"] = policy;
        write_model(&root, &invalid);
        assert!(
            prepare(&root)
                .await
                .err()
                .unwrap()
                .contains("automatic restart")
        );
    }
    let mut inconsistent = good.clone();
    inconsistent["services"]["web"]["deploy"] = json!({"replicas": 3});
    write_model(&root, &inconsistent);
    assert!(prepare(&root).await.err().unwrap().contains("disagree"));
    let mut disabled = good.clone();
    disabled["services"] = json!({"optional": {"profiles": ["optional"]}});
    write_model(&root, &disabled);
    assert!(
        prepare(&root)
            .await
            .err()
            .unwrap()
            .contains("no enabled services")
    );
    assert_eq!(mutations(&root), 0);
    write_model(&root, &good);
    for (id, restore, budget) in [
        ("invalid", root.join("restore"), Duration::from_secs(10)),
        (RUN, PathBuf::from("relative"), Duration::from_secs(10)),
        (RUN, root.join("missing"), Duration::from_secs(10)),
        (RUN, root.join("restore"), Duration::ZERO),
    ] {
        assert!(
            HealthCompose::prepare(id, &root.join("compose with spaces.yaml"), &restore, budget)
                .await
                .is_err()
        );
    }

    let mut health = prepare(&root).await.unwrap();
    assert_eq!(
        health.configuration.file,
        root.join("compose with spaces.yaml")
    );
    assert_eq!(
        health.configuration.checksum,
        crate::features::backup::artifacts::sha256(&health.configuration.file).unwrap()
    );
    let services = health.services();
    assert_eq!(services.len(), 2); // Ambient optional profile is forcibly disabled.
    assert_eq!(services[0].name, "db");
    assert_eq!(services[1].image, "example/web:1");
    assert_eq!(services[1].replicas, 2);
    assert!(health.start().await.is_err());
    assert!(health.stop().await.is_err());
    assert!(health.remove().await.is_err());

    // A prepared inventory cannot silently describe a different project at create.
    let mut changed = good.clone();
    changed["services"]["web"]["scale"] = json!(3);
    write_model(&root, &changed);
    assert!(
        health
            .create()
            .await
            .unwrap_err()
            .contains("prepared configuration changed")
    );
    assert!(health.project.is_none());
    write_model(&root, &good);
    let original = fs::read(&health.configuration.file).unwrap();
    fs::write(&health.configuration.file, "services: {}\n# changed\n").unwrap();
    assert!(
        health
            .create()
            .await
            .unwrap_err()
            .contains("prepared configuration changed")
    );
    assert!(health.project.is_none());
    fs::write(&health.configuration.file, original).unwrap();
    health.create().await.unwrap();
    let reference = health.project.clone().unwrap();
    assert_eq!(
        reference,
        DockerService::compose_managed_project(&format!("kida-bh-{RUN}"))
            .await
            .unwrap()
    );
    assert_eq!(health.resources.len(), 5); // 3 replicas, network, exclusive volume.
    assert_eq!(
        health
            .resources
            .iter()
            .filter(|resource| resource.kind == "container")
            .count(),
        3
    );
    let before = mutations(&root);
    assert!(health.create().await.is_err());
    assert_eq!(mutations(&root), before);
    let mut conflict = prepare(&root).await.unwrap();
    assert!(conflict.create().await.is_err());
    assert!(conflict.project.is_none()); // Never adopt a prior ownership record.

    changed = good.clone();
    changed["services"]["web"]["restart"] = json!("always");
    write_model(&root, &changed);
    assert!(
        health
            .start()
            .await
            .unwrap_err()
            .contains("automatic restart")
    );
    assert_eq!(mutations(&root), before);
    write_model(&root, &good);
    fs::write(root.join("scenario"), "start-error").unwrap();
    assert!(health.start().await.is_err());
    assert_eq!(health.project, Some(reference.clone()));
    fs::write(root.join("scenario"), "normal").unwrap();
    health.start().await.unwrap();
    assert!(
        state(&root)["container"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["State"]["Running"] == true)
    );
    // Removal has no permission to kill running resources.
    let _ = health.remove().await;
    assert_eq!(state(&root)["container"].as_array().unwrap().len(), 3);
    health.stop().await.unwrap();

    // Copied ownership labels are not creation evidence and cannot authorize removal.
    let proven = state(&root);
    let mut ambiguous = proven.clone();
    let mut impostor = proven["volume"][0].clone();
    impostor["Name"] = json!("unproven-volume");
    ambiguous["volume"].as_array_mut().unwrap().push(impostor);
    fs::write(root.join("state"), serde_json::to_vec(&ambiguous).unwrap()).unwrap();
    let before = mutations(&root);
    assert!(health.remove().await.is_err());
    assert_eq!(mutations(&root), before);
    assert_eq!(state(&root), ambiguous);
    fs::write(root.join("state"), serde_json::to_vec(&proven).unwrap()).unwrap();

    // Foreign usage preserves owned-but-shared resources; an external volume also survives.
    let mut shared = state(&root);
    let mut foreign = shared["container"][0].clone();
    foreign["Id"] = json!("f".repeat(64));
    foreign["Config"]["Labels"] = json!({"com.docker.compose.project": "production"});
    shared["container"]
        .as_array_mut()
        .unwrap()
        .push(foreign.clone());
    shared["network"][0]["Containers"] = json!({"foreign": {}});
    let mut external = shared["volume"][0].clone();
    external["Name"] = json!("shared");
    external["Labels"] = json!({"production": "true"});
    shared["volume"]
        .as_array_mut()
        .unwrap()
        .push(external.clone());
    fs::write(root.join("state"), serde_json::to_vec(&shared).unwrap()).unwrap();
    let report = health.remove().await.unwrap();
    assert_eq!(report.removed.len(), 3);
    assert!(report.preserved.len() >= 3);
    let retained = state(&root);
    assert_eq!(retained["container"], json!([foreign]));
    assert!(retained["volume"].as_array().unwrap().contains(&external));
    health.remove().await.unwrap(); // Repeat preserves foreign resources again.
    let mut exclusive = retained;
    exclusive["container"] = json!([]);
    exclusive["network"][0]["Containers"] = json!({});
    fs::write(root.join("state"), serde_json::to_vec(&exclusive).unwrap()).unwrap();
    let report = health.remove().await.unwrap();
    assert_eq!(report.removed.len(), 2);
    assert_eq!(state(&root)["volume"], json!([external]));
    assert!(health.remove().await.unwrap().removed.is_empty());

    // A partial create retains exactly its reserved identity and captured evidence.
    fs::remove_file(root.join("state")).unwrap();
    fs::write(root.join("scenario"), "partial-create").unwrap();
    let mut partial = prepare(&root).await.unwrap();
    assert!(
        partial
            .create()
            .await
            .unwrap_err()
            .contains("resources may be partial")
    );
    assert!(partial.project.is_some());
    assert_ne!(partial.project, health.project);
    assert_eq!(partial.resources.len(), 5);
    fs::write(root.join("scenario"), "normal").unwrap();
    let before = mutations(&root);
    assert!(health.start().await.unwrap_err().contains("owner changed"));
    assert!(health.stop().await.unwrap_err().contains("owner changed"));
    assert_eq!(mutations(&root), before);
    assert!(health.remove().await.unwrap().removed.is_empty());
    assert_eq!(partial.remove().await.unwrap().removed.len(), 5);

    // Variables are child-only, bounded execution uses the existing runner.
    fs::write(root.join("scenario"), "timeout-check").unwrap();
    assert!(
        HealthCompose::prepare(
            RUN,
            &root.join("compose with spaces.yaml"),
            &root.join("restore"),
            Duration::from_millis(100)
        )
        .await
        .err()
        .unwrap()
        .contains("timeout")
    );
    assert_eq!(
        std::env::var("KIDA_RESTORE_DIR").unwrap(),
        "ambient-restore"
    );
    for line in fs::read_to_string(root.join("calls")).unwrap().lines() {
        let value: Value = serde_json::from_str(line).unwrap();
        if value["args"][0] == "compose" {
            assert_eq!(value["restore_dir"], root.join("restore").to_str().unwrap());
        }
        assert_eq!(value["profiles"], "");
        assert_eq!(value["remove_orphans"], "false");
        let args = value["args"].as_array().unwrap();
        assert!(
            !args
                .iter()
                .any(|arg| matches!(arg.as_str(), Some("down" | "prune" | "--force" | "-v")))
        );
    }
}
