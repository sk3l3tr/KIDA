use chrono::{DateTime, TimeDelta, Utc};

pub fn parse_once(at: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(at)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|_| "once.at must be RFC3339 with an explicit timezone offset".to_string())
}

pub fn next_interval(
    anchor: DateTime<Utc>,
    seconds: u64,
    after: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    let seconds =
        i64::try_from(seconds).map_err(|_| "interval.seconds is out of range".to_string())?;

    if seconds == 0 {
        return Err("interval.seconds must be greater than zero".to_string());
    }

    let occurrence = if after < anchor {
        1
    } else {
        after.signed_duration_since(anchor).num_seconds() / seconds + 1
    };

    let elapsed = occurrence
        .checked_mul(seconds)
        .and_then(TimeDelta::try_seconds)
        .ok_or_else(|| "interval duration is out of range".to_string())?;

    anchor
        .checked_add_signed(elapsed)
        .ok_or_else(|| "next interval date is out of range".to_string())
}

pub fn next_cron(
    expression: &str,
    timezone: &str,
    after: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    use chrono::{TimeZone, Timelike};
    use chrono_tz::Tz;
    use croner::parser::CronParser;

    if expression.split_whitespace().count() != 5 {
        return Err("cron.expression must contain exactly five fields".to_string());
    }

    if expression.contains('+') {
        return Err("cron.expression does not support the AND modifier".to_string());
    }

    let cron = CronParser::new()
        .parse(expression)
        .map_err(|error| format!("invalid cron.expression: {error}"))?;

    let timezone: Tz = timezone
        .parse()
        .map_err(|_| "cron.timezone must be a valid IANA timezone".to_string())?;

    // CRON calcula etiquetas locales; la zona resuelve después el instante real.
    let mut cursor = after
        .with_timezone(&timezone)
        .naive_local()
        .with_nanosecond(0)
        .ok_or_else(|| "cron date is out of range".to_string())?
        .and_utc();

    loop {
        cursor = cron
            .find_next_occurrence(&cursor, false)
            .map_err(|error| format!("cannot calculate next cron occurrence: {error}"))?;

        let Some(candidate) = timezone.from_local_datetime(&cursor.naive_utc()).earliest() else {
            continue;
        };

        let candidate = candidate.with_timezone(&Utc);

        // También descarta la primera aparición si ya pasó al reiniciar
        // dentro de la segunda aparición de una hora repetida.
        if candidate > after {
            return Ok(candidate);
        }
    }
}

pub fn next_enqueue_at(
    rule: &super::model::ScheduleRule,
    anchor: DateTime<Utc>,
    after: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    use super::model::ScheduleRule;

    match rule {
        ScheduleRule::Once { at } => {
            let date = parse_once(at)?;
            Ok((date > after).then_some(date))
        }
        ScheduleRule::Interval { seconds } => next_interval(anchor, *seconds, after).map(Some),
        ScheduleRule::Cron {
            expression,
            timezone,
        } => next_cron(expression, timezone, after.max(anchor)).map(Some),
    }
}

#[cfg(test)]
mod rule_tests {
    use super::*;
    use crate::scheduler::model::ScheduleRule;

    #[test]
    fn next_date_distinguishes_expired_once_from_recurrences() {
        let anchor = parse_once("2026-10-10T12:00:00Z").unwrap();
        let after = parse_once("2026-10-10T12:07:35Z").unwrap();

        let expired = ScheduleRule::Once {
            at: "2026-10-10T12:01:00Z".to_string(),
        };
        assert_eq!(next_enqueue_at(&expired, anchor, after).unwrap(), None);
        assert_eq!(
            next_enqueue_at(
                &expired,
                anchor,
                parse_once("2026-10-10T12:01:00Z").unwrap()
            )
            .unwrap(),
            None
        );

        let future = ScheduleRule::Once {
            at: "2026-10-10T12:10:00Z".to_string(),
        };
        assert_eq!(
            next_enqueue_at(&future, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:10:00Z").unwrap())
        );

        let interval = ScheduleRule::Interval { seconds: 60 };
        assert_eq!(
            next_enqueue_at(&interval, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:08:00Z").unwrap())
        );

        let cron = ScheduleRule::Cron {
            expression: "*/5 * * * *".to_string(),
            timezone: "UTC".to_string(),
        };
        assert_eq!(
            next_enqueue_at(&cron, anchor, after).unwrap(),
            Some(parse_once("2026-10-10T12:10:00Z").unwrap())
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn once_requires_offset_and_normalizes_to_utc() {
        assert_eq!(
            parse_once("2026-10-10T14:00:00+02:00").unwrap(),
            parse_once("2026-10-10T12:00:00Z").unwrap()
        );
        assert!(parse_once("2026-10-10T14:00:00").is_err());
    }

    #[test]
    fn interval_keeps_anchor_and_skips_elapsed_occurrences() {
        let anchor = parse_once("2026-10-10T12:00:00.250Z").unwrap();

        for (after, expected) in [
            ("2026-10-10T11:59:00Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:00:00.250Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:01:00Z", "2026-10-10T12:01:00.250Z"),
            ("2026-10-10T12:01:00.250Z", "2026-10-10T12:02:00.250Z"),
            ("2026-10-10T12:07:35Z", "2026-10-10T12:08:00.250Z"),
        ] {
            assert_eq!(
                next_interval(anchor, 60, parse_once(after).unwrap()).unwrap(),
                parse_once(expected).unwrap()
            );
        }

        assert!(next_interval(anchor, 0, anchor).is_err());
        assert!(next_interval(anchor, u64::MAX, anchor).is_err());
        assert!(next_interval(DateTime::<Utc>::MAX_UTC, 1, DateTime::<Utc>::MAX_UTC).is_err());
    }
}

#[cfg(test)]
mod cron_tests {
    use super::*;

    #[test]
    fn cron_validates_input_and_uses_dom_or_dow() {
        let after = parse_once("2026-10-10T12:00:00.250Z").unwrap();

        assert_eq!(
            next_cron("*/5 * * * *", "UTC", after).unwrap(),
            parse_once("2026-10-10T12:05:00Z").unwrap()
        );

        assert_eq!(
            next_cron(
                "0 0 15 * MON",
                "UTC",
                parse_once("2026-10-11T00:00:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-10-12T00:00:00Z").unwrap()
        );

        for expression in ["* * * *", "0 * * * * *", "61 * * * *", "0 0 15 * +MON"] {
            assert!(next_cron(expression, "UTC", after).is_err());
        }

        assert!(next_cron("* * * * *", "invalid/timezone", after).is_err());
    }

    #[test]
    fn cron_skips_nonexistent_local_time() {
        assert_eq!(
            next_cron(
                "30 2 * * *",
                "Europe/Madrid",
                parse_once("2026-03-28T23:00:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-03-30T00:30:00Z").unwrap()
        );
    }

    #[test]
    fn cron_uses_only_first_occurrence_of_repeated_local_time() {
        for (after, expected) in [
            ("2026-10-24T23:00:00Z", "2026-10-25T00:30:00Z"),
            ("2026-10-25T00:30:00Z", "2026-10-26T01:30:00Z"),
            ("2026-10-25T01:10:00Z", "2026-10-26T01:30:00Z"),
        ] {
            assert_eq!(
                next_cron("30 2 * * *", "Europe/Madrid", parse_once(after).unwrap()).unwrap(),
                parse_once(expected).unwrap()
            );
        }

        assert_eq!(
            next_cron(
                "* * * * *",
                "Europe/Madrid",
                parse_once("2026-10-25T01:10:00Z").unwrap()
            )
            .unwrap(),
            parse_once("2026-10-25T02:00:00Z").unwrap()
        );
    }
}
