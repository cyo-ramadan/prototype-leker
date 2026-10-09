import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function walk(p){for(const e of readdirSync(p,{withFileTypes:true})){const q=join(p,e.name);if(e.isDirectory())walk(q);else if(/\.(mjs|js)$/.test(q)){const r=spawnSync(process.execPath,['--check',q],{stdio:'inherit'});if(r.status)process.exit(r.status);}}}walk(fileURLToPath(new URL('.',import.meta.url)));console.log('Syntax checks passed');
