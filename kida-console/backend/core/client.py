import math
from uuid import uuid4

import httpx
from fastapi import HTTPException, Request
from pydantic import BaseModel


def failure(status: int, code: str, message: str):
    return HTTPException(status, {"code": code, "message": message})


def finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


class CoreClient:
    def __init__(self, http: httpx.AsyncClient):
        self.http = http

    async def command(
        self,
        command: str,
        params: dict,
        response_model: type[BaseModel],
        *,
        action=False,
    ) -> BaseModel:
        request_id = str(uuid4())
        uncertain = " No se pudo confirmar la ejecución de la acción." if action else ""
        try:
            response = await self.http.post(
                "command", json={"id": request_id, "command": command, "params": params}
            )
        except httpx.TimeoutException:
            raise failure(
                504, "core_timeout", "CORE no respondió a tiempo." + uncertain
            ) from None
        except httpx.ConnectError:
            raise failure(
                503, "core_unavailable", "No se pudo conectar con CORE."
            ) from None
        except httpx.RequestError:
            raise failure(
                502,
                "core_transport_error",
                "Se perdió la respuesta de CORE." + uncertain,
            ) from None
        if not 200 <= response.status_code < 300:
            raise failure(
                502,
                "core_http_error",
                f"CORE respondió HTTP {response.status_code}." + uncertain,
            )
        try:
            envelope = response.json(
                parse_float=finite_float, parse_constant=finite_float
            )
            if not isinstance(envelope, dict) or envelope.get("id") != request_id:
                raise ValueError()
            if envelope.get("status") == "ERROR":
                if (
                    not isinstance(envelope.get("error"), str)
                    or envelope.get("data") is not None
                ):
                    raise ValueError()
                raise failure(502, "core_error", envelope["error"])
            if envelope.get("status") != "OK" or envelope.get("error") is not None:
                raise ValueError()
            return response_model.model_validate(envelope.get("data"))
        except ValueError:
            raise failure(
                502, "core_invalid_response", "Respuesta de CORE inválida." + uncertain
            ) from None


def get_core_client(request: Request) -> CoreClient:
    return request.app.state.core_client
