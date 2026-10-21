# Integraciones

[English](../en/007-integrations.md) · [Índice de documentación](000-index.md)

Usa la [API directa](api/README.md) para scripts y herramientas externas que necesiten respuestas JSON.
HTTP y Unix socket aceptan el mismo sobre de comandos; cambia la delimitación de los mensajes.

- HTTP: `POST http://127.0.0.1:8989/command` con `Content-Type: application/json`.
- Unix socket: `/tmp/kida.sock`, una petición y respuesta JSON por línea.

Son valores predeterminados; consulta la [configuración](configuration.md). El servidor HTTP actual no incorpora
autenticación ni TLS. Limita el acceso a un entorno de confianza; no presupongas que valida una cabecera de autorización.
CLI utiliza el socket Unix local y es un cliente para personas, sin transporte HTTP ni modo de salida JSON.

Revisa tanto el estado del protocolo como el resultado del comando. La admisión en cola no confirma finalización,
y una respuesta Health correcta puede contener un diagnóstico negativo o limpieza incompleta.
No reintentes automáticamente peticiones que modifican estado si se pierde la respuesta: el ID de petición no es
una clave de idempotencia. CONSOLE es una interfaz web prevista, no un endpoint de integración disponible.
