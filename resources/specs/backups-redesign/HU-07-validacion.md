# HU-07 · Usar el rediseño integrado con cualquier tema

**Estado:** pendiente. **Dependencia:** HU-06 aceptada e integrada.

Como administrador, quiero una experiencia consistente en las tres pestañas, con mi tema y dispositivo, sin perder operaciones, borradores o claridad sobre su resultado.

## Contexto para el agente

Leer [spec general](../backups-redesign.md), las entregas HU-01 a HU-06 y el mockup. Revisar implementación final y estilos compartidos. Esta historia integra y verifica; no recupera trabajo omitido marcándolo como validado ni amplía funciones.

## Alcance

- Revisar composición global, tokens, siete combinaciones de tema, 360 px/escritorio, rutas largas, teclado/foco y movimiento reducido. El cambio de tema no recrea páginas, borra formularios ni cierra paneles.
- Confirmar la conservación de las 14 operaciones, validadores, contenido técnico, JSON y comportamiento de incertidumbre. Revisar juntos navegación interna, formularios, confirmaciones y respuestas tardías.
- Ejecutar la validación integrada, corregir defectos dentro del alcance y actualizar documentación de navegación ES/EN cuando resulte afectada.
- Revisar diff para detectar duplicación, wrappers/servicios innecesarios, estilos copiados, controles de demo o cambios ajenos. Revisión independiente del conjunto tras las correcciones.

## Criterios de aceptación

1. HU-01 a HU-06 están aceptadas; todo criterio de la spec general tiene implementación y comprobación identificable. Lo no comprobado se declara expresamente.
2. Una sesión completa permite navegar, crear configuración, solicitar backup, consultar/operar Health y leer/borrar informes con las salvaguardas definidas, usando dobles de prueba y sin operar CORE real.
3. Tema y adaptación usan componentes/tokens existentes; no hay desbordamiento horizontal de página ni información dependiente solo del color. El scroll de la tabla es interno.
4. Pruebas relevantes y suite frontend pasan sin debilitar comprobaciones. Build de producción pasa, o se documenta un fallo comparado con la base y su causa; no marcar completa con una regresión sin resolver ni subir budgets.
5. No se han añadido dependencias, infraestructura paralela, cambios de backend ni commits/push/deploy sin autorización.

## Archivos y comprobación

Ámbito: implementación Backups y pruebas ya afectadas; documentación `resources/docs/{es,en}/console/README.md` si corresponde. Cambios compartidos solo si un defecto real lo exige y está dentro del alcance autorizado; no rediseñar el tema global.

Desde `kida-console/frontend`:

```sh
pnpm exec ng test --watch=false --include='src/app/pages/backups/tests/*.spec.ts' --include='src/app/app.routes.spec.ts'
pnpm exec ng test --watch=false
pnpm exec ng build --configuration production
```

Inspección visual manual breve en móvil/escritorio y claro/oscuro; comprobar tokens para las demás combinaciones, sin afirmar una matriz visual no ejecutada. Playwright solo ante una duda concreta de Ionic/foco/adaptación sin otra cobertura suficiente; no ejecutar pruebas con operaciones reales. Revisar whitespace de archivos tracked y nuevos.

## Entrega de sesión

Pendiente: registrar validaciones, veredicto de revisión independiente y límites. Actualizar estado global e historias solo con evidencia; no declarar terminada la implementación si queda un criterio pendiente o bloqueado.
