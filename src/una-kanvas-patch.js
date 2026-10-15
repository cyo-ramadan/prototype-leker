// Closed, data-only canvas format. Shared with the browser by build-peta-una.
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v, keys) => plain(v) && Object.keys(v).every(k => keys.includes(k));
const integer = (n, min = 0, max = 10000) => Number.isSafeInteger(n) && n >= min && n <= max;
const idValid = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const fields = {
  stroke: ['points','size'], text: ['x','y','text','fontSize'], rect: ['x','y','w','h','fill'],
  ellipse: ['x','y','w','h','fill'], line: ['x1','y1','x2','y2','size'], arrow: ['x1','y1','x2','y2','size']
};
function validField(key,value){
  if(key==='color')return color(value);
  if(key==='fill')return value===null||color(value);
  if(key==='text')return typeof value==='string'&&value.length<=500;
  if(key==='points')return Array.isArray(value)&&value.length>0&&value.length<=2000&&value.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>integer(n)));
  return ['z','x','y','w','h','x1','y1','x2','y2','size','fontSize'].includes(key)&&integer(value,['size','fontSize'].includes(key)?1:0);
}
export function validateCanvasObject(o) {
  if (!plain(o) || !Object.hasOwn(fields,o.type) || !closed(o,['id','type','z','color',...fields[o.type]])
    || !idValid(o.id) || !integer(o.z) || !color(o.color)) return false;
  for (const key of fields[o.type]) {
    const v = o[key];
    if (key === 'points') {
      if (!Array.isArray(v) || !v.length || v.length > 2000 || !v.every(p => Array.isArray(p) && p.length === 2 && p.every(n => integer(n)))) return false;
    } else if (key === 'text') { if (typeof v !== 'string' || v.length > 500) return false; }
    else if (key === 'fill') { if (v !== null && !color(v)) return false; }
    else if (!integer(v,['size','fontSize'].includes(key) ? 1 : 0)) return false;
  }
  return true;
}
export function validateCanvas(content) {
  return closed(content,['width','height','background','objects']) && integer(content.width,1) && integer(content.height,1)
    && ['white','grid'].includes(content.background) && Array.isArray(content.objects) && content.objects.length <= 2000
    && content.objects.every(validateCanvasObject) && new Set(content.objects.map(o => o.id)).size === content.objects.length;
}
export function validateCanvasOperation(operation) {
  if (!plain(operation)) return false;
  if (operation.op === 'add') return closed(operation,['op','object']) && validateCanvasObject(operation.object);
  if (!idValid(operation.id)) return false;
  if (operation.op === 'remove') return closed(operation,['op','id']);
  if (operation.op === 'reorder') return closed(operation,['op','id','z']) && integer(operation.z);
  if (operation.op === 'update') return closed(operation,['op','id','set']) && plain(operation.set) && Object.keys(operation.set).length > 0
    && Object.entries(operation.set).every(([k,v])=>validField(k,v));
  return false;
}
export function applyCanvasPatch(content, operations) {
  if (!validateCanvas(content) || !Array.isArray(operations) || !operations.length || operations.length > 50 || !operations.every(validateCanvasOperation)) throw new Error('Patch kanvas tidak valid.');
  const next = JSON.parse(JSON.stringify(content));
  for (const operation of operations) {
    const index = next.objects.findIndex(o => o.id === operation.id);
    if (operation.op === 'add') {
      if (next.objects.some(o => o.id === operation.object.id)) throw new Error('ID objek sudah ada.');
      next.objects.push(JSON.parse(JSON.stringify(operation.object)));
    } else {
      if (index < 0) throw new Error('Objek tidak ditemukan.');
      if (operation.op === 'remove') next.objects.splice(index,1);
      else if (operation.op === 'reorder') next.objects[index].z = operation.z;
      else next.objects[index] = {...next.objects[index],...operation.set};
    }
  }
  if (!validateCanvas(next)) throw new Error('Hasil patch kanvas tidak valid.');
  return next;
}
