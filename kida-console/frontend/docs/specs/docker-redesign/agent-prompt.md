Implementa únicamente la historia indicada en este repositorio KIDA.

Historia: kida-console/frontend/docs/specs/docker-redesign/08-container-inventory.md
Spec global: kida-console/frontend/docs/specs/docker-redesign/spec.md

Sigue este flujo obligatorio:
explore -> ask -> plan -> ask -> implement -> review

1. Explore: lee AGENTS.md, la historia, las reglas compartidas y los apartados aplicables de la spec. Comprueba sus dependencias en el código actual y examina solo lo necesario.
2. Ask: aclara dudas materiales y confirma tu interpretación. Resuelve mediante exploración las preguntas sobre el repositorio.
3. Plan: presenta un plan breve con cambios, archivos afectados y validación.
4. Ask: espera la validación del usuario antes de modificar código.
5. Implement: completa solo esta historia, preservando las funcionalidades existentes y el trabajo ajeno.
6. Review: solicita revisión a un agente independiente, corrige los hallazgos y repite las comprobaciones afectadas.

Restricciones:

- Solo frontend y documentación. CORE, CLI, backend y API son intocables.
- Reutiliza ARCA, Ionic, componentes y temas existentes. No añadas dependencias ni infraestructura paralela.
- Sigue el layout y UX especificados; no copies literalmente los estilos del mockup.
- No inventes datos ni cambies contratos. Si falta información imprescindible o una dependencia, consulta antes de continuar.
- Ejecuta pruebas relevantes; usa Playwright con API simulada cuando corresponda verificar interfaz.
- No debilites pruebas ni amplíes el alcance para resolver problemas.
- No hagas commit, push ni despliegue.

Entrega un resumen breve de cambios, validaciones, revisión independiente y limitaciones pendientes.
