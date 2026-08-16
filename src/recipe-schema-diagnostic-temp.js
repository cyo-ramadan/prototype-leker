import { json } from './http.js';
import { requireManagement } from './owner-auth.js';

function names(rows) {
  return (rows.results || []).map(row => String(row.name || ''));
}

async function tableInfo(db, table) {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all();
  return result.results || [];
}

async function rowCount(db, table) {
  const exists = await db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?) AS ok").bind(table).first();
  if (!exists?.ok) return { exists: false, count: 0 };
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
  return { exists: true, count: Number(row?.count || 0) };
}

async function refCount(db, table, column) {
  const info = await tableInfo(db, table);
  if (!info.some(row => row.name === column)) return { columnExists: false, count: 0 };
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IS NOT NULL`).first();
  return { columnExists: true, count: Number(row?.count || 0) };
}

export async function handleRecipeSchemaDiagnosticTemp(request, env, pathname) {
  if (pathname !== '/api/admin/system/recipe-schema-diagnostic-temp') return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  if (request.method !== 'GET') return json({ error: 'Method diagnostic tidak didukung.' }, 405);

  const [recipeInfo, componentInfo, recipeRows, componentRows, productRefs, saleRefs, productionRefs, fkRefs] = await Promise.all([
    tableInfo(env.DB, 'manufacturing_recipes'),
    tableInfo(env.DB, 'manufacturing_recipe_components'),
    rowCount(env.DB, 'manufacturing_recipes'),
    rowCount(env.DB, 'manufacturing_recipe_components'),
    refCount(env.DB, 'products', 'linked_recipe_id'),
    refCount(env.DB, 'sale_items', 'recipe_id'),
    refCount(env.DB, 'production_runs', 'recipe_id'),
    env.DB.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' AND sql LIKE '%REFERENCES manufacturing_recipes%'").all()
  ]);

  const recipeSample = recipeRows.exists && recipeRows.count
    ? await env.DB.prepare('SELECT * FROM manufacturing_recipes ORDER BY created_at, id LIMIT 20').all()
    : { results: [] };
  const componentSample = componentRows.exists && componentRows.count
    ? await env.DB.prepare('SELECT * FROM manufacturing_recipe_components ORDER BY recipe_id, display_order, id LIMIT 50').all()
    : { results: [] };

  return json({
    diagnostic: 'TEMP_RECIPE_SCHEMA_DIAGNOSTIC_V1',
    manufacturingRecipes: {
      columns: names({ results: recipeInfo }),
      tableInfo: recipeInfo,
      rowCount: recipeRows.count,
      sample: recipeSample.results || []
    },
    manufacturingRecipeComponents: {
      columns: names({ results: componentInfo }),
      tableInfo: componentInfo,
      rowCount: componentRows.count,
      sample: componentSample.results || []
    },
    references: {
      productsLinkedRecipe: productRefs,
      saleItemsRecipe: saleRefs,
      productionRunsRecipe: productionRefs,
      foreignKeyTables: fkRefs.results || []
    }
  });
}
