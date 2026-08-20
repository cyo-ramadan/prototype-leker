import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-setting-transaksi-fase3-temp.mjs';
let source = readFileSync(path, 'utf8');

const replacements = [
  ["\\`${side}:${accountId}\\`", "\\`\\${side}:\\${accountId}\\`"],
  ["\\`${current.description}; ${description}\\`", "\\`\\${current.description}; \\${description}\\`"],
  ["\\`${rule.label} · ${choice.option.name}\\`", "\\`\\${rule.label} · \\${choice.option.name}\\`"]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`BOOTSTRAP_ESCAPE_ANCHOR_MISSING:${from}`);
  source = source.split(from).join(to);
}

writeFileSync(path, source);
