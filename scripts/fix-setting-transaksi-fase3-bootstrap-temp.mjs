import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-setting-transaksi-fase3-temp.mjs';
let source = readFileSync(path, 'utf8');

const replacements = [
  ["\\`${side}:${accountId}\\`", "\\`\\${side}:\\${accountId}\\`"],
  ["\\`${current.description}; ${description}\\`", "\\`\\${current.description}; \\${description}\\`"],
  ["\\`${rule.label} · ${choice.option.name}\\`", "\\`\\${rule.label} · \\${choice.option.name}\\`"],
  [
    "INSERT INTO accounting_choice_groups (id, store_id, code, name, description, is_active)\\n    VALUES (?, ?, 'BEBAN_TETAP', 'Beban Tetap', 'Pilihan beban reusable', 1)",
    "INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active)\\n    VALUES (?, ?, 'BEBAN_TETAP', 'Beban Tetap', 1)"
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`BOOTSTRAP_PATCH_ANCHOR_MISSING:${from}`);
  source = source.split(from).join(to);
}

writeFileSync(path, source);
