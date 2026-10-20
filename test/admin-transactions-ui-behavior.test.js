import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const nodes = new Map();
  class Element {
    constructor() {
      this.events = {}; this.dataset = {}; this.value = ''; this.children = []; this.html = ''; this.disabled = false;
      const classes = new Set();
      this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, on) => { const enabled = on ?? !classes.has(x); if (enabled) classes.add(x); else classes.delete(x); return enabled; } };
    }
    set className(value) { value.split(/\s+/).forEach(x => this.classList.add(x)); }
    set innerHTML(html) { this.html = html; parse(html); }
    get innerHTML() { return this.html; }
    insertAdjacentHTML(_, html) { parse(html); }
    appendChild(node) { this.children.push(node); }
    addEventListener(event, handler) { (this.events[event] ||= []).push(handler); }
    querySelectorAll() { return []; }
    async emit(event) { for (const handler of this.events[event] || []) handler({target:this,preventDefault(){}}); await flush(); }
  }
  function parse(html) {
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const node = new Element(); node.id = match[1]; node.className = match[0].match(/\bclass="([^"]*)"/)?.[1] || ''; nodes.set(match[1], node);
    }
  }
  const tabs = new Element(); nodes.set('adminToast',new Element());
  const requests = []; let responder = () => ({ transactions: [], creators: [{value:'ADMIN:other-page',label:'Admin <lain> (ADMIN)'}], paymentMethods: [{value:'CASH',label:'Tunai'},{value:'BANK',label:'Transfer Bank'}], hasMore: false });
  const document = {
    getElementById: id => nodes.get(id), createElement: () => new Element(),
    querySelector: selector => selector === '.admin-tabs' ? tabs : null,
    querySelectorAll: selector => selector === '.admin-tab' ? tabs.children : selector === '.admin-section' ? [...nodes.values()].filter(n=>n.classList.contains('admin-section')) : []
  };
  runInNewContext(source,{ document, window:{}, location:{origin:'https://example.test'}, URL, Intl, Date, Number, String, Map, setTimeout, clearTimeout,
    fetch: async path => { requests.push(new URL(path,'https://example.test')); const payload = await responder(); return { ok:true,json:async()=>payload }; } });
  return { nodes, requests, tabs, respond:fn=>{responder=fn;}, activate:()=>tabs.children[0].emit('click') };
}
const sale = id => ({id,kind:'SALE',description:id,occurredAt:'2026-10-20T00:00:00.000Z',creatorName:'Kasir',paymentMethod:'CASH',amount:1000,status:'posted'});

test('admin starts at all time, keeps off-page creators and escapes their labels', async () => {
  const h=harness(); await h.activate();
  assert.equal(h.requests[0].searchParams.get('from'),null); assert.equal(h.requests[0].searchParams.get('to'),null);
  const options=h.nodes.get('adminTransactionsCreator').innerHTML;
  assert.match(options,/ADMIN:other-page/); assert.match(options,/Admin &lt;lain&gt;/); assert.doesNotMatch(options,/<lain>/);
  assert.doesNotMatch(h.nodes.get('adminTransactionsBayar').innerHTML,/value="CASH"/);
  assert.match(h.nodes.get('adminTransactionsBayar').innerHTML,/value="TUNAI"/);
});
test('admin combines search, payment, creator, kind and page size in the request', async () => {
  const h=harness(); await h.activate();
  for(const [id,value] of [['Filter','OPERATIONS'],['Bayar','REKENING'],['Creator','ADMIN:other-page'],['Limit','20']]) { const n=h.nodes.get('adminTransactions'+id); n.value=value; await n.emit('change'); }
  h.nodes.get('adminTransactionsSearch').value='Supplier'; await h.nodes.get('adminTransactionsSearchForm').emit('submit');
  const q=h.requests.at(-1).searchParams;
  for(const [key,value] of [['filter','OPERATIONS'],['bayar','REKENING'],['createdBy','ADMIN:other-page'],['limit','20'],['q','Supplier'],['includeCreators','0']]) assert.equal(q.get(key),value);
});
test('WIB date range uses explicit timezone and Semua waktu clears both ends', async () => {
  const h=harness(); await h.activate();
  h.nodes.get('adminTransactionsFrom').value='2026-10-20T07:00'; h.nodes.get('adminTransactionsTo').value='2026-10-21T07:00';
  await h.nodes.get('adminTransactionsTo').emit('change');
  assert.equal(h.requests.at(-1).searchParams.get('from'),'2026-10-20T00:00:00.000Z');
  assert.equal(h.requests.at(-1).searchParams.get('to'),'2026-10-21T00:00:00.000Z');
  await h.nodes.get('adminTransactionsAllTime').emit('click');
  assert.equal(h.requests.at(-1).searchParams.get('from'),null); assert.equal(h.requests.at(-1).searchParams.get('to'),null);
  h.nodes.get('adminTransactionsFrom').value='2026-10-22T07:00'; h.nodes.get('adminTransactionsTo').value='2026-10-21T07:00';
  const before=h.requests.length; await h.nodes.get('adminTransactionsTo').emit('change');
  assert.equal(h.requests.length,before); assert.match(h.nodes.get('adminTransactionsList').innerHTML,/Tanggal awal harus sebelum/);
});
test('filter change resets pagination and a second load-more click cannot duplicate a page', async () => {
  const h=harness(); h.respond(()=>({transactions:[sale('first')],nextCursor:'2026-10-20T00:00:00.000Z|first',hasMore:true})); await h.activate();
  let finish; h.respond(()=>new Promise(resolve=>{finish=resolve;}));
  await h.nodes.get('adminTransactionsMore').emit('click');
  assert.equal(h.requests.at(-1).searchParams.get('before'),'2026-10-20T00:00:00.000Z|first');
  const count=h.requests.length; await h.nodes.get('adminTransactionsMore').emit('click'); assert.equal(h.requests.length,count);
  finish({transactions:[sale('second')],hasMore:false}); await flush();
  h.respond(()=>({transactions:[],hasMore:false})); h.nodes.get('adminTransactionsCreator').value='ADMIN:x'; await h.nodes.get('adminTransactionsCreator').emit('change');
  assert.equal(h.requests.at(-1).searchParams.get('before'),null);
});
test('a slow response for the old filter cannot overwrite the latest results', async () => {
  const h=harness(); let stale;
  h.respond(()=>new Promise(resolve=>{stale=resolve;})); await h.activate();
  h.respond(()=>({transactions:[sale('latest')],hasMore:false}));
  h.nodes.get('adminTransactionsFilter').value='SALES'; await h.nodes.get('adminTransactionsFilter').emit('change');
  stale({transactions:[sale('stale')],hasMore:false}); await flush();
  assert.match(h.nodes.get('adminTransactionsList').innerHTML,/latest/); assert.doesNotMatch(h.nodes.get('adminTransactionsList').innerHTML,/stale/);
});
