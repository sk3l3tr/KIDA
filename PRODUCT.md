# KIDA

<!-- impeccable:product-schema 1 -->

## Platform

web

La interfaz gráfica es KIDA Console, una aplicación web. Este documento cubre
también CORE, el agente para Linux, y CLI, el cliente de terminal.

## Users

Una persona con conocimientos técnicos que administra su propio servidor
doméstico. Necesita gestionar Docker, backups y tareas programadas del sistema
desde un mismo lugar.

## Product Purpose

Simplificar las operaciones del servidor doméstico mediante una herramienta
autohospedada que reúne gestión de contenedores, backups, programación de tareas
y consulta y control del sistema. El éxito consiste en resolver esas tareas con
claridad sobre el destino de cada acción y su resultado real.

## Positioning

CORE ejecuta las operaciones en la infraestructura del usuario; CLI y Console
ofrecen acceso desde terminal y navegador. La API permite integrar otras
herramientas. Backup Health permite restaurar y comprobar backups en un entorno
aislado; su diagnóstico técnico requiere validación funcional del administrador.

## Operating Context

- El servidor gestionado ejecuta Linux y permanece bajo control del usuario.
- CLI gestiona entrada y presentación; CORE ejecuta las peticiones del protocolo.
- Console usa Angular, Ionic y ARCA con un backend FastAPI. Sus cuentas y sesiones
  pertenecen a Console, separadas de CORE y CLI.
- En Console solo existen administradores, con los mismos privilegios; no hay
  registro público ni edición de credenciales ajenas.
- Las rutas de archivos transmitidas por Console corresponden al host de CORE.
  Console no sube ni edita esos archivos.

## Capabilities and Constraints

- Docker: consultar y operar contenedores y proyectos Compose.
- Backups: configurar y solicitar ejecuciones, gestionar Backup Health y consultar
  sus informes.
- Scheduler: consultar, crear y eliminar programaciones de operaciones.
- Sistema: consultar salud, sensores y equipo; gestionar operaciones de energía
  y capacidades RTC según lo que soporte y reporte el servidor.
- Una respuesta `QUEUED` confirma admisión, no inicio ni finalización.
- Un timeout puede dejar una escritura sin confirmar; no debe interpretarse como
  fallo definitivo ni provocar reintentos automáticos en Console.
- Eliminar una configuración de backup no elimina sus archivos. Los metadatos
  schedule y retention de esa configuración no programan ni podan por sí solos.
- Conservar nulos, estados desconocidos y campos futuros; distinguir datos
  desactualizados de lecturas actuales y resultados confirmados de inciertos.

## Brand Commitments

Conservar los nombres KIDA, KIDA CORE, KIDA CLI, KIDA Console y Backup Health.
No se ha definido una nueva voz de marca ni una dirección visual en este init.

## Evidence on Hand

- `README.md` y `README.es.md`: presentación del producto.
- `resources/docs/`: documentación en castellano e inglés de CORE, CLI, API y Console.
- `kida-console/README.md`: flujos, permisos y límites operativos de Console.
- `resources/assets/`: demostraciones de terminal; su generación y comprobaciones
  se describen en `resources/assets/README.md`.
- `kida-console/frontend/src/theme/README.md`: sistema de apariencia existente
  y criterios documentados de contraste e interacción.

Estas fuentes documentan el producto; este init no vuelve a ejecutar sus demos
ni certifica los resultados de las comprobaciones anteriores.

## Product Principles

1. Reunir las operaciones habituales del servidor sin añadir complejidad innecesaria.
2. Mantener la ejecución en CORE y respetar los contratos de cada cliente.
3. Mostrar el estado y las consecuencias reales de las acciones, incluida la incertidumbre.
4. Preservar los datos del usuario y exigir confirmación para acciones sensibles en Console.

## Accessibility & Inclusion

La documentación de apariencia de Console exige contraste de texto de al menos
4.5:1 y de controles gráficos y foco aplicables de al menos 3:1. Las verificaciones
existentes contemplan escritorio, móvil, foco y movimiento reducido; no equivalen
a una certificación completa de accesibilidad. No se ha acordado un estándar
adicional en esta inicialización.
