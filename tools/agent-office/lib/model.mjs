import {createHash} from 'node:crypto';
export const TYPES = new Set(['session_start','work_start','tool_start','tool_end','tool_error','waiting_approval','waiting_user','turn_end','session_end','process_start','process_heartbeat','process_exit','task_written','task_report','task_claimed','inspection_start']);
const text=(v,max=160)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const id=v=>{const s=text(v,160);if(!/^[\w.:/-]{1,160}$/.test(s))throw Error('Invalid identity');return s;};
export function cleanEvent(input, now=Date.now()){
 if(!input||typeof input!=='object'||!TYPES.has(input.type))throw Error('Unsupported event');
 const e={version:1,id:id(input.id),session_id:id(input.session_id),agent_id:id(input.agent_id),type:input.type,received_at:now,occurred_at:Number.isFinite(input.occurred_at)?Math.min(now+5000,Math.max(now-86400000,input.occurred_at)):now};
 for(const k of ['name','role','project','branch','task','task_id','tool','harness','provider','model'])if(input[k])e[k]=text(input[k],k==='task'?240:100);
 if(input.file && typeof input.file==='string' && !/^(\/|\\|[A-Za-z]:)|(^|[/\\])\.\.([/\\]|$)/.test(input.file))e.file=text(input.file,200);
 e.source=['claude_hook','process_wrapper','manual'].includes(input.source)?input.source:'manual';
 e.evidence=e.source==='manual'?'REPORTED':'OBSERVED';
 if(e.type==='process_exit'){e.code=Number.isInteger(input.code)?input.code:null;e.signal=['SIGTERM','SIGINT','SIGKILL','SIGABRT','SIGSEGV'].includes(input.signal)?input.signal:null;e.cancelled=input.cancelled===true;}
 if(e.type==='inspection_start')e.office_action='inspect';
 if(e.type==='task_report')e.task_status=['OPEN','IN_PROGRESS','REPORTED','VERIFIED','DONE','BLOCKED'].includes(input.task_status)?input.task_status:'UNKNOWN';
 return e;
}
export function reduceSession(old,e){
 const s=old?{...old}:{id:e.session_id,agent_id:e.agent_id,name:e.name||'Agent baru',role:'Belum diatur',project:'Workspace',runtime:'UNKNOWN',task_status:'UNKNOWN',activity:'Sesi ditemukan',started_at:e.received_at,last_activity:e.received_at};
 if(s.agent_id!==e.agent_id)throw Error('Session identity mismatch');
 // Older events stay in history, never overwrite latest state.
 if(e.occurred_at<(s.last_order||0))return s;
 if(['EXITED','CRASHED'].includes(s.runtime)){
  if(e.type==='session_start'){s.runtime='UNKNOWN';s.process_observed=false;delete s.last_process;}
  else if(e.type!=='process_exit')return s;
 }
 s.last_order=e.occurred_at;s.last_seen=e.received_at;s.source=e.source;s.evidence=e.evidence;
 for(const k of ['name','role','project','branch','task','task_id','tool','file','harness','provider','model'])if(e[k])s[k]=e[k];
 if(e.task)s.task_source='LAUNCHER_METADATA';
 if(e.type!=='process_heartbeat'){s.last_activity=e.received_at;s.office_action=e.type==='inspection_start'?'inspect':'';}
 if(e.source==='claude_hook')s.last_hook=e.received_at;
 if(e.source==='process_wrapper'){s.last_process=e.received_at;s.process_observed=true;}
 const map={session_start:['IDLE','Siap menerima tugas'],process_start:['IDLE','Proses dimulai'],work_start:['WORKING','Mengerjakan tugas'],tool_start:['WORKING',e.tool||'Menjalankan tool'],tool_end:['WORKING','Tool selesai'],tool_error:['WORKING','Tool gagal; agent dapat melanjutkan'],waiting_approval:['WAITING_APPROVAL','Butuh persetujuan'],waiting_user:['WAITING_USER','Menunggu jawaban'],turn_end:['IDLE','Giliran selesai'],session_end:['EXITED','Sesi berakhir'],task_claimed:['WORKING','Claim tugas'],inspection_start:['WORKING','Memantau agent · dilaporkan'],task_written:['WORKING','Task berhasil ditulis']};
 if(map[e.type]){[s.runtime,s.activity]=map[e.type];if(e.type==='tool_start'){s.tool=e.tool||'Tool';s.file=e.file||'';}if(e.type==='task_written')s.board_until=e.received_at+8000;if(e.type==='task_claimed')s.claim_until=e.received_at+8500;}
 if(e.type==='process_exit'){s.runtime=!e.cancelled&&(e.signal||e.code!==0)?'CRASHED':'EXITED';s.activity=e.cancelled?'Dihentikan pengguna':e.code===0?'Proses selesai normal':'Proses berakhir abnormal';s.exit_code=e.code;s.signal=e.signal;}
 if(e.type==='task_report'){s.task_status=e.task_status;s.activity='Laporan task diterima';}
 return s;
}
export function presentSession(s, now=Date.now(),profile={}){
 const terminal=['EXITED','CRASHED'].includes(s.runtime),age=now-(s.last_process||s.last_seen||0);
 let telemetry=terminal?'ENDED':s.process_observed?(age>90000?'DISCONNECTED':age>45000?'STALE':'CONNECTED'):(age>90000?'STALE':'EVENTS_ONLY');
 if(s.restored&&!terminal)telemetry='STALE';
 const stalled=s.runtime==='WORKING'&&telemetry==='CONNECTED'&&now-s.last_activity>600000;
 return {...s,...profile,id:s.id,agent_id:s.agent_id,telemetry,warning:stalled?'POSSIBLY_STALLED':null,age:Math.max(0,now-s.last_seen)};
}
export function identity(value){return createHash('sha256').update(value).digest('hex').slice(0,20);}
