// Must implement tests cases here! Do not implement tests inside source files!
use serde_json::json;

use crate::exec::executor;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandStatus};

#[tokio::test]
async fn wake_capabilities_returns_diagnostic_through_executor() {
    assert!(executor::is_registered("system.wake_capabilities"));

    let response = executor::execute(CommandRequest {
        id: "wake-diagnostic".to_string(),
        command: "system.wake_capabilities".to_string(),
        params: json!({}),
    })
    .await;

    assert_eq!(response.id, "wake-diagnostic");
    assert!(matches!(response.status, CommandStatus::Ok));
    assert!(response.error.is_none());

    let data = response.data.unwrap();
    assert_eq!(data["s5_wake_status"], "unverified");
    assert!(!data["warnings"].as_array().unwrap().is_empty());

    for field in ["rtcwake_available", "rtc_alarm_available"] {
        assert!(data.get(field).is_some());
        assert!(data[field].is_boolean() || data[field].is_null());
    }

    assert!(data.get("rtc_device").is_some());
    assert!(data["rtc_device"].is_string() || data["rtc_device"].is_null());
}

#[tokio::test]
async fn wake_capabilities_rejects_invalid_params() {
    for params in [json!(null), json!([]), json!({"extra": true})] {
        let response = executor::execute(CommandRequest {
            id: "invalid-diagnostic".to_string(),
            command: "system.wake_capabilities".to_string(),
            params,
        })
        .await;

        assert_eq!(response.id, "invalid-diagnostic");
        assert!(matches!(response.status, CommandStatus::Error));
        assert!(response.data.is_none());
        assert!(response.error.is_some());
    }
}

#[tokio::test]
async fn power_cycle_returns_validation_errors_through_executor() {
    assert!(executor::is_registered("system.power_cycle"));

    for params in [
        json!(null),
        json!({}),
        json!({"wake_time": "24:00"}),
        json!({"wake_after_seconds": 119}),
        json!({"wake_time": "06:00", "wake_after_seconds": 120}),
        json!({"wake_after_seconds": 120, "extra": true}),
        json!({"wake_after_seconds": u64::MAX}),
    ] {
        let response = executor::execute(CommandRequest {
            id: "invalid-power-cycle".to_string(),
            command: "system.power_cycle".to_string(),
            params,
        })
        .await;

        assert_eq!(response.id, "invalid-power-cycle");
        assert!(matches!(response.status, CommandStatus::Error));
        assert!(response.data.is_none());

        let error = response.error.as_deref().unwrap();
        assert!(!error.is_empty());
        assert!(!error.contains("Unknown command"));

        let serialized = serde_json::to_value(response).unwrap();
        assert_eq!(serialized["status"], "ERROR");
        assert!(serialized.get("data").is_none());
        assert!(serialized["error"].is_string());
    }
}
