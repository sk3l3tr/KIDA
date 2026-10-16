# 10 · Comandos CLI

**Objetivo:** permitir usar todas las operaciones Health desde la CLI actual.

## Trabajo

- Añadir la jerarquía `backup health` de [contratos](contratos.md), incluido `run` y gestión de informes.
- Mantener `cli → input → mapper → client → renderer`; validar flags localmente antes de conectar. `--file` representa una ruta de CORE: no leerla ni resolverla en el cliente.
- Mapear a los parámetros pactados y renderizar respuestas humanas/JSON, estados, diagnóstico, informes y errores. Renderers devuelven texto; el entrypoint imprime y controla exit codes.
- Documentar ejemplos de manual/automático, programación con `health.run`, ruta en servidor, TTL, no reinicio, limpieza e integridad funcional a cargo del administrador. No añadir wizard.

## Frontera

Posee flags, preparación/mapeo, renderers y documentación CLI. Consume fixtures del protocolo para desarrollarse sin CORE Health implementado. No carga TOML remoto, restaura ni añade lógica Docker o de estados al cliente.

## Pruebas y cierre

Cubrir parsing de todos los comandos; flags incompletos, UUID/modo inválidos y fallos locales sin transporte. Comprobar mapeos exactos y salidas humanas/JSON, respuesta malformada y errores de transporte. La prueba de ruta de servidor debe funcionar aunque ese archivo no exista en el cliente.

Cierra cuando todos los comandos tienen contrato y salida comprobados manteniendo el comportamiento de comandos existentes. Actualizar el índice.
