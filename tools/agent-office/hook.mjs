import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {basename,relative,isAbsolute,resolve} from 'node:path';
import {identity} from './lib/model.mjs';
import {send} from './lib/config.mjs';
export function fromClaude(input,env=process.env){
 const cwd=typeof input.cwd==='string'?input.cwd:process.cwd(),native=String(input.session_id||'');if(!native)return null;
 const event=input.hook_event_name,map={SessionStart:'session_start',UserPromptSubmit:'work_start',PreToolUse:'tool_start',PostToolUse:'tool_end',PostToolUseFailure:'tool_error',PermissionRequest:'waiting_approval',Stop:'turn_end',SessionEnd:'session_end'};
 let type=map[event];if(event==='Notification')type=input.notification_type==='permission_prompt'?'waiting_approval':input.notification_type==='idle_prompt'?'waiting_user':null;
 if(event==='PostToolUse'&&['TaskCreate','TaskUpdate','TodoWrite'].includes(input.tool_name))type='task_written';
 if(event==='PostToolUse'&&/(^|__)board_claim_task$/.test(input.tool_name||''))type='task_claimed';
 if(event==='PostToolUse'&&/(^|__)board_(create_task|update_open_task)$/.test(input.tool_name||''))type='task_written';
 if(!type)return null;
 const e={id:randomUUID(),session_id:env.MAXI_MONITOR_RUN||`claude:${identity(native)}`,agent_id:env.MAXI_AGENT_ID||`claude:${identity(resolve(cwd))}`,source:'claude_hook',type,occurred_at:Date.now(),name:env.MAXI_AGENT_NAME||'Agent baru',role:env.MAXI_AGENT_ROLE||'Belum diatur',project:env.MAXI_AGENT_PROJECT||basename(cwd),task:env.MAXI_AGENT_TASK||'',harness:'Claude Code',provider:env.MAXI_AGENT_PROVIDER||'',model:env.ANTHROPIC_MODEL||'',tool:typeof input.tool_name==='string'?input.tool_name:''};
 const f=input.tool_input?.file_path||input.tool_input?.path;if(typeof f==='string'){const p=relative(cwd,resolve(cwd,f));if(p&&!p.startsWith('..')&&!isAbsolute(p))e.file=p.replaceAll('\\','/');}
 return e;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let input='',oversized=false;const deadline=setTimeout(()=>process.exit(0),1800);deadline.unref();
 try{for await(const chunk of process.stdin){if(Buffer.byteLength(input)+chunk.length>1048576){oversized=true;break;}input+=chunk;}if(!oversized){const e=fromClaude(JSON.parse(input));if(e)await send(e);}}catch{}finally{clearTimeout(deadline);}
 // Observational hooks never emit a decision or block Claude.
}
