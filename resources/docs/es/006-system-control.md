# Control del sistema

[English](../en/006-system-control.md) · [Índice de documentación](000-index.md)

Consulta información del sistema, temperaturas y ventiladores; solicita apagado o reinicio; consulta
capacidades RTC o programa una alarma RTC antes del apagado. Las operaciones afectan al servidor CORE.

## Apagado y encendido RTC

`system.reboot` reinicia un equipo encendido. Un ciclo de apagado programa RTC para encenderlo después.
La disponibilidad RTC no demuestra permisos para programar alarmas ni compatibilidad con encendido desde S5.
Eso requiere una prueba en el hardware y firmware de destino.

- El encendido usa la siguiente hora local `HH:MM` del servidor o un retraso mínimo de 120 segundos desde la ejecución.
- Sin hora explícita de apagado, se solicita apagar en un minuto.
- Una hora explícita de apagado corresponde a hoy en la zona local del servidor y debe quedar al menos a 60 segundos. Se rechazan horas pasadas, inexistentes o ambiguas.
- El encendido debe quedar al menos a 120 segundos de la ejecución y 60 segundos después del apagado. Los horarios incompatibles se rechazan, sin moverlos a otro día.
- CORE verifica la alarma RTC antes de solicitar el apagado y vuelve a comprobar su margen después. Si el margen se ha agotado, no solicita el apagado, pero la alarma puede seguir activa.
- Una alarma posterior puede sustituir otra. Eliminar una programación no borra una alarma ni revierte un apagado ya solicitado. Los márgenes no garantizan cuánto tarda el hardware en apagarse.

## Elige tu interfaz

- [CONSOLE](console/system-control.md) — aún no implementada.
- [CLI](cli/system-control.md).
- [API directa](api/system-control.md).

Receta de apagado y encendido semanal: [CLI](cli/weekly-power-cycle.md) · [API](api/weekly-power-cycle.md).
