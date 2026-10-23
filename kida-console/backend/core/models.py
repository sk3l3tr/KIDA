from pydantic import BaseModel, ConfigDict


class CoreData(BaseModel):
    # Preserve future fields and open-ended diagnostic strings from the agent.
    model_config = ConfigDict(strict=True, extra="allow", allow_inf_nan=False)
