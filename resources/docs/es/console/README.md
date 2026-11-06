# KIDA CONSOLE

[English](../../en/console/README.md) · [Índice](../000-index.md)

KIDA Console ofrece una interfaz web para administrar el servidor mediante CORE.
Consulta la [instalación y configuración](../../../../kida-console/README.md).

## Navegación

Las páginas `/dashboard`, `/system`, `/docker`, `/backups`, `/scheduler`,
`/settings` y `/administrators` requieren una sesión. `/login` es pública.
El menú abre Backups en `/backups`, que redirige a Configuraciones.

| Pestaña | Enlace directo | Funciones |
| --- | --- | --- |
| Configuraciones | `/backups/configurations` | Buscar por nombre o rutas, consultar detalles, crear, solicitar un backup y eliminar configuraciones. |
| Backup Health | `/backups/health` | Consultar historial y detalles, crear comprobaciones, solicitar ejecución automática e iniciar, detener o eliminar Health. |
| Informes | `/backups/reports` | Consultar por `run_id`, leer Markdown como texto literal y eliminar informes con confirmación. |

Los formularios y detalles se abren en paneles laterales. Cerrar un panel o cambiar
de pestaña conserva borradores, búsqueda, resultados y avisos de incertidumbre;
cancela confirmaciones pendientes y limpia la selección. Una escritura ya enviada
puede terminar después del cierre. Salir de Backups o cambiar de sesión limpia
los datos y borradores del módulo. Cambiar de tema conserva el trabajo abierto.

Actualizar conserva los datos anteriores si falla la lectura y los marca como
desactualizados. Las fechas se muestran en la hora local del navegador.

## Semántica de las operaciones

- Solicitar un backup, ejecutar Health automático e iniciar/detener/eliminar Health
  requieren confirmación, al igual que eliminar configuraciones o informes.
- La admisión en cola no confirma inicio ni finalización. `run_id` identifica Health;
  `execution_id` identifica una ejecución en cola.
- Crear Health no lo inicia, tampoco en modo `AUTOMATIC`. La definición debe existir
  en el host CORE; Console no sube ni edita ese fichero.
- Eliminar una configuración conserva sus archivos. Sus metadatos `schedule` y
  `retention` no programan ejecuciones ni realizan limpieza por sí solos.
- El diagnóstico técnico de Health requiere validación funcional del administrador.
  Revisa la limpieza, los errores y los recursos devueltos por CORE.
- Un resultado incierto se conserva y no se reenvía automáticamente. Actualizar
  las listas no resuelve esa incertidumbre.

También puedes utilizar la [CLI](../cli/README.md) o la [API](../api/README.md).
