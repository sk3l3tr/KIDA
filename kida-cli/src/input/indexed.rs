use std::{collections::HashSet, fmt::Display, str::FromStr};

use super::error::InputError;

pub fn apply_indexed<T, V>(
    items: &mut [T],
    assignments: &[String],
    field: &str,
    set: impl Fn(&mut T, V),
) -> Result<(), InputError>
where
    V: FromStr,
    V::Err: Display,
{
    let mut assigned = HashSet::new();

    for assignment in assignments {
        let (index, value) = assignment
            .split_once('=')
            .ok_or_else(|| InputError::new(field, "expected INDEX=VALUE"))?;

        let index = index
            .parse::<usize>()
            .map_err(|error| InputError::new(field, error))?;

        let context = format!("{field}[{index}]");
        let item = items
            .get_mut(index)
            .ok_or_else(|| InputError::new(&context, "index does not exist"))?;

        if !assigned.insert(index) {
            return Err(InputError::new(&context, "duplicate assignment"));
        }

        let value = value
            .parse::<V>()
            .map_err(|error| InputError::new(&context, error))?;

        set(item, value);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::apply_indexed;

    #[test]
    fn changes_only_the_selected_index() {
        let mut items = [true, true, true];

        apply_indexed(
            &mut items,
            &["2=false".into(), "0=false".into()],
            "targets.required",
            |item, value: bool| *item = value,
        )
        .unwrap();

        assert_eq!(items, [false, true, false]);
    }

    #[test]
    fn preserves_strings_containing_equals() {
        let mut items = [String::new()];

        apply_indexed(
            &mut items,
            &["0=a=b".into()],
            "targets.filesystem_uuid",
            |item, value: String| *item = value,
        )
        .unwrap();

        assert_eq!(items[0], "a=b");
    }

    #[test]
    fn applies_free_json_to_object_attributes() {
        let mut items = [
            json!({"command": "first", "params": null}),
            json!({"command": "second", "params": null}),
        ];

        apply_indexed(
            &mut items,
            &[r#"1={"text":"a=b","values":[null,true,3]}"#.into()],
            "lifecycle.pre_backup.params",
            |item, value: Value| item["params"] = value,
        )
        .unwrap();

        assert_eq!(items[0], json!({"command": "first", "params": null}));
        assert_eq!(
            items[1],
            json!({
                "command": "second",
                "params": {"text": "a=b", "values": [null, true, 3]}
            })
        );
    }

    #[test]
    fn rejects_invalid_assignments_with_field_context() {
        let cases = [
            (vec!["0".into()], "expected INDEX=VALUE"),
            (vec!["x=false".into()], "targets.required"),
            (vec!["1=false".into()], "index does not exist"),
            (vec!["0=yes".into()], "targets.required[0]"),
            (
                vec!["0=true".into(), "0=false".into()],
                "duplicate assignment",
            ),
        ];

        for (assignments, expected) in cases {
            let mut items = [true];
            let error = apply_indexed(
                &mut items,
                &assignments,
                "targets.required",
                |item, value: bool| *item = value,
            )
            .unwrap_err()
            .to_string();

            assert!(error.contains("targets.required"), "{error}");
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn rejects_invalid_json() {
        let mut items = [Value::Null];

        let error = apply_indexed(
            &mut items,
            &["0={".into()],
            "lifecycle.post_backup.params",
            |item, value: Value| *item = value,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("lifecycle.post_backup.params[0]"));
    }
}
