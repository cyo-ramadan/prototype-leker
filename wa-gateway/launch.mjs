import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

export function restrictedArgs(entry = join(here, 'server.mjs')) {
  mkdirSync(join(here, 'data'), { recursive: true, mode: 0o700 });
  return ['--permission', `--allow-fs-read=${here}`, `--allow-fs-write=${join(here, 'data')}`, entry];
}
export function cleanEnvironment(source = process.env) {
  const allowed = new Set(['systemroot','windir','path','temp','tmp','comspec','pathext','wa_tenant','wa_port','wa_autoconnect']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = spawn(process.execPath, restrictedArgs(), {
    cwd: here, env: cleanEnvironment(), stdio:'inherit', windowsHide:true
  });
  child.on('error', () => { console.error('Gateway gagal dijalankan. Gunakan Node >=22.13.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
}
