import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {cloudRelay} from './cloud/relay.mjs';
import {Store} from './lib/store.mjs';
import {config,dataHome} from './lib/config.mjs';
const web=new URL('./web/',import.meta.url);
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function startServer({home=dataHome(),port,quiet=false}={}){
 const c=config(home),store=new Store(join(home,'office.sqlite')),clients=new Set(),relay=cloudRelay(home);let origin;
 const server=createServer(async(req,res)=>{
  const host=req.headers.host;
  if(!origin||host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url=new URL(req.url,origin),path=url.pathname;
  const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  async function body(){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON required');let size=0,parts=[];for await(const part of req){size+=part.length;if(size>8192)throw Error('Payload too large');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString());}
  try{
   if(path==='/api/login'&&req.method==='POST'){const b=await body();if(!equal(b.token,c.viewer))return json(401,{error:'Access denied'});res.setHeader('Set-Cookie',`office=${c.viewer}; HttpOnly; SameSite=Strict; Path=/`);return json(200,{ok:true});}
   if(path==='/api/events'&&req.method==='POST'){if(!equal(req.headers.authorization,`Bearer ${c.producer}`))return json(401,{error:'Access denied'});const accepted=store.accept(await body());if(accepted)broadcast();return json(200,{accepted});}
   if(path.startsWith('/api/')){
    const cookie=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('office='))?.slice(7);
    if(!equal(cookie,c.viewer))return json(401,{error:'Open the local launcher to connect'});
    if(path==='/api/snapshot'&&req.method==='GET')return json(200,store.snapshot());
    if(path==='/api/stream'&&req.method==='GET'){if(clients.size>=20)return json(429,{error:'Too many viewers'});res.writeHead(200,{'content-type':'text/event-stream','connection':'keep-alive'});clients.add(res);res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);req.on('close',()=>clients.delete(res));return;}
    if(path==='/api/profile'&&req.method==='POST'){const b=await body();store.profile(b.session_id,b);broadcast();return json(200,{ok:true});}
    return json(404,{error:'Unknown route'});
   }
   const files={'/':'index.html','/app.js':'app.js','/office.js':'office.js','/roster.js':'roster.js','/assets/karen.webp':'assets/karen.webp','/assets/hana.webp':'assets/hana.webp','/assets/elle.webp':'assets/elle.webp','/style.css':'style.css'};
   if(req.method!=='GET'||!files[path]){res.writeHead(404).end();return;}
   res.setHeader('content-type',path.endsWith('.webp')?'image/webp':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(new URL(files[path],web)));
  }catch(e){json(e.message==='Payload too large'?413:400,{error:e.message==='Session identity mismatch'?'Session identity mismatch':'Invalid request'});}
 });
 function broadcast(){const snapshot=store.snapshot();relay.send(snapshot);const message=`data: ${JSON.stringify(snapshot)}\n\n`;for(const res of clients){if(res.writableLength>262144){res.destroy();clients.delete(res);}else res.write(message);}}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port??c.port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 if(c.port!==server.address().port){c.port=server.address().port;writeFileSync(join(home,'connection.json'),JSON.stringify(c,null,2),{mode:0o600});}
 // Local launcher keeps the credential off terminal logs and query strings.
 writeFileSync(join(home,'open-office.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${origin}/#access=${c.viewer}"><title>MAXI Office</title><a href="${origin}/#access=${c.viewer}">Buka kantor MAXI</a>`,{mode:0o600});
 const tick=setInterval(broadcast,15000);tick.unref();const prune=setInterval(()=>store.prune(),3600000);prune.unref();
 if(!quiet)console.log(`MAXI Office: ${origin}\nDemo: ${origin}/?demo=1\nLive: buka file ${join(home,'open-office.html')}\nMonitor lokal aktif; nol panggilan model AI.`);
 return {origin,store,config:c,close:async()=>{clearInterval(tick);clearInterval(prune);relay.close();for(const r of clients)r.end();await new Promise(r=>server.close(r));store.close();}};
}
