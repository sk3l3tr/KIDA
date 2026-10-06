use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{Value, json};

pub struct SystemCollectorService;
impl SystemCollectorService {
    pub fn collect_hwmon() -> Result<Vec<Value>, String> {
        let root = Path::new("/sys/class/hwmon");

        if !root.exists() {
            return Ok(Vec::new());
        }

        let entries = fs::read_dir(root).map_err(|e| format!("Cannot read hwmon: {e}"))?;

        let mut sensors = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();

            let device_name =
                read_string(path.join("name")).unwrap_or_else(|| "unknown".to_string());

            collect_temperatures(&path, &device_name, &mut sensors);
            collect_fans(&path, &device_name, &mut sensors);
        }

        Ok(sensors)
    }

    pub fn calculate_overall_status(sensors: &[Value]) -> &'static str {
        let mut warning = false;

        for sensor in sensors {
            match sensor.get("status").and_then(Value::as_str) {
                Some("CRITICAL") => return "CRITICAL",
                Some("WARNING") => warning = true,
                _ => {}
            }
        }

        if warning { "WARNING" } else { "OK" }
    }
}
fn collect_temperatures(path: &Path, device_name: &str, sensors: &mut Vec<Value>) {
    for index in 1..=32 {
        let input_path = path.join(format!("temp{index}_input"));

        if !input_path.exists() {
            continue;
        }

        let Some(raw) = read_i64(input_path) else {
            continue;
        };

        let value = raw as f64 / 1000.0;

        let label = read_string(path.join(format!("temp{index}_label")))
            .unwrap_or_else(|| format!("temp{index}"));

        let max = read_i64(path.join(format!("temp{index}_max"))).map(|v| v as f64 / 1000.0);

        let critical = read_i64(path.join(format!("temp{index}_crit"))).map(|v| v as f64 / 1000.0);

        let alarm = read_i64(path.join(format!("temp{index}_alarm")))
            .map(|v| v != 0)
            .unwrap_or(false);

        let status = temperature_status(value, max, critical, alarm);

        sensors.push(json!({
            "type": "temperature",
            "device": device_name,
            "label": label,
            "value": value,
            "unit": "C",
            "max": max,
            "critical": critical,
            "alarm": alarm,
            "status": status,
        }));
    }
}

fn collect_fans(path: &Path, device_name: &str, sensors: &mut Vec<Value>) {
    for index in 1..=32 {
        let input_path = path.join(format!("fan{index}_input"));

        if !input_path.exists() {
            continue;
        }

        let Some(rpm) = read_i64(input_path) else {
            continue;
        };

        let label = read_string(path.join(format!("fan{index}_label")))
            .unwrap_or_else(|| format!("fan{index}"));

        let alarm = read_i64(path.join(format!("fan{index}_alarm")))
            .map(|v| v != 0)
            .unwrap_or(false);

        let fault = read_i64(path.join(format!("fan{index}_fault")))
            .map(|v| v != 0)
            .unwrap_or(false);

        let status = if alarm || fault { "CRITICAL" } else { "OK" };

        sensors.push(json!({
            "type": "fan",
            "device": device_name,
            "label": label,
            "value": rpm,
            "unit": "RPM",
            "alarm": alarm,
            "fault": fault,
            "status": status,
        }));
    }
}

fn temperature_status(
    value: f64,
    max: Option<f64>,
    critical: Option<f64>,
    alarm: bool,
) -> &'static str {
    if alarm {
        return "CRITICAL";
    }

    if let Some(critical) = critical {
        if value >= critical {
            return "CRITICAL";
        }
    }

    if let Some(max) = max {
        if value >= max {
            return "WARNING";
        }
    }

    "OK"
}

fn read_string(path: PathBuf) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn read_i64(path: PathBuf) -> Option<i64> {
    read_string(path)?.parse().ok()
}
