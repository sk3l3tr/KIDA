import math

from pydantic import BaseModel, ConfigDict, model_validator


def validate_json(value):
    # Validate before field parsing so invalid keys cannot enter error locations.
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                raise ValueError("Isolated Unicode surrogates are not allowed")
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError("Non-finite JSON numbers are not allowed")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


class Input(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def valid_json(cls, value):
        return validate_json(value)


class CoreData(BaseModel):
    # Preserve future fields and open-ended diagnostic strings from the agent.
    model_config = ConfigDict(strict=True, extra="allow", allow_inf_nan=False)
