// Lets a plain Node script import the project's TypeScript libraries directly:
//   node --import ./scripts/lib/register-ts.mjs scripts/whatever.mjs
// Node strips the types itself (v22.6+); this hook only adds the ".ts" that
// Vite would add to extensionless relative imports such as './touchoffice'.
import { register } from 'node:module';
register('./ts-resolve-hook.mjs', import.meta.url);
