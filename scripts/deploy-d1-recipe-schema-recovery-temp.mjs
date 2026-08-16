import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args, { json = false } = {}) {
  const result = spawnSync(npx, ['--yes', 'wrangler', ...args], {
    encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: TIMEOUT_MS, killSignal: 'SIGTERM'
  });
  if (result.error) throw new Error(`Wrangler failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Wrangler exited ${result.status}`);
  if (!json) return result.stdout;
  try { return JSON.parse(result.stdout); } catch { throw new Error(`Wrangler returned non-JSON output: ${result.stdout}`); }
}

function rows(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  const result = [];
  for (const container of containers) {
    if (Array.isArray(container?.results)) result.push(...container.results);
    else if (Array.isArray(container?.result?.results)) result.push(...container.result.results);
    else if (Array.isArray(container?.result)) result.push(...container.result);
  }
  return result;
}

function d1Json(sql) { return rows(wrangler(['d1','execute','DB','--remote','--json','--command',sql], { json: true })); }
function d1Exec(sql) { process.stdout.write(`\n${sql}\n`); wrangler(['d1','execute','DB','--remote','--command',sql]); }
function tableExists(name) { return Number(d1Json(`SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='${name}') AS ok;`)[0]?.ok || 0) === 1; }
function columns(name) { return new Set(d1Json(`PRAGMA table_info(${name});`).map(row => String(row.name || ''))); }
function count(sql) { return Number(d1Json(sql)[0]?.row_count || 0); }

console.log('Capture D1 Time Travel checkpoint before Recipe schema recovery.');
const checkpointPayload = wrangler(['d1','time-travel','info','DB','--json'], { json: true });
const checkpoint = checkpointPayload?.bookmark || checkpointPayload?.result?.bookmark || (Array.isArray(checkpointPayload) ? checkpointPayload.find(row => row?.bookmark)?.bookmark : '');
if (!checkpoint) throw new Error('Unable to capture D1 Time Travel checkpoint. Recipe recovery aborted before mutation.');
console.log(`D1 Recipe recovery checkpoint: ${checkpoint}`);

if (!tableExists('manufacturing_recipes')) throw new Error('manufacturing_recipes is missing; aborting scoped Recipe recovery.');
const recipeCols = columns('manufacturing_recipes');
const componentExists = tableExists('manufacturing_recipe_components');
const componentCols = componentExists ? columns('manufacturing_recipe_components') : new Set();
const recipeRows = count('SELECT COUNT(*) AS row_count FROM manufacturing_recipes;');
const componentRows = componentExists ? count('SELECT COUNT(*) AS row_count FROM manufacturing_recipe_components;') : 0;
const productRefs = columns('products').has('linked_recipe_id') ? count('SELECT COUNT(*) AS row_count FROM products WHERE linked_recipe_id IS NOT NULL;') : 0;
const saleRefs = columns('sale_items').has('recipe_id') ? count('SELECT COUNT(*) AS row_count FROM sale_items WHERE recipe_id IS NOT NULL;') : 0;
const productionRefs = tableExists('production_runs') && columns('production_runs').has('recipe_id') ? count('SELECT COUNT(*) AS row_count FROM production_runs WHERE recipe_id IS NOT NULL;') : 0;

console.log(JSON.stringify({ recipeColumns:[...recipeCols], componentTableExists:componentExists, componentColumns:[...componentCols], recipeRows, componentRows, productRefs, saleRefs, productionRefs }, null, 2));

const canonicalRecipe = recipeCols.has('output_quantity');
const canonicalComponents = componentExists && componentCols.has('quantity');
const legacyRecipe = recipeCols.has('output_quantity_milli') && !canonicalRecipe;
const legacyComponents = !componentExists || (componentCols.has('quantity_milli') && !canonicalComponents);

if (canonicalRecipe && canonicalComponents) {
  console.log('Recipe schema already canonical; no Recipe table mutation required.');
} else {
  if (!legacyRecipe) throw new Error(`Unexpected manufacturing_recipes shape. Refusing recovery: ${JSON.stringify([...recipeCols])}`);
  if (!legacyComponents && !canonicalComponents) throw new Error(`Unexpected manufacturing_recipe_components shape. Refusing recovery: ${JSON.stringify([...componentCols])}`);
  if (recipeRows || componentRows || productRefs || saleRefs || productionRefs) {
    throw new Error(`Recipe recovery requires empty/unreferenced legacy tables. Refusing mutation: ${JSON.stringify({recipeRows,componentRows,productRefs,saleRefs,productionRefs})}`);
  }

  d1Exec(`PRAGMA foreign_keys = ON;
DROP TRIGGER IF EXISTS trg_manufacturing_component_scope;
DROP TRIGGER IF EXISTS trg_manufacturing_recipe_scope;
DROP INDEX IF EXISTS idx_manufacturing_components_recipe_order;
DROP INDEX IF EXISTS idx_manufacturing_components_store_product;
DROP INDEX IF EXISTS idx_manufacturing_recipe_one_active_output;
DROP INDEX IF EXISTS idx_manufacturing_recipes_store_status_output;
DROP TABLE IF EXISTS manufacturing_recipe_components;
DROP TABLE manufacturing_recipes;
CREATE TABLE manufacturing_recipes (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, output_product_id INTEGER NOT NULL, output_unit_id TEXT NOT NULL,
  output_quantity INTEGER NOT NULL CHECK (output_quantity > 0), revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')), notes TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '', created_by_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, archived_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id), FOREIGN KEY (output_product_id) REFERENCES products(id),
  FOREIGN KEY (output_unit_id) REFERENCES units(id), UNIQUE (store_id, output_product_id, revision)
);
CREATE UNIQUE INDEX idx_manufacturing_recipe_one_active_output ON manufacturing_recipes(store_id, output_product_id) WHERE status='ACTIVE';
CREATE INDEX idx_manufacturing_recipes_store_status_output ON manufacturing_recipes(store_id,status,output_product_id,revision DESC);
CREATE TABLE manufacturing_recipe_components (
  id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, store_id TEXT NOT NULL, component_product_id INTEGER NOT NULL,
  component_unit_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (recipe_id) REFERENCES manufacturing_recipes(id) ON DELETE CASCADE, FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (component_product_id) REFERENCES products(id), FOREIGN KEY (component_unit_id) REFERENCES units(id),
  UNIQUE (recipe_id, component_product_id)
);
CREATE INDEX idx_manufacturing_components_recipe_order ON manufacturing_recipe_components(recipe_id,display_order,component_product_id);
CREATE INDEX idx_manufacturing_components_store_product ON manufacturing_recipe_components(store_id,component_product_id);
CREATE TRIGGER trg_manufacturing_recipe_scope BEFORE INSERT ON manufacturing_recipes
WHEN NOT EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.output_product_id AND p.store_id=NEW.store_id AND p.base_unit_id=NEW.output_unit_id)
 OR NOT EXISTS (SELECT 1 FROM units u WHERE u.id=NEW.output_unit_id AND u.store_id=NEW.store_id)
BEGIN SELECT RAISE(ABORT,'RECIPE_OUTPUT_SCOPE_MISMATCH'); END;
CREATE TRIGGER trg_manufacturing_component_scope BEFORE INSERT ON manufacturing_recipe_components
WHEN NOT EXISTS (SELECT 1 FROM manufacturing_recipes r WHERE r.id=NEW.recipe_id AND r.store_id=NEW.store_id)
 OR NOT EXISTS (SELECT 1 FROM products p WHERE p.id=NEW.component_product_id AND p.store_id=NEW.store_id AND p.base_unit_id=NEW.component_unit_id)
 OR NOT EXISTS (SELECT 1 FROM units u WHERE u.id=NEW.component_unit_id AND u.store_id=NEW.store_id)
BEGIN SELECT RAISE(ABORT,'RECIPE_COMPONENT_SCOPE_MISMATCH'); END;`);
}

const verifiedRecipeCols = columns('manufacturing_recipes');
const verifiedComponentCols = columns('manufacturing_recipe_components');
if (!verifiedRecipeCols.has('output_quantity') || verifiedRecipeCols.has('output_quantity_milli')) throw new Error(`Recipe schema verification failed: ${JSON.stringify([...verifiedRecipeCols])}`);
if (!verifiedComponentCols.has('quantity') || verifiedComponentCols.has('quantity_milli')) throw new Error(`Recipe component schema verification failed: ${JSON.stringify([...verifiedComponentCols])}`);
const fkViolations = d1Json('PRAGMA foreign_key_check;');
if (fkViolations.length) throw new Error(`Foreign-key verification failed after Recipe recovery: ${JSON.stringify(fkViolations)}`);
console.log('Canonical Recipe schema verified with no foreign-key violations.');
wrangler(['d1','migrations','apply','DB','--remote']);
const verify = spawnSync(process.execPath, ['scripts/verify-remote-schema.mjs'], { encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:TIMEOUT_MS, killSignal:'SIGTERM' });
if (verify.error || verify.status !== 0) throw new Error(verify.stderr || verify.stdout || verify.error?.message || 'Remote schema verifier failed.');
process.stdout.write(verify.stdout);
wrangler(['deploy']);
console.log(`RECIPE_SCHEMA_RECOVERY_PASS checkpoint=${checkpoint}`);
