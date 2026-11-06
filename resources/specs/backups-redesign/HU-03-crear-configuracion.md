# HU-03 · Crear una configuración sin abandonar el inventario

**Estado:** pendiente. **Dependencia:** HU-02 aceptada e integrada.

Como administrador, quiero crear una configuración desde un panel, con sus opciones avanzadas disponibles y sin perder el borrador al cerrar o cambiar de pestaña.

## Contexto para el agente

Leer [spec general](../backups-redesign.md) y entrega de [HU-02](HU-02-configuraciones.md). Examinar `BackupCreateForm`, `BackupOptionalField`, `backups-form.ts` y la operación `create()` de configuraciones. Reutilizar el panel y modo definidos anteriormente.

## Alcance

- Nueva configuración abre `SidePanel` con `BackupCreateForm`; retirar su presentación permanente anterior.
- Nombre, orígenes y destinos repetibles; obligatoriedad y UUID por destino; compresión fija `tar_zstd`. Opciones avanzadas plegadas: lifecycle, schedule y retention con sus controles actuales, no el JSON simplificado del mockup.
- Conservar exactamente serialización y validación actuales: omisión/valor/null, strings sin normalizar, Unicode, JSON seguro, `false`, cero, límites de `keep_last` y puntos protegidos.
- Acciones de formulario integradas con `[panel-actions]` sin duplicar submit. Borrador propiedad de `BackupConfigurationsState`, no del DOM del modal.
- Cierre/restablecimiento solo ante respuesta confirmada de creación; errores de validación, rechazo e incertidumbre dejan datos y mensaje. Mantener visibles éxito y fallo independiente del refresco posterior.

## Criterios de aceptación

1. Cerrar y reabrir o cambiar de pestaña conserva todos los campos, incluidos los avanzados; salir de Backups/cambiar identidad los borra.
2. Una creación confirmada usa el resultado actual, restablece el formulario y permite cerrar el panel sin afectar otra selección/pestaña si la respuesta llega tarde.
3. Finalizar el observable, fallar la escritura o fallar su refresco no se confunden con éxito ni ocasionan pérdida del borrador. No hay doble envío.
4. Payloads y validaciones siguen siendo equivalentes a los del formulario anterior. Schedule/retention se explican como metadatos, sin programación o limpieza implícita.
5. Inputs, selects, textareas y checkbox respetan el tema; labels, foco y botones siguen las convenciones compartidas.

## Archivos y comprobación

Ámbito: `tabs/backup-configurations/`, `components/backup-create-form/`, `components/backup-optional-field/` si requiere presentación, estado/fachada y pruebas afectadas. No reescribir validadores ni añadir un formulario alternativo.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts'
pnpm exec ng build --configuration development
```

Mantener cobertura de payload completo y añadir ciclo de borrador, cierre confirmado, respuesta tardía y error de refresco separado. Revisión estática del formulario dentro de `SidePanel`; navegador solo ante una duda real.

## Entrega de sesión

Pendiente: registrar cambios, verificaciones y revisión independiente. La pestaña Configuraciones debe quedar completa y las otras dos operativas.
