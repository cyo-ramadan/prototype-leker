(() => {
  if (window.parent === window || new URLSearchParams(location.search).get('ownerPortal') !== '1') return;
  try { if (window.parent.location.origin !== location.origin) return; } catch { return; }
  const tab = new URLSearchParams(location.hash.slice(1)).get('tab') || 'products';
  const allowed = new Set(['products','stock','store','cashiers','attendance-report','beaops','hutangpiutang','transactions','categories','suppliers','contacts']);
  let opened = false;
  function update() {
    const on = window.MaxiSkin?.skin?.() === 'h' && window.parent.MaxiSkin?.skin?.() === 'h';
    document.body.classList.toggle('owner-entity-embed', on);
    if (!on) return;
    document.body.classList.remove('maxi-home-active', 'maxi-more-active');
    const app=document.getElementById('adminApp');
    if (!opened && app && !app.classList.contains('hidden') && allowed.has(tab)) {
      const button=document.querySelector('[data-tab="'+tab+'"]');
      if(button) { opened=true; button.click(); }
    }
    window.parent.postMessage({type:'owner-entity-height',height:document.documentElement.scrollHeight}, location.origin);
  }
  const style=document.createElement('style');
  style.textContent='html[data-skin="h"] body.owner-entity-embed {background:#fff!important;} html[data-skin="h"] body.owner-entity-embed > .topbar, html[data-skin="h"] body.owner-entity-embed #adminApp > .admin-tabs, html[data-skin="h"] body.owner-entity-embed #adminApp > .nav-groups, html[data-skin="h"] body.owner-entity-embed .admin-workspace-switcher, html[data-skin="h"] body.owner-entity-embed #maxiTodayHome {display:none!important;} html[data-skin="h"] body.owner-entity-embed .admin-shell {padding:4px;max-width:none;margin:0;}';
  document.head.append(style);
  let scheduled=false;
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;update();});}
  new MutationObserver(schedule).observe(document.getElementById('adminApp') || document.body,{attributes:true,childList:true,subtree:true});
  if(window.ResizeObserver) new ResizeObserver(schedule).observe(document.body);
  window.addEventListener('maxi-skin-change',schedule);
  Promise.resolve(window.MaxiSkin?.ready).then(schedule);
})();
