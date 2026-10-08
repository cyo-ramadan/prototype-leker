import {readFileSync,writeFileSync} from 'node:fs';
const files={'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/office.js':['office.js','text/javascript'],'/style.css':['style.css','text/css']};
const assets={};for(const [key,[file,type]]of Object.entries(files))assets[key]={body:readFileSync(new URL('../web/'+file,import.meta.url),'utf8').replace('LOCAL FIRST · v0.1','CLOUD · v0.2'),type};
writeFileSync(new URL('static.mjs',import.meta.url),'export default '+JSON.stringify(assets)+';\n');
