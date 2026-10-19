use std::process::{Command, Output};

const LOGO: &str = "888    d8P  8888888 8888888b.";

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kida-cli"))
        .args(args)
        .env("NO_COLOR", "1")
        .output()
        .unwrap()
}

fn assert_banner_before_help(bytes: &[u8]) {
    let text = std::str::from_utf8(bytes).unwrap();
    assert!(text.starts_with(">< >< ><"), "{text}");
    assert_eq!(text.matches(LOGO).count(), 1, "{text}");
    assert!(text.contains(&format!("v{}", env!("CARGO_PKG_VERSION"))));
    assert!(text.contains("CLI"));
    assert!(text.find(LOGO).unwrap() < text.find("Usage:").unwrap());
}

#[test]
fn explicit_help_starts_with_banner_on_stdout() {
    for args in [
        vec!["--help"],
        vec!["-h"],
        vec!["help"],
        vec!["help", "help"],
        vec!["system", "help", "help"],
        vec!["system", "--help"],
        vec!["system", "powercicle", "-h"],
        vec!["help", "system", "powercicle"],
        vec!["docker", "container", "delete", "--help"],
        vec!["backup", "config", "create", "--help"],
        vec!["backup", "health", "report", "get", "--help"],
        vec!["scheduler", "add", "--help"],
    ] {
        let output = run(&args);
        assert_eq!(output.status.code(), Some(0), "{args:?}");
        assert!(output.stderr.is_empty(), "{args:?}");
        assert_banner_before_help(&output.stdout);
    }
}

#[test]
fn missing_subcommands_show_banner_on_stderr_and_exit_two() {
    for args in [
        vec![],
        vec!["system"],
        vec!["docker", "container"],
        vec!["backup", "health", "report"],
    ] {
        let output = run(&args);
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(output.stdout.is_empty(), "{args:?}");
        assert_banner_before_help(&output.stderr);
    }
}

#[test]
fn brief_errors_and_version_have_no_banner() {
    for args in [
        vec!["--unknown"],
        vec!["system", "shutdown"],
        vec!["backup", "health", "get"],
    ] {
        let output = run(&args);
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(output.stdout.is_empty());
        let text = std::str::from_utf8(&output.stderr).unwrap();
        assert!(text.contains("Usage:"));
        assert!(!text.contains(LOGO));
    }
    let output = run(&["--version"]);
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        format!("kida {}\n", env!("CARGO_PKG_VERSION"))
    );
}
