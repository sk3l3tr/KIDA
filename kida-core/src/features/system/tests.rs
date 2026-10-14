// Must implement tests cases here! Do not implement tests inside source files!
use super::model::PowerCycleRequest;
use serde_json::json;

#[test]
fn power_cycle_accepts_valid_parameters() {
    assert_eq!(
        PowerCycleRequest::try_from(json!({"wake_time": "06:00"})).unwrap(),
        PowerCycleRequest::WakeTime(chrono::NaiveTime::from_hms_opt(6, 0, 0).unwrap()),
    );

    for seconds in [120_u64, 28800] {
        assert_eq!(
            PowerCycleRequest::try_from(json!({"wake_after_seconds": seconds})).unwrap(),
            PowerCycleRequest::WakeAfterSeconds(seconds),
        );
    }
}

#[test]
fn power_cycle_rejects_invalid_parameters() {
    for params in [
        json!(null),
        json!([]),
        json!({}),
        json!({"wake_time": "06:00", "wake_after_seconds": 120}),
        json!({"wake_time": "06:00", "extra": true}),
        json!({"unknown": 120}),
        json!({"wake_time": null}),
        json!({"wake_time": 600}),
        json!({"wake_time": "6:00"}),
        json!({"wake_time": "06:00:00"}),
        json!({"wake_time": "24:00"}),
        json!({"wake_time": "12:60"}),
        json!({"wake_after_seconds": null}),
        json!({"wake_after_seconds": "120"}),
        json!({"wake_after_seconds": 120.5}),
        json!({"wake_after_seconds": -120}),
        json!({"wake_after_seconds": 0}),
        json!({"wake_after_seconds": 119}),
    ] {
        assert!(
            PowerCycleRequest::try_from(params.clone()).is_err(),
            "Unexpected acceptance: {params}",
        );
    }
}

fn calculate_test_wake(
    params: serde_json::Value,
    now: &str,
) -> Result<chrono::DateTime<chrono::Utc>, String> {
    let request = PowerCycleRequest::try_from(params)?;
    let now = chrono::DateTime::parse_from_rfc3339(now)
        .unwrap()
        .with_timezone(&chrono_tz::Europe::Madrid);

    super::SystemPower::calculate_wake_at(&request, &now)
}

#[test]
fn power_cycle_calculates_next_real_occurrence() {
    for (now, wake_time, expected) in [
        (
            "2026-10-14T05:58:00+02:00",
            "06:00",
            "2026-10-14T06:00:00+02:00",
        ),
        (
            "2026-10-14T06:00:00+02:00",
            "06:00",
            "2026-10-15T06:00:00+02:00",
        ),
        (
            "2026-03-29T01:00:00+01:00",
            "02:30",
            "2026-03-30T02:30:00+02:00",
        ),
        (
            "2026-10-25T01:00:00+02:00",
            "02:30",
            "2026-10-25T02:30:00+02:00",
        ),
        (
            "2026-10-25T02:45:00+02:00",
            "02:30",
            "2026-10-25T02:30:00+01:00",
        ),
        (
            "2026-10-25T02:45:00+01:00",
            "02:30",
            "2026-10-26T02:30:00+01:00",
        ),
    ] {
        let actual = calculate_test_wake(json!({"wake_time": wake_time}), now).unwrap();
        let expected = chrono::DateTime::parse_from_rfc3339(expected)
            .unwrap()
            .with_timezone(&chrono::Utc);

        assert_eq!(actual, expected, "Execution time: {now}");
    }
}

#[test]
fn power_cycle_rejects_insufficient_time_margin() {
    for now in ["2026-10-14T05:58:01+02:00", "2026-10-14T05:58:00.001+02:00"] {
        assert!(calculate_test_wake(json!({"wake_time": "06:00"}), now).is_err());
    }
}

#[test]
fn power_cycle_relative_time_uses_elapsed_seconds() {
    let actual = calculate_test_wake(
        json!({"wake_after_seconds": 120}),
        "2026-10-25T02:59:00+02:00",
    )
    .unwrap();

    let expected = chrono::DateTime::parse_from_rfc3339("2026-10-25T02:01:00+01:00")
        .unwrap()
        .with_timezone(&chrono::Utc);

    assert_eq!(actual, expected);
}

#[test]
fn power_cycle_rejects_relative_time_overflow() {
    assert!(
        calculate_test_wake(
            json!({"wake_after_seconds": u64::MAX}),
            "2026-10-14T00:00:00+02:00",
        )
        .is_err()
    );
}

#[test]
fn power_cycle_rounds_relative_wake_up_to_whole_seconds() {
    for (now, expected) in [
        ("2026-10-14T00:00:00+02:00", "2026-10-14T00:02:00+02:00"),
        ("2026-10-14T00:00:00.001+02:00", "2026-10-14T00:02:01+02:00"),
        ("2026-10-14T00:00:00.999+02:00", "2026-10-14T00:02:01+02:00"),
    ] {
        let actual = calculate_test_wake(json!({"wake_after_seconds": 120}), now).unwrap();

        let expected = chrono::DateTime::parse_from_rfc3339(expected)
            .unwrap()
            .with_timezone(&chrono::Utc);
        let execution = chrono::DateTime::parse_from_rfc3339(now)
            .unwrap()
            .with_timezone(&chrono::Utc);

        assert_eq!(actual, expected);
        assert_eq!(actual.timestamp_subsec_nanos(), 0);
        assert!(actual.signed_duration_since(execution) >= chrono::TimeDelta::seconds(120));
    }
}

#[test]
fn power_cycle_rejects_rounding_beyond_supported_date() {
    let now = chrono::DateTime::<chrono::Utc>::MAX_UTC - chrono::TimeDelta::milliseconds(120_500);

    let result =
        super::SystemPower::calculate_wake_at(&PowerCycleRequest::WakeAfterSeconds(120), &now);

    assert!(result.is_err());
}

#[test]
fn power_cycle_rtc_alarm_matches_programmed_calendar_time() {
    for (date, alarm) in [
        ("Thu Oct 15 04:00:00 2026", "1792036800\n"),
        ("Thu Oct 15 06:00:00 2026", "1792044000\n"),
        ("Thu Oct 15 03:59:58 2026", "1792036798\n"),
    ] {
        let stdout = format!(
            "rtcwake: assuming RTC uses UTC ...\n\
             rtcwake: wakeup using /dev/rtc0 at {date}\n"
        );

        assert!(super::power::verify_rtc_alarm(&stdout, alarm).is_ok());
    }
}

#[test]
fn power_cycle_rtc_alarm_rejects_disabled_invalid_or_different_alarm() {
    let stdout = "rtcwake: wakeup using /dev/rtc0 at Thu Oct 15 04:00:00 2026\n";

    for alarm in ["", "\n", "0\n", "invalid\n", "1792036801\n"] {
        assert!(
            super::power::verify_rtc_alarm(stdout, alarm).is_err(),
            "Unexpected acceptance: {alarm:?}",
        );
    }
}

#[test]
fn power_cycle_rtc_alarm_rejects_unconfirmable_output() {
    let valid = "rtcwake: wakeup using /dev/rtc0 at Thu Oct 15 04:00:00 2026\n";
    let duplicate = format!("{valid}{valid}");

    for stdout in [
        "",
        "rtcwake: wakeup using /dev/rtc1 at Thu Oct 15 04:00:00 2026\n",
        "rtcwake: wakeup using /dev/rtc0 at invalid\n",
        duplicate.as_str(),
    ] {
        assert!(super::power::verify_rtc_alarm(stdout, "1792036800").is_err());
    }
}

#[test]
fn power_cycle_rtc_programming_rejects_invalid_timestamps_before_access() {
    for (timestamp, expected_error) in [
        (
            "2020-01-01T00:00:00.001Z",
            "Wake timestamp must use whole seconds",
        ),
        (
            "2020-01-01T00:00:00Z",
            "Wake timestamp must be in the future",
        ),
    ] {
        let wake_at = chrono::DateTime::parse_from_rfc3339(timestamp)
            .unwrap()
            .with_timezone(&chrono::Utc);

        let error = super::SystemPower::program_rtc_alarm(&wake_at).unwrap_err();

        assert_eq!(error, expected_error);
    }
}

#[test]
fn power_cycle_requests_shutdown_only_after_verified_alarm() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T00:00:00+02:00").unwrap();
    let operations = std::cell::RefCell::new(Vec::new());

    let result = super::SystemPower::power_cycle_with(
        &PowerCycleRequest::WakeAfterSeconds(120),
        &now,
        |_| {
            operations.borrow_mut().push("rtc");
            Ok(())
        },
        |when| {
            assert_eq!(when, "+1");
            operations.borrow_mut().push("shutdown");
            Ok(super::power::PowerResult {
                scheduled: true,
                when: when.to_string(),
            })
        },
    )
    .unwrap();

    assert_eq!(operations.into_inner(), vec!["rtc", "shutdown"]);
    assert_eq!(result.wake_at, "2026-10-14T00:02:00+02:00");
    assert!(result.shutdown_scheduled);
    assert_eq!(result.s5_wake_status, "unverified");
}

#[test]
fn power_cycle_rtc_failure_prevents_shutdown() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T00:00:00+02:00").unwrap();

    let error = super::SystemPower::power_cycle_with(
        &PowerCycleRequest::WakeAfterSeconds(120),
        &now,
        |_| Err("RTC verification failed".to_string()),
        |_| panic!("Shutdown must not be requested after RTC failure"),
    )
    .unwrap_err();

    assert_eq!(error, "RTC verification failed");
}

#[test]
fn power_cycle_shutdown_failure_warns_about_active_alarm() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T00:00:00+02:00").unwrap();

    for shutdown_result in [
        Err("shutdown denied".to_string()),
        Ok(super::power::PowerResult {
            scheduled: false,
            when: "+1".to_string(),
        }),
    ] {
        let error = super::SystemPower::power_cycle_with(
            &PowerCycleRequest::WakeAfterSeconds(120),
            &now,
            |_| Ok(()),
            |when| {
                assert_eq!(when, "+1");
                shutdown_result
            },
        )
        .unwrap_err();

        assert!(error.contains("RTC alarm may remain active"));
    }
}

#[test]
fn power_cycle_insufficient_margin_prevents_both_operations() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-14T05:59:00+02:00").unwrap();
    let request = PowerCycleRequest::try_from(json!({"wake_time": "06:00"})).unwrap();

    assert!(
        super::SystemPower::power_cycle_with(
            &request,
            &now,
            |_| panic!("RTC must not be programmed with insufficient margin"),
            |_| panic!("Shutdown must not be requested with insufficient margin"),
        )
        .is_err()
    );
}

#[test]
fn power_cycle_existing_scheduler_preserves_params_and_execution_time() {
    use chrono::{TimeDelta, Utc};

    use crate::{
        exec::queue::CommandQueue,
        features::scheduler::{
            model::{NewSchedule, ScheduleRule},
            service::ScheduleService,
        },
    };

    crate::conf::tests::init_test_config();

    let created = chrono::DateTime::parse_from_rfc3339(
        "2026-10-14T12:00:00Z",
    ).unwrap().with_timezone(&Utc);
    let params = json!({"wake_after_seconds": 28800});

    for rule in [
        ScheduleRule::Once {
            at: (created + TimeDelta::seconds(60)).to_rfc3339(),
        },
        ScheduleRule::Interval { seconds: 60 },
        ScheduleRule::Cron {
            expression: "* * * * *".to_string(),
            timezone: "UTC".to_string(),
        },
    ] {
        let recurring = !matches!(&rule, ScheduleRule::Once { .. });
        let path = std::env::temp_dir().join(format!(
            "kida-power-cycle-scheduler-{}.toml",
            uuid::Uuid::new_v4(),
        ));
        let mut service = ScheduleService::load(&path, created).unwrap();

        service.add(
            NewSchedule {
                command: "system.power_cycle".to_string(),
                params: params.clone(),
                schedule: rule,
            },
            created,
        ).unwrap();

        // Exercise the scheduler's existing persistence and reload.
        let mut service = ScheduleService::load(&path, created).unwrap();
        let (queue, mut receiver) = CommandQueue::new();

        for elapsed in [60, 120] {
            let execution = created + TimeDelta::seconds(elapsed);
            service.enqueue_due(execution, &queue).unwrap();

            if elapsed == 120 && !recurring {
                assert!(receiver.try_recv().is_err());
                break;
            }

            let queued = receiver.try_recv().unwrap();
            assert_eq!(queued.request.command, "system.power_cycle");
            assert_eq!(queued.request.params, params);
            assert!(receiver.try_recv().is_err());

            let request = PowerCycleRequest::try_from(
                queued.request.params,
            ).unwrap();
            let local_execution = execution.with_timezone(
                &chrono_tz::Europe::Madrid,
            );
            let expected_wake = execution + TimeDelta::seconds(28800);

            let result = super::SystemPower::power_cycle_with(
                &request,
                &local_execution,
                |wake_at| {
                    assert_eq!(*wake_at, expected_wake);
                    Ok(())
                },
                |when| {
                    assert_eq!(when, "+1");
                    Ok(super::power::PowerResult {
                        scheduled: true,
                        when: when.to_string(),
                    })
                },
            ).unwrap();

            assert_eq!(
                result.wake_at,
                expected_wake
                    .with_timezone(&chrono_tz::Europe::Madrid)
                    .to_rfc3339(),
            );
        }

        std::fs::remove_file(&path).unwrap();
    }
}
