import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

console.log('Executing agular postbuild script');

const source = fileURLToPath(new URL('../dist/frontend/browser/', import.meta.url));
const destination = fileURLToPath(new URL('../../backend/static/', import.meta.url));

if (!existsSync(source)) {
  throw new Error(`Angular build not found: ${source}`);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });

console.log('Angular build copied to backend/static');
