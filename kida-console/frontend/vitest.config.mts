import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // Ionic 8 uses directory imports that need Vite's browser resolution.
        inline: [/\/arca\//, /@ionic\//, /@stencil\//, /ionicons\//],
      },
    },
  },
});
