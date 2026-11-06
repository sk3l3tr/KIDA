# HU-02 · Consultar configuraciones y solicitar backups

**Estado:** pendiente. **Dependencia:** HU-01 aceptada e integrada.

Como administrador, quiero identificar qué se copia y a dónde, consultar la configuración completa y solicitar una copia o eliminar su configuración con seguridad.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-01](HU-01-navegacion.md). Examinar `tabs/backup-configurations/`, `BackupConfigurationsState`, `SidePanel` y el inspector Docker como patrón de foco/confirmación. No repetir la migración de rutas.

## Alcance

- Cabecera con Nueva configuración (mantener su formulario actual accesible hasta HU-03), Actualizar, fecha de lectura y búsqueda local por nombre/rutas.
- Tarjetas CSS Grid 1/2/3 columnas: nombre, primer origen y contador adicional, hasta dos destinos con obligatoriedad y contador adicional. No alterar datos ni orden del servidor.
- Acciones Ver detalles, Solicitar backup y Eliminar configuración mediante los métodos actuales. Abrir detalle en `SidePanel` y conservar confirmaciones ARCA.
- Inspector con ID, todas las rutas, obligatoriedad/UUID, compresión, lifecycle, schedule, retention, precisión limitada y JSON. Reutilizar el detalle existente; mantener omitido/null/valor.
- Resultado de escritura e incertidumbres fuera del panel; cierres y foco conforme a la spec general. El formulario de creación conserva su ubicación/función anterior hasta HU-03.

## Criterios de aceptación

1. Una configuración con múltiples orígenes/destinos se resume sin perder acceso a ninguna ruta. Distinguir lista vacía, filtro sin resultados, carga y error con datos anteriores.
2. Buscar no envía peticiones ni modifica entradas; limpiar el filtro restaura el orden original.
3. Solicitar/eliminar conserva ID y nombre congelados, bloqueos cruzados y protección de doble envío tanto desde tarjeta como desde panel. Cancelar no envía.
4. La UI aclara que admisión no es finalización y que eliminar configuración conserva los archivos. Los avisos de incertidumbre persisten sin reenvío automático ni bloqueo permanente añadido.
5. Cerrar/abrir otro detalle no muestra datos ajenos; la desaparición del elemento seleccionado cierra el detalle y devuelve foco a un destino válido.
6. Tarjetas y panel consumen tokens e iconos existentes; no copiar la paleta ni estilos de botones del mockup.

## Archivos y comprobación

Ámbito: `tabs/backup-configurations/`, fachada/estado de configuraciones solo para presentación y cierre, SCSS local y `tests/backups.spec.ts`. Conservar transporte, modelos y validadores.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Comprobar filtros, múltiples rutas, detalle íntegro, confirmación/cancelación, doble envío, incertidumbre y selección desaparecida. Revisar tokens y adaptación sin ampliar a otros módulos.

## Entrega de sesión

Pendiente: registrar cambios, pruebas, revisión independiente y contratos añadidos. Dejar identificado cómo HU-03 abrirá el modo de creación existente en la fachada.
