# Diálogos de Console

`AppDialog` es el contenido común para mensajes y confirmaciones. ARCA gestiona la apertura y el cierre; los módulos escuchan sus acciones directamente.

- Configuración: `AppDialogConfig` contiene título, párrafos, tipo, botones e identificador de contexto generado con `newDialogContext()`.
- Abrir: limpiar `APP_DIALOG_OPEN` y la acción de resultado del flujo; suscribirse al resultado antes de llamar a `arca.modals.openModal(AppDialog, config, APP_DIALOG_OPEN, closeAction)`.
- Responder: ARCA publica `{ option, data: { context } }` en `closeAction`. Filtrar el contexto y consumir una sola respuesta. Ejecutar la operación únicamente para la opción explícita de confirmación y un destino vigente.
- Invalidar: retirar la suscripción y publicar `APP_DIALOG_CANCEL` con el contexto. La cancelación también funciona si el modal todavía está abriéndose.
- Los párrafos son texto, nunca HTML. Los iconos usan las clases existentes `i i-*`. `custom` permite combinar los mismos elementos, sin contenido ejecutable.

El componente se ocupa del foco inicial y comunica como cancelación los cierres externos de Ionic. El foco posterior a una operación que deshabilita o elimina su disparador pertenece al flujo de esa operación.

ARCA 3.2.7 conserva `modalOpen = true` cuando falla `ModalController.create()`. Las vistas liberan su bloqueo local, pero ese defecto de la librería sigue pendiente; la migración no modifica ARCA. Las pruebas de integración reproducen esta limitación.
