import {test} from 'node:test';
import assert from 'node:assert/strict';
await import('../cloud/build.mjs');
const {sanitizeSnapshot}=await import('../cloud/worker.mjs');
test('cloud snapshot drops secrets and raw payload, bounds timestamps and size',()=>{const now=Date.now();const s=sanitizeSnapshot({sessions:[{id:'session-1',agent_id:'hana',name:'Hana',prompt:'SECRET',environment:{TOKEN:'SECRET'},last_seen:now+999999,process_observed:true}],events:[{id:'event-1',session_id:'session-1',agent_id:'hana',type:'tool_start',source:'claude_hook',raw:'SECRET'}]},now);assert.equal(JSON.stringify(s).includes('SECRET'),false);assert.equal(s.sessions[0].last_seen,now+5000);assert.throws(()=>sanitizeSnapshot({sessions:Array(201).fill({}),events:[]}));assert.throws(()=>sanitizeSnapshot({sessions:[{id:'invalid space'}],events:[]}));});
