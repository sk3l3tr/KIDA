## Context

#11 · Detalle de proyecto; aceptación en §6 #11 de la [spec](spec.md). Para administradores de Docker.
Solo frontend/documentación; CORE y API intocables. Flujo obligatorio: explore -> ask -> plan -> ask -> implement -> review (agente independiente).
Stack: Angular, DockerService/ARCA, panel compartido e inspector de contenedor.
Expensive decisions: inspección por el canal existente; sin concurrencia ni respuestas cruzadas.

## Backlog

11. Como administrador, quiero inspeccionar un proyecto observado y acceder a sus contenedores, para examinar su composición en el panel lateral. Requires: #1, #5, #10.
