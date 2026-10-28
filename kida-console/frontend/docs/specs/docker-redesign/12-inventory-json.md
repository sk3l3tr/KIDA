## Context

#12 · JSON de inventario; aceptación en §6 #12 de la [spec](spec.md). Para administradores de Docker.
Solo frontend/documentación; CORE y API intocables. Flujo obligatorio: explore -> ask -> plan -> ask -> implement -> review (agente independiente).
Stack: Angular JsonPipe, panel compartido y temas existentes.
Expensive decisions: respuesta completa interpretada, sin datos derivados ni nueva petición.

## Backlog

12. Como administrador, quiero abrir el JSON del inventario en el panel lateral, para revisar la respuesta recibida con sus límites de precisión. Requires: #1, #7.
