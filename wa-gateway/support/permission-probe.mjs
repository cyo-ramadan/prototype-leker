import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
await import('@whiskeysockets/baileys');
assert.throws(() => readFileSync(new URL('../../package.json', import.meta.url)), {code:'ERR_ACCESS_DENIED'});
assert.throws(() => spawnSync(process.execPath, ['--version']), {code:'ERR_ACCESS_DENIED'});
console.log('permission-probe passed');
