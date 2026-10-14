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
