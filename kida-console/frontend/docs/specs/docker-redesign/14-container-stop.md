## Context

#14 · Parada; aceptación en §7 #13–#16 de la [spec](spec.md). Para administradores de Docker.
Solo frontend/documentación; CORE y API intocables. Flujo obligatorio: explore -> ask -> plan -> ask -> implement -> review (agente independiente).
Stack: Angular, controles compartidos, DockerService/ARCA y confirmación existente.
Expensive decisions: Parar bloqueado si online=false; confirmar instantánea de destino y coordinar foco.

## Backlog

14. Como administrador, quiero confirmar la parada de un contenedor desde la fila o su inspector, para revisar el destino antes de interrumpirlo. Requires: #7, #10, #13.
