import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('./',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const css=read('web/style.css'),office=read('web/office.js').replaceAll('export ',''),app=read('web/app.js').replace(/^import .*\n/,'').replace("demo=new URLSearchParams(location.search).get('demo')==='1'","demo=true").replace('render();connect();','render();');
const script=(office+'\n'+app).replaceAll('</script','<\\/script');
const html=read('web/index.html').replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`).replace('<script type="module" src="/app.js"></script>',`<script type="module">${script}</script>`).replace('href="/" aria-label','href="#" aria-label');
writeFileSync(new URL('preview.html',root),html);console.log('preview.html dibuat: demo offline, tanpa server atau API.');
