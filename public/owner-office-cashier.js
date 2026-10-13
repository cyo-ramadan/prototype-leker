// Office credentials live only in the two related window closures, never storage or URLs.
(() => {
  const ORIGIN = location.origin;
  const intent = new URLSearchParams(location.search).get('ownerOfficeEmbed') === '1';
  let trustedParent = false;
  try { trustedParent = intent && parent !== window && parent.location.origin === ORIGIN && parent.OwnerOfficeCashier?.acceptsFrame(window); } catch {}
  if (trustedParent) {
    window.OwnerOfficeEmbed = true;
    let token = '', received = null, ready = false, started = false, stopped = false;
    const originalFetch = window.fetch.bind(window);
    function stop(message) {
      stopped = true; token = '';
      if (typeof state !== 'undefined') { state.token='';state.canWrite=false;state.draft.clear(); }
      document.querySelectorAll('dialog[open]').forEach(d=>d.close());
      const app=document.querySelector('.app-shell');if(app)app.textContent=message;
      parent.postMessage({type:'owner-office:error',message},ORIGIN);
    }
    window.ownerOfficeStop=stop;
    window.fetch=async(input,options={})=>{
      const request=input instanceof Request?input:null,url=new URL(request?request.url:String(input),ORIGIN);
      if(url.origin!==ORIGIN||!/^\/api\/(cashier|staff)\//.test(url.pathname))return originalFetch(input,options);
      if(!token||stopped)return new Response(JSON.stringify({error:'Sesi Kantor berakhir.',code:'OWNER_OFFICE_SESSION_ENDED'}),{status:403,headers:{'Content-Type':'application/json'}});
      const headers=new Headers(options.headers||request?.headers||{});headers.set('Authorization','Bearer '+token);
      const response=await originalFetch(input,{...options,headers});
      if([401,403].includes(response.status)){
        const data=await response.clone().json().catch(()=>({}));
        if(response.status===401||String(data.code||'').startsWith('OWNER_OFFICE'))stop(data.error||'Akses Kantor telah berubah. Muat ulang portal.');
      }
      return response;
    };
    async function boot(){
      if(!ready||!received||started||stopped)return;
      started=true;token=received.token;state.token=token;
      await init();
      if(!stopped&&state.cashier) install();
    }
    function install(){
      document.body.classList.add('owner-office-embedded');
      const style=document.createElement('style');style.textContent=
        'body.owner-office-embedded{background:transparent!important}.owner-office-embedded .topbar,.owner-office-embedded .drawer-command-card,.owner-office-embedded #cashierTopActions,.owner-office-embedded #customerApprovalBtn,.owner-office-embedded #openDrawerBtn,.owner-office-embedded #closeDrawerBtn,.owner-office-embedded #drawerDetailsBtn{display:none!important}.owner-office-embedded .app-shell,.owner-office-embedded .cashier-wrap{max-width:none;padding:0}.office-taskbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 14px}.office-taskbar button{min-height:46px}.office-subactions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.office-subactions[hidden]{display:none}.owner-office-embedded .cashier-pos-layout{margin-top:0}.owner-office-embedded .cashier-pos-layout .cashier-draft-panel{position:static}@media(max-width:650px){.owner-office-embedded .cashier-pos-layout{grid-template-columns:1fr}}';
      document.head.append(style);
      const dash=document.getElementById('cashierDashboard'),bar=document.createElement('nav');
      bar.className='office-taskbar';bar.setAttribute('aria-label','Transaksi Kantor');
      const cash=document.createElement('div'),others=document.createElement('div');
      cash.className=others.className='office-subactions';cash.hidden=others.hidden=true;
      for(const id of ['expenseBtn','otherIncomeBtn','cashFlowBtn']){const b=document.getElementById(id);if(b)cash.append(b);}
      for(const id of ['stockAdjustmentBtn','productionBtn','goodsFlowBtn','assetBtn','reportsBtn']){const b=document.getElementById(id);if(b)others.append(b);}
      for(const [label,action]of [
        ['Jual',()=>{cash.hidden=others.hidden=true;document.querySelector('.cashier-pos-layout')?.scrollIntoView({block:'start'});}],
        ['Beli',()=>document.getElementById('purchaseBtn')?.click()],
        ['Catat uang',()=>{cash.hidden=!cash.hidden;others.hidden=true;}],
        ['Lainnya',()=>{others.hidden=!others.hidden;cash.hidden=true;}]
      ]){const b=document.createElement('button');b.type='button';b.className=label==='Jual'?'primary-btn':'secondary-btn';b.textContent=label;b.onclick=action;bar.append(b);}
      dash.prepend(bar,cash,others);
      const height=()=>parent.postMessage({type:'owner-office:height',height:Math.max(600,document.documentElement.scrollHeight)},ORIGIN);
      new ResizeObserver(height).observe(document.body);height();
      parent.postMessage({type:'owner-office:ready'},ORIGIN);
    }
    window.addEventListener('message',event=>{
      if(event.origin!==ORIGIN||event.source!==parent)return;
      if(event.data?.type==='owner-office:session'&&typeof event.data.token==='string'&&!started){received=event.data;void boot();}
      if(event.data?.type==='owner-office:stop')stop('Kantor tidak aktif pada tampilan ini.');
    });
    document.addEventListener('DOMContentLoaded',()=>{ready=true;parent.postMessage({type:'owner-office:request-session'},ORIGIN);void boot();},{once:true});
    window.addEventListener('maxi-skin-change',()=>{if(started&&window.MaxiSkin?.skin?.()!=='h')stop('Skin telah berubah. Sesi Kantor dihentikan.');});
    return;
  }
  let active=null;
  function destroy(){
    if(!active)return;
    const old=active;active=null;old.token='';
    old.frame?.contentWindow?.postMessage({type:'owner-office:stop'},ORIGIN);
    window.removeEventListener('message',old.receive);old.frame?.remove();old.host.replaceChildren();
  }
  window.OwnerOfficeCashier={
    acceptsFrame(frameWindow){return Boolean(active?.frame&&active.frame.contentWindow===frameWindow);},
    destroy,
    async mount(host,options){
      destroy();
      const s=active={host,options,frame:null,token:'',receive:null};host.textContent='Menyiapkan kasir Kantor…';
      try{
        const response=await fetch('/api/management/owner-office/session?entity='+encodeURIComponent(options.entityId),{method:'POST',headers:{Authorization:'Bearer '+options.getToken()}});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Kantor belum dapat dibuka.');
        if(active!==s)return;
        s.token=data.token;
        const frame=document.createElement('iframe');s.frame=frame;
        frame.title='Kasir Kantor';frame.style.cssText='width:100%;min-height:700px;border:0;display:block';frame.setAttribute('allow','camera');
        s.receive=event=>{
          if(active!==s||event.origin!==ORIGIN||event.source!==frame.contentWindow)return;
          if(event.data?.type==='owner-office:request-session')frame.contentWindow.postMessage({type:'owner-office:session',token:s.token},ORIGIN);
          if(event.data?.type==='owner-office:height')frame.style.height=Math.min(9000,Math.max(600,Number(event.data.height)||700))+'px';
          if(event.data?.type==='owner-office:error'){s.token='';options.onError?.(event.data.message);}
        };
        window.addEventListener('message',s.receive);
        frame.src='/s/'+encodeURIComponent(data.storeCode)+'/cashier?ownerOfficeEmbed=1';
        host.replaceChildren(frame);
      }catch(error){if(active===s){host.textContent=error.message;options.onError?.(error.message);}}
    }
  };
})();
