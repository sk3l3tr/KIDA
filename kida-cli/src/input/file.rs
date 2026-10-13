use std::{fs, path::Path};

use serde::de::DeserializeOwned;

use super::error::InputError;

pub fn read_toml<T: DeserializeOwned>(path: &Path) -> Result<T, InputError> {
    let content = fs::read_to_string(path)
        .map_err(|error| InputError::new(format!("cannot read file {}", path.display()), error))?;

    toml::from_str(&content)
        .map_err(|error| InputError::new(format!("invalid TOML in {}", path.display()), error))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use serde::Deserialize;

    use super::*;

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    #[derive(Debug, Deserialize, PartialEq)]
    struct Configuration {
        name: String,
        paths: Vec<String>,

        #[serde(default = "default_enabled")]
        enabled: bool,
    }

    fn default_enabled() -> bool {
        true
    }

    fn temporary_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kida-input-{}-{}.toml",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn load(content: &str) -> Result<Configuration, InputError> {
        let path = temporary_path();
        fs::write(&path, content).unwrap();

        let result = read_toml(&path);

        fs::remove_file(&path).unwrap();
        result
    }

    #[test]
    fn reads_typed_configuration_with_defaults_and_literal_paths() {
        let configuration = load(
            r#"
name = "daily"
paths = ["./etc/../hosts", "../backups"]
"#,
        )
        .unwrap();

        assert_eq!(
            configuration,
            Configuration {
                name: "daily".to_string(),
                paths: vec!["./etc/../hosts".to_string(), "../backups".to_string(),],
                enabled: true,
            }
        );
    }

    #[test]
    fn rejects_invalid_toml() {
        let error = load("name = [").unwrap_err().to_string();

        assert!(error.contains("invalid TOML in"));
    }

    #[test]
    fn rejects_invalid_field_types_with_context() {
        let error = load(
            r#"
name = "daily"
paths = []
enabled = "yes"
"#,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("invalid TOML in"));
        assert!(error.contains("enabled"));
    }

    #[test]
    fn rejects_missing_required_fields() {
        let error = load("paths = []").unwrap_err().to_string();

        assert!(error.contains("missing field"));
        assert!(error.contains("name"));
    }

    #[test]
    fn reports_unreadable_file_with_its_path() {
        let path = temporary_path();
        let error = read_toml::<Configuration>(&path).unwrap_err().to_string();

        assert!(error.contains("cannot read file"));
        assert!(error.contains(path.to_str().unwrap()));
    }
}
