import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {dataHome} from '../lib/config.mjs';
import {join} from 'node:path';
const input=process.argv[2];if(!input)throw Error('Gunakan: node cloud/connect.mjs /path/office-connection.json');
const c=JSON.parse(readFileSync(input,'utf8'));const url=new URL(c.url);if(url.protocol!=='https:'||url.hostname!=='maxi-agent-office.daily-napkin.workers.dev'||!/^[a-f0-9]{64}$/.test(c.producer||'')||!/^[a-f0-9]{64}$/.test(c.viewer||''))throw Error('Invalid connection package');
const home=dataHome();mkdirSync(home,{recursive:true,mode:0o700});writeFileSync(join(home,'cloud.json'),JSON.stringify({url:c.url,device:'bos-laptop',producer:c.producer}),{mode:0o600});
writeFileSync(join(home,'open-cloud-office.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${c.url}/#access=${c.viewer}"><title>MAXI Cloud Office</title><a href="${c.url}/#access=${c.viewer}">Buka MAXI Cloud Office</a>`,{mode:0o600});console.log(`Cloud terhubung. Restart collector, lalu buka ${join(home,'open-cloud-office.html')}. Jangan upload file connection atau launcher pribadi.`);
