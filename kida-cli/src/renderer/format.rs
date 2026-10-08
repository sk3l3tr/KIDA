pub fn unknown(value: Option<&str>) -> &str {
    value.unwrap_or("unknown")
}

pub fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

pub fn table(headers: &[&str], rows: &[Vec<String>]) -> String {
    let widths: Vec<_> = headers
        .iter()
        .enumerate()
        .map(|(column, header)| {
            rows.iter()
                .map(|row| row[column].chars().count())
                .max()
                .unwrap_or(0)
                .max(header.len())
        })
        .collect();

    let format_row = |row: &[String]| {
        row.iter()
            .enumerate()
            .map(|(column, value)| format!("{value:<width$}", width = widths[column]))
            .collect::<Vec<_>>()
            .join("  ")
            .trim_end()
            .to_string()
    };

    let header = headers
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let mut output = vec![format_row(&header)];
    output.extend(rows.iter().map(|row| format_row(row)));
    output.join("\n")
}
