import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as rules from '../src/una-kanvas-patch.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/una-live/lembar.json',import.meta.url))).surfaces.find(s=>s.kind==='canvas');
test('U0 canvas format accepts every type; unknown keys, duplicate ids and out-of-range coordinates reject',()=>{
  assert.equal(rules.validateCanvas(fixture.content),true);
  for(const extra of [{objects:[...fixture.content.objects,fixture.content.objects[0]]},{width:Infinity},{objects:[{...fixture.content.objects[0],points:[[10001,0]]}]},{html:'<script>'}])assert.equal(rules.validateCanvas({...fixture.content,...extra}),false);
  for(const object of [{id:'r',type:'ellipse',z:1,x:1,y:2,w:3,h:4,color:'#000000',fill:'#ffffff'},{id:'l',type:'line',z:1,x1:1,y1:2,x2:3,y2:4,size:2,color:'#000000'}])assert.equal(rules.validateCanvasObject(object),true);
});
test('patch is atomic, closed and immutable; model cannot change object type/id or execute code',()=>{
  const before=JSON.stringify(fixture.content);
  const patched=rules.applyCanvasPatch(fixture.content,[{op:'update',id:'o2',set:{text:'baru'}},{op:'reorder',id:'o2',z:10},{op:'remove',id:'o3'}]);
  assert.equal(patched.objects.find(o=>o.id==='o2').text,'baru');assert.equal(patched.objects.length,3);assert.equal(JSON.stringify(fixture.content),before);
  for(const ops of [[{op:'update',id:'o2',set:{type:'rect'}}],[{op:'remove',id:'o1'},{op:'remove',id:'missing'}],[{op:'update',id:'o2',set:{url:'https://example.test'}}],Array.from({length:51},()=>({op:'remove',id:'o1'}))])assert.throws(()=>rules.applyCanvasPatch(fixture.content,ops));
  for(const set of [{url:'https://example.test'},{selector:'#approve'},{x:NaN},{text:'x'.repeat(501)},{points:[[1,-1]]}])assert.equal(rules.validateCanvasOperation({op:'update',id:'o2',set}),false);
  assert.equal(JSON.stringify(fixture.content),before);
});
test('model patch is one undo step, supports redo and frozen snapshots retain older drawing',()=>{
  const window={UnaKanvasPatch:rules};vm.runInNewContext(readFileSync(new URL('../public/una-kanvas.js',import.meta.url),'utf8'),{window});
  const changes=[];const model=window.UnaKanvas.createModel(fixture.content,5,c=>changes.push(c));const snapshot=model.freeze();
  model.patch([{op:'update',id:'o2',set:{text:'updated'}},{op:'remove',id:'o3'}],5);
  assert.equal(model.content().objects.length,3);model.undo();assert.equal(model.content().objects.length,4);model.redo();assert.equal(model.content().objects.length,3);
  assert.equal(snapshot.content.objects[1].text,'rak minuman');assert.ok(Object.isFrozen(snapshot.content.objects));
  model.setRevision(6);assert.throws(()=>model.patch([{op:'remove',id:'o1'}],5),/berubah/);assert.equal(changes.length,3);
});
