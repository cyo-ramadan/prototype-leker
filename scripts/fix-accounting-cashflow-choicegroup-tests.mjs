import { readFileSync, writeFileSync } from 'node:fs';

function replaceRequired(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Fix miss: ${label}`);
  return next;
}

{
  const path = 'test/accounting-cash-flow-bridge.test.js';
  let source = readFileSync(path, 'utf8');
  source = replaceRequired(
    source,
    "  assert.match(bridge, /source_type === 'fixed_account'/);",
    "  assert.match(bridge, /choice_group/);\n  assert.match(bridge, /fixed_account/);",
    'legacy bridge assertion'
  );
  writeFileSync(path, source);
}

{
  const path = 'test/accounting-flow-presets.test.js';
  let source = readFileSync(path, 'utf8');
  source = replaceRequired(
    source,
    /assert\.match\(script,/g,
    'assert.match(ui,',
    'flow preset test variable'
  );
  writeFileSync(path, source);
}

console.log('Choice Group test assertions aligned.');
