/* Data-only canvas editor; model reading belongs to U7. */
(() => {
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  function createModel(content,revision=1,onChange=()=>{}){
    const rules=window.UnaKanvasPatch;if(!rules.validateCanvas(content))throw new Error('Kanvas tidak valid.');
    let current=clone(content),savedRevision=revision,serial=0;const undo=[],redo=[];
    const changed=()=>{serial++;onChange(clone(current));};
    function patch(operations,expectedRevision=savedRevision){
      if(expectedRevision!==savedRevision)throw Object.assign(new Error('Kanvas sudah berubah.'),{code:'REVISION_CONFLICT'});
      const next=rules.applyCanvasPatch(current,operations);undo.push(current);if(undo.length>100)undo.shift();redo.length=0;current=next;changed();return clone(current);
    }
    return {patch,content:()=>clone(current),revision:()=>savedRevision,serial:()=>serial,
      setRevision:value=>{savedRevision=value;},
      undo:()=>{if(!undo.length)return false;redo.push(current);current=undo.pop();changed();return true;},
      redo:()=>{if(!redo.length)return false;undo.push(current);current=redo.pop();changed();return true;},
      replace:(value,rev)=>{if(!rules.validateCanvas(value))throw new Error('Kanvas tidak valid.');current=clone(value);savedRevision=rev;undo.length=0;redo.length=0;serial++;},
      freeze:()=>freeze({revision:savedRevision,editSerial:serial,content:clone(current)})};
  }
  function bounds(o){
    if(o.type==='stroke'){const xs=o.points.map(p=>p[0]),ys=o.points.map(p=>p[1]);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
    if(['line','arrow'].includes(o.type))return{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),w:Math.abs(o.x2-o.x1),h:Math.abs(o.y2-o.y1)};
    return {x:o.x,y:o.y,w:o.w??Math.max(20,o.text.length*o.fontSize*.65),h:o.h??o.fontSize};
  }
  function moved(o,dx,dy){
    const b=bounds(o);dx=Math.max(-b.x,Math.min(10000-b.x-b.w,dx));dy=Math.max(-b.y,Math.min(10000-b.y-b.h,dy));
    if(o.type==='stroke')return {points:o.points.map(([x,y])=>[x+dx,y+dy])};
    if(['line','arrow'].includes(o.type))return{x1:o.x1+dx,y1:o.y1+dy,x2:o.x2+dx,y2:o.y2+dy};
    return{x:o.x+dx,y:o.y+dy};
  }
  function render(canvas,content,selection=[],preview=null){
    canvas.width=content.width;canvas.height=content.height;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,content.width,content.height);
    if(content.background==='grid'){ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<content.width;x+=25){ctx.moveTo(x,0);ctx.lineTo(x,content.height);}for(let y=0;y<content.height;y+=25){ctx.moveTo(0,y);ctx.lineTo(content.width,y);}ctx.stroke();}
    for(const o of [...content.objects,...(preview?[preview]:[])].sort((a,b)=>a.z-b.z)){
      ctx.strokeStyle=o.color;ctx.fillStyle=o.fill||o.color;ctx.lineWidth=o.size||2;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
      if(o.type==='stroke'){ctx.moveTo(...o.points[0]);for(const p of o.points.slice(1))ctx.lineTo(...p);if(o.points.length===1){ctx.lineTo(o.points[0][0]+.1,o.points[0][1]);}ctx.stroke();}
      else if(o.type==='text'){ctx.font=`${o.fontSize}px sans-serif`;ctx.textBaseline='top';ctx.fillText(o.text,o.x,o.y);}
      else if(o.type==='rect'){ctx.rect(o.x,o.y,o.w,o.h);if(o.fill)ctx.fill();ctx.stroke();}
      else if(o.type==='ellipse'){ctx.ellipse(o.x+o.w/2,o.y+o.h/2,o.w/2,o.h/2,0,0,2*Math.PI);if(o.fill)ctx.fill();ctx.stroke();}
      else {ctx.moveTo(o.x1,o.y1);ctx.lineTo(o.x2,o.y2);if(o.type==='arrow'){const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=12;ctx.lineTo(o.x2-len*Math.cos(a-.45),o.y2-len*Math.sin(a-.45));ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a+.45),o.y2-len*Math.sin(a+.45));}ctx.stroke();}
      if(selection.includes(o.id)){const b=bounds(o);ctx.strokeStyle='#2563eb';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.strokeRect(b.x-4,b.y-4,b.w+8,b.h+8);ctx.setLineDash([]);}
    }
  }
  function mount(host,options){
    const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
    const root=make('div',null,'una-canvas-editor'),tools=make('div',null,'una-canvas-tools'),viewport=make('div',null,'una-canvas-viewport');
    const canvas=make('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Lembar gambar. Pilih alat lalu gambar; undo tersedia lewat tombol.');viewport.append(canvas);
    const status=make('p','','una-canvas-status');status.setAttribute('role','status');
    const text=make('input');text.type='text';text.maxLength=500;text.placeholder='Teks untuk diletakkan';text.setAttribute('aria-label','Teks gambar');
    const color=make('input');color.type='color';color.value='#1f2937';color.setAttribute('aria-label','Warna pena');
    let tool='pen',zoom=1,selection=[],gesture=null,draft=null,disposed=false;
    const model=createModel(options.surface.content,options.surface.revision,content=>{options.onChange(content);draw();});
    const draw=()=>{if(!disposed)render(canvas,model.content(),selection,draft);};
    const act=(label,action)=>{const b=make('button',label,'mini-btn');b.type='button';b.addEventListener('click',()=>{try{action();}catch(e){status.textContent=e.message;}});tools.append(b);return b;};
    const toolButtons=[];
    for(const [key,label] of [['pen','Pena'],['eraser','Penghapus'],['select','Pilih / pindah'],['text','Teks'],['rect','Kotak'],['ellipse','Elips'],['line','Garis'],['arrow','Panah'],['pan','Geser lembar']]){
      const b=act(label,()=>{tool=key;for(const [k,n] of toolButtons)n.setAttribute('aria-pressed',String(k===key));});toolButtons.push([key,b]);b.setAttribute('aria-pressed',String(key===tool));
    }
    act('Undo',()=>model.undo());act('Redo',()=>model.redo());act('Hapus pilihan',()=>{if(selection.length){model.patch(selection.map(id=>({op:'remove',id})));selection=[];draw();}});
    const setZoom=value=>{zoom=Math.max(.25,Math.min(3,value));canvas.style.width=model.content().width*zoom+'px';canvas.style.height=model.content().height*zoom+'px';};
    act('Perkecil',()=>setZoom(zoom-.25));act('Perbesar',()=>setZoom(zoom+.25));act('Ekspor PNG',()=>exportPNG());tools.append(color,text);
    act('Tutup tampilan lembar',()=>{void window.UnaLembar.close(options.surface.id);});
    root.append(tools,viewport,status);host.append(root);
    function position(event){const rect=canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(10000,(event.clientX-rect.left)*canvas.width/rect.width))),Math.round(Math.max(0,Math.min(10000,(event.clientY-rect.top)*canvas.height/rect.height)))];}
    function hit(p){return model.content().objects.sort((a,b)=>b.z-a.z).find(o=>{const b=bounds(o);return p[0]>=b.x-8&&p[0]<=b.x+b.w+8&&p[1]>=b.y-8&&p[1]<=b.y+b.h+8;});}
    function pointerDown(event){
      if(event.button!==0||gesture)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);const p=position(event),id='o_'+crypto.randomUUID(),z=Math.min(10000,Math.max(0,...model.content().objects.map(o=>o.z))+1);
      gesture={pointerId:event.pointerId,start:p,last:p,client:[event.clientX,event.clientY],scroll:[viewport.scrollLeft,viewport.scrollTop]};status.textContent='';
      if(tool==='pan')return;
      if(tool==='eraser'){const o=hit(p);if(o)model.patch([{op:'remove',id:o.id}]);return;}
      if(tool==='select'){const o=hit(p);selection=o?[o.id]:[];gesture.object=o;draw();return;}
      if(tool==='text'){if(!text.value.trim()){status.textContent='Isi teks sebelum menaruhnya.';return;}model.patch([{op:'add',object:{id,type:'text',z,x:p[0],y:p[1],text:text.value,fontSize:18,color:color.value}}]);return;}
      if(tool==='pen')draft={id,type:'stroke',z,color:color.value,size:3,points:[p]};
      else if(['rect','ellipse'].includes(tool))draft={id,type:tool,z,color:color.value,fill:null,x:p[0],y:p[1],w:0,h:0};
      else draft={id,type:tool,z,color:color.value,size:3,x1:p[0],y1:p[1],x2:p[0],y2:p[1]};draw();
    }
    function pointerMove(event){
      if(!gesture||event.pointerId!==gesture.pointerId)return;const p=position(event);gesture.last=p;
      if(tool==='pan'){viewport.scrollLeft=gesture.scroll[0]-(event.clientX-gesture.client[0]);viewport.scrollTop=gesture.scroll[1]-(event.clientY-gesture.client[1]);return;}
      if(!draft)return;
      if(tool==='pen'){if(draft.points.length<2000)draft.points.push(p);}
      else if(['rect','ellipse'].includes(tool)){draft.x=Math.min(p[0],gesture.start[0]);draft.y=Math.min(p[1],gesture.start[1]);draft.w=Math.abs(p[0]-gesture.start[0]);draft.h=Math.abs(p[1]-gesture.start[1]);}
      else {draft.x2=p[0];draft.y2=p[1];}draw();
    }
    function finish(event){
      if(!gesture||event.pointerId!==gesture.pointerId)return;
      try{
        if(event.type!=='pointercancel'){
          if(draft){const object=draft;draft=null;model.patch([{op:'add',object}]);}
          else if(tool==='select'&&gesture.object){const p=position(event);model.patch([{op:'update',id:gesture.object.id,set:moved(gesture.object,p[0]-gesture.start[0],p[1]-gesture.start[1])}]);}
        }
      }catch(error){status.textContent=error.message;}
      finally{draft=null;gesture=null;draw();}
    }
    function exportPNG(){const output=make('canvas');render(output,model.content());output.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='lembar-gambar.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);},'image/png');}
    async function snapshot(objectIds){
      const frozen=model.freeze(),output=make('canvas');render(output,frozen.content);
      const png=output.toDataURL('image/png');if(png.split(',')[1].length>1_500_000)throw new Error('Gambar terlalu besar untuk dibaca. Ekspor PNG atau sederhanakan gambar.');
      return freeze({surfaceId:options.surface.id,revision:frozen.revision,editSerial:frozen.editSerial,png,
        objects:clone(frozen.content.objects.filter(o=>!objectIds||objectIds.includes(o.id)))});
    }
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
    setZoom(Math.min(1,(host.clientWidth||800)/model.content().width));draw();
    return {model,snapshot,exportPNG,setRevision:model.setRevision,replace:(content,revision)=>{model.replace(content,revision);selection=[];draw();},
      applyPatch:(operations,expectedRevision)=>model.patch(operations,expectedRevision),
      destroy:()=>{disposed=true;canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',finish);canvas.removeEventListener('pointercancel',finish);root.remove();}};
  }
  function bind(registry){
    registry.register('canvas.create',{execute:async p=>{const s=await window.UnaLembar.newCanvas(p);return {ok:!!s,surfaceId:s?.id,resultRevision:s?.revision,proof:{kind:'artifact_saved',at:new Date().toISOString()}};},verify:r=>!!r.surfaceId&&r.resultRevision>=1});
    registry.register('canvas.apply_patch',{execute:async(p,exec)=>{
      const s=window.UnaLembar.active(),entry=window.UnaLembar.client().get(s.id);if(entry.dirty)return {ok:false,code:'REVISION_CONFLICT'};
      window.UnaLembar.editor(s.id).applyPatch(p.operations,exec.command.target.expectedRevision);
      const saved=await window.UnaLembar.save(s.id);if(!saved)return {ok:false,code:'REVISION_CONFLICT',message:'Perubahan tetap di layar; penyimpanan belum berhasil.'};
      const latest=window.UnaLembar.client().get(s.id).surface;
      return {ok:true,surfaceId:latest.id,resultRevision:latest.revision,proof:{kind:'artifact_saved',at:new Date().toISOString()}};
    },verify:r=>window.UnaLembar.client().get(r.surfaceId)?.surface.revision===r.resultRevision&&!window.UnaLembar.client().get(r.surfaceId)?.dirty});
  }
  window.UnaKanvas={createModel,mount,render,bind};
  if(window.UnaRegistry)bind(window.UnaRegistry);
})();
