// Pure validation shared by server and generated browser bundle. No DOM or I/O.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const keywords = {
  object: ['type','properties','required','additionalProperties','default','description'],
  string: ['type','maxLength','enum','pattern','format','default','description'],
  integer: ['type','minimum','maximum','default','description'],
  boolean: ['type','default','description'],
  array: ['type','items','maxItems','default','description']
};
export function dateValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
}
export function validateSchema(schema, depth = 0) {
  if (!plain(schema) || depth > 12) throw new Error('Invalid capability schema');
  if (schema.type === 'object' && own(schema,'ref')) {
    if (!/^[a-z]+\.[a-z_]+$/.test(schema.ref) || Object.keys(schema).some(k => !['type','ref','description'].includes(k))) throw new Error('Invalid schema ref');
    return;
  }
  const allowed = keywords[schema.type];
  if (!allowed || Object.keys(schema).some(k => !allowed.includes(k))) throw new Error('Unsupported schema keyword');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !plain(schema.properties) || !Array.isArray(schema.required)) throw new Error('Object schema must be closed');
    for (const key of schema.required) if (!own(schema.properties,key)) throw new Error('Unknown required field');
    for (const [key,child] of Object.entries(schema.properties)) {
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Forbidden schema property');
      validateSchema(child,depth+1);
    }
  }
  if (schema.type === 'string') {
    if (!Number.isInteger(schema.maxLength) || schema.maxLength < 1) throw new Error('String length required');
    if (schema.format !== undefined && schema.format !== 'date') throw new Error('Unsupported string format');
    if (schema.pattern !== undefined) new RegExp(schema.pattern);
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.some(v => typeof v !== 'string'))) throw new Error('Invalid enum');
  }
  if (schema.type === 'integer' && [schema.minimum,schema.maximum].some(v => v !== undefined && !Number.isSafeInteger(v))) throw new Error('Invalid integer bounds');
  if (schema.type === 'array') {
    if (!Number.isInteger(schema.maxItems) || schema.maxItems < 1) throw new Error('Array length required');
    if (!['string','integer'].includes(schema.items?.type) && !(schema.items?.type==='object'&&schema.items.ref)) throw new Error('Unsupported array item schema');
    validateSchema(schema.items,depth+1);
  }
}
function paramError(path, clarification = false) { return { ok:false, path, clarification }; }
export function validateParams(schema, value, refs = {}, path = 'params', depth = 0) {
  if (depth > 12) return paramError(path);
  if (schema.ref) {
    const fn = refs[schema.ref];
    if (typeof fn !== 'function') return paramError(path);
    try { return fn(value) === true ? {ok:true,value:JSON.parse(JSON.stringify(value))} : paramError(path); }
    catch { return paramError(path); }
  }
  if (schema.type === 'object') {
    if (!plain(value)) return paramError(path);
    for (const key of Object.keys(value)) if (!own(schema.properties,key)) return paramError(path+'.'+key);
    // Unknown keys take precedence over incomplete input, so injected fields never become clarification.
    for (const key of schema.required) if (!own(value,key) || value[key] === '' || value[key] === null) return paramError(path+'.'+key,true);
    const normalized = {};
    for (const [key,child] of Object.entries(schema.properties)) {
      if (!own(value,key)) {
        if (own(child,'default')) normalized[key] = child.default;
        continue;
      }
      const result = validateParams(child,value[key],refs,path+'.'+key,depth+1);
      if (!result.ok) return result;
      normalized[key] = result.value;
    }
    return {ok:true,value:normalized};
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > schema.maxLength) return paramError(path);
    if (schema.format === 'date' && !dateValid(value)) return paramError(path,true);
    if (schema.enum && !schema.enum.includes(value)) return paramError(path);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return paramError(path);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return paramError(path);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return paramError(path);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) return paramError(path);
    const normalized = [];
    for (let i=0;i<value.length;i++) {
      const result = validateParams(schema.items,value[i],refs,path+'['+i+']',depth+1);
      if (!result.ok) return result;
      normalized.push(result.value);
    }
    return {ok:true,value:normalized};
  } else return paramError(path);
  return {ok:true,value};
}
export function rejectAction(command, status, code, message) {
  return {
    actionId: typeof command?.actionId === 'string' ? command.actionId : null,
    capabilityId: typeof command?.capabilityId === 'string' ? command.capabilityId : null,
    status,code,message,surfaceId:command?.target?.surfaceId || null,resultRevision:null,
    summary:{},proof:null,clarification:status === 'needs_clarification' ? {question:message,options:[]} : null,replayed:false
  };
}
export function relevantCapability(descriptor, context) {
  if (!descriptor.preconditions.some(p=>p==='surface_active'||p==='page_mounted')) return true;
  const hint=context.surfaceContext||context;
  const surface=context.surface||{kind:hint.surfaceKind,content:hint.page};
  if (!surface.kind || descriptor.surfaceKind && surface.kind!==descriptor.surfaceKind) return false;
  return !descriptor.page || surface.content?.halaman===descriptor.page.halaman && surface.content?.tab===descriptor.page.tab;
}
export function validateAction(command, context, capabilities, options = {}) {
  const reject = (status,code,message) => ({ok:false,receipt:rejectAction(command,status,code,message)});
  if (!plain(command) || !Number.isSafeInteger(command.scopeEpoch) || command.scopeEpoch !== context.scopeEpoch) return reject('stale','SCOPE_CHANGED','Lingkup percakapan sudah berubah.');
  const descriptor = capabilities.find(c => c.id === command.capabilityId);
  if (!descriptor || command.capabilityVersion !== descriptor.version) return reject('rejected','UNKNOWN_CAPABILITY','Kemampuan tidak tersedia.');
  const role = String(context.role || context.peran || '').toUpperCase().replace(/[ -]/g,'_');
  if (!descriptor.roles.includes(role)) return reject('rejected','ROLE_DENIED','Akses untuk tindakan ini tidak tersedia.');
  if (!descriptor.scopes.includes(context.lingkup)) return reject('rejected','SCOPE_DENIED','Tindakan tidak tersedia dalam lingkup ini.');
  if(Object.keys(command).some(k=>!['actionId','turnId','capabilityId','capabilityVersion','params','target','scopeEpoch','origin'].includes(k)))return reject('rejected','INVALID_PARAMS','Perintah tindakan tidak valid.');
  const params = validateParams(descriptor.params,command.params,options.refs);
  if (!params.ok) return reject(params.clarification?'needs_clarification':'rejected','INVALID_PARAMS',params.clarification?'Lengkapi atau periksa '+params.path+'.':'Parameter tindakan tidak valid.');
  if (params.value.from && params.value.to && params.value.from > params.value.to) return reject('needs_clarification','INVALID_PARAMS','Tanggal awal harus sebelum atau sama dengan tanggal akhir.');
  const page = descriptor.id === 'page.open' ? params.value : descriptor.page;
  if (page) {
    const menus = options.menuUntuk?.({skin:context.skin || 'classic',peran:role,halaman:page.halaman}) || [];
    if (!menus.some(m => m.halaman === page.halaman && m.tab === page.tab)) return reject('rejected','FORBIDDEN_TARGET','Halaman tidak tersedia untuk akses dan tampilan ini.');
  }
  const target = command.target;
  const surface = context.surface || null;
  if (target !== null && target !== undefined && (!plain(target) || typeof target.surfaceId !== 'string' || !Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 1 || Object.keys(target).some(k => !['surfaceId','expectedRevision'].includes(k)))) return reject('rejected','INVALID_PARAMS','Target lembar tidak valid.');
  const conditions = {
    surface_active: !!target && !!context.activeSurfaceId && !!surface && surface.id === context.activeSurfaceId && target.surfaceId === surface.id,
    page_mounted: !!target && target.surfaceId === surface?.id && !!context.pageMounted && (!descriptor.page || (surface?.content?.halaman === descriptor.page.halaman && surface?.content?.tab === descriptor.page.tab)),
    scope_entity: context.lingkup === 'entity',
    scope_store: context.lingkup === 'gerai',
    canvas_saved: surface?.kind === 'canvas' && Number.isSafeInteger(surface.revision) && surface.revision >= 1 && !context.dirty
  };
  if (descriptor.preconditions.some(p => conditions[p] !== true)) return reject('rejected','PRECONDITION_FAILED','Buka lembar yang sesuai sebelum menjalankan tindakan.');
  if (target && (!surface || target.surfaceId !== surface.id || target.expectedRevision !== surface.revision)) return reject('rejected','REVISION_CONFLICT','Lembar sudah berubah. Periksa versi terbaru.');
  if (target && context.dirty && ['view','artifact'].includes(descriptor.category)) return reject('rejected','REVISION_CONFLICT','Simpan atau periksa edit lokal sebelum menjalankan tindakan.');
  if (typeof command.actionId !== 'string' || !/^[\w-]{1,100}$/.test(command.actionId) || typeof command.turnId !== 'string' || !/^[\w-]{1,100}$/.test(command.turnId) || !['model','code','user'].includes(command.origin)) return reject('rejected','INVALID_PARAMS','Identitas tindakan tidak valid.');
  return {ok:true,descriptor,command:{...command,params:params.value}};
}
