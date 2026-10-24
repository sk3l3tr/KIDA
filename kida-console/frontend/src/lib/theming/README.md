# Integrar theming en Angular

Ejemplo para una aplicación Angular standalone en navegador. El motor no depende de KIDA, Ionic ni ARCA.

## 1. Copiar el motor

Copia `model.ts` y `theme.service.ts` a `src/lib/theming/`. Mantén el catálogo, los estilos y los componentes fuera de esta carpeta.

## 2. Definir los temas

Crea `src/theme/theme.config.ts`. Cada ID debe ser único y usar letras minúsculas, números o guiones, empezando por una letra.

```ts
import { ThemeConfig } from '../lib/theming/model';

export const themeConfig: ThemeConfig = {
  namespace: 'my-app:appearance',
  initial: { theme: 'ocean', mode: 'light' },
  themes: [
    { id: 'ocean', modes: ['light', 'dark'], defaultMode: 'light' },
    { id: 'terminal', modes: ['dark'], defaultMode: 'dark' },
  ],
};
```

`initial` y cada `defaultMode` deben usar modos compatibles con su tema.

## 3. Registrar el provider

Añade `provideTheming` a los providers existentes de `src/app/app.config.ts`:

```ts
import { ApplicationConfig } from '@angular/core';
import { provideTheming } from '../lib/theming/theme.service';
import { themeConfig } from '../theme/theme.config';

export const appConfig: ApplicationConfig = {
  providers: [provideTheming(themeConfig)],
};
```

## 4. Aplicar la apariencia antes del bootstrap

En `src/index.html`, añade el atributo a `<html>` y la regla dentro de `<head>`:

```html
<html lang="es" data-theme-pending>
  <head>
    <style>
      html[data-theme-pending] app-root {
        visibility: hidden;
      }
    </style>
    <!-- Conserva el resto del documento. -->
  </head>
</html>
```

En `src/main.ts`, resuelve la preferencia global antes de arrancar Angular:

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { bootstrapTheme } from './lib/theming/model';
import { browserThemeStorage } from './lib/theming/theme.service';
import { themeConfig } from './theme/theme.config';

bootstrapTheme(themeConfig, document.documentElement, browserThemeStorage);
bootstrapApplication(App, appConfig).catch(console.error);
```

Esto establece `data-theme`, `data-mode` y `color-scheme` en `<html>` y retira la protección incluso si falla el almacenamiento.

## 5. Añadir los estilos globales

Incluye todos los temas en el CSS inicial, por ejemplo en `src/styles.scss`. El motor selecciona atributos; la aplicación define su apariencia.

```scss
:root {
  --surface: #ffffff;
  --text: #182b3d;
  --accent: #155f75;
}
html[data-mode='dark'] {
  --surface: #101b27;
  --text: #ecf2f8;
  --accent: #83d8ef;
}
html[data-theme='terminal'] {
  --accent: #68e3e1;
  font-family: monospace;
}
body {
  background: var(--surface);
  color: var(--text);
}
a {
  color: var(--accent);
}
```

## 6. Crear un selector

Inyecta `ThemeService` y muestra únicamente los modos compatibles:

```ts
import { Component, computed, inject } from '@angular/core';
import { ThemeService } from '../lib/theming/theme.service';

@Component({
  selector: 'app-theme-picker',
  template: `
    <div role="group" aria-label="Tema">
      @for (theme of themes.themes; track theme.id) {
        <button
          type="button"
          [attr.aria-pressed]="themes.theme() === theme.id"
          (click)="themes.selectTheme(theme.id)"
        >
          {{ theme.id }}
        </button>
      }
    </div>
    @if (modes().length > 1) {
      <div role="group" aria-label="Modo">
        @for (mode of modes(); track mode) {
          <button
            type="button"
            [attr.aria-pressed]="themes.mode() === mode"
            (click)="themes.selectMode(mode)"
          >
            {{ mode }}
          </button>
        }
      </div>
    }
    @if (themes.persistenceUnavailable()) {
      <p role="status">No se puede guardar la apariencia; el cambio sigue activo en memoria.</p>
    }
  `,
})
export class ThemePicker {
  readonly themes = inject(ThemeService);
  readonly modes = computed(
    () => this.themes.themes.find((theme) => theme.id === this.themes.theme())!.modes,
  );
}
```

Ejemplo ubicado en `src/app/theme-picker.ts`. Importa `ThemePicker` en el componente que lo aloje y usa `<app-theme-picker />` en su plantilla. `mode()` devuelve el modo efectivo; `preferredMode()` conserva el solicitado aunque un tema no lo admita.

## 7. Vincular una cuenta, si corresponde

Desde tu servicio de sesión, con `themes = inject(ThemeService)`:

```ts
// Al empezar a comprobar identidad: suspende escrituras individuales.
this.themes.setScope(null);

// Solo después de confirmar la cuenta; usa un ID estable, no el nombre.
this.themes.setScope(String(account.id));

// Al cerrar sesión: conserva la apariencia visible.
this.themes.setScope(null);
```

Descarta respuestas de identidad obsoletas antes de confirmar el ámbito. Un fallo de red no confirma anonimato. En rutas protegidas, espera a confirmar identidad y aplicar su tema antes de mostrar la interfaz.

La persistencia usa localStorage automáticamente: `<namespace>:global` y `<namespace>:account:<ID codificado>`. Solo las selecciones explícitas escriben; los eventos `storage` sincronizan el ámbito activo. Una cuenta sin preferencia usa `initial`. Los registros inválidos o de versiones desconocidas no se sobrescriben al leer.

Para otro almacenamiento, proporciona `THEME_STORAGE` con métodos `getItem`/`setItem` y pasa la misma implementación a `bootstrapTheme`.
