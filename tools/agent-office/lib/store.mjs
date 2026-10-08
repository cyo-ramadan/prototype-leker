import {DatabaseSync} from 'node:sqlite';
import {cleanEvent,reduceSession,presentSession} from './model.mjs';
export class Store{
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=1048576; CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, received INTEGER, data TEXT); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, data TEXT)');this.sessions=new Map(this.db.prepare('SELECT id,data FROM sessions').all().map(r=>[r.id,{...JSON.parse(r.data),restored:true}]));this.profiles=new Map(this.db.prepare('SELECT id,data FROM profiles').all().map(r=>[r.id,JSON.parse(r.data)]));this.count=0;this.prune();}
 accept(input,now=Date.now()){
 const e=cleanEvent(input,now);if(this.db.prepare('SELECT id FROM events WHERE id=?').get(e.id))return false;
 if(!this.sessions.has(e.session_id)&&this.sessions.size>=200)throw Error('Session limit reached; retention will clear old sessions');
 const next=reduceSession(this.sessions.get(e.session_id),e);if(next.last_seen===e.received_at)delete next.restored;
 this.db.exec('BEGIN');try{this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(e.id,now,JSON.stringify(e));this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?)').run(next.id,JSON.stringify(next));this.db.exec('COMMIT');}catch(err){this.db.exec('ROLLBACK');throw err;}
 this.sessions.set(next.id,next);if(++this.count%100===0)this.prune(now);return true;
 }
 profile(id,input){if(!this.sessions.has(id))throw Error('Unknown session');const aid=this.sessions.get(id).agent_id;const p={};for(const k of ['name','role']){if(typeof input[k]==='string')p[k]=input[k].replace(/[\u0000-\u001f]/g,' ').slice(0,60);}if(/^#[\da-f]{6}$/i.test(input.color||''))p.color=input.color;if(['human','cat','robot','bunny'].includes(input.character))p.character=input.character;const merged={...this.profiles.get(aid),...p};this.profiles.set(aid,merged);this.db.prepare('INSERT OR REPLACE INTO profiles VALUES(?,?)').run(aid,JSON.stringify(merged));return merged;}
 snapshot(now=Date.now()){return {at:now,sessions:[...this.sessions.values()].map(s=>presentSession(s,now,this.profiles.get(s.agent_id))).sort((a,b)=>b.last_seen-a.last_seen),events:this.db.prepare('SELECT data FROM events ORDER BY received DESC,rowid DESC LIMIT 60').all().map(r=>JSON.parse(r.data)),coverage:{claude:'Hooks lokal',process:'Wrapper opsional',cloud:'Belum terhubung',board:'Belum terhubung'},llm_calls:0};}
 prune(now=Date.now()){this.db.prepare('DELETE FROM events WHERE received<?').run(now-7*86400000);this.db.exec('DELETE FROM events WHERE rowid NOT IN (SELECT rowid FROM events ORDER BY received DESC,rowid DESC LIMIT 20000)');for(const [id,s]of this.sessions)if((s.last_seen||0)<now-7*86400000){this.sessions.delete(id);this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);}this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
 close(){this.db.close();}
}
