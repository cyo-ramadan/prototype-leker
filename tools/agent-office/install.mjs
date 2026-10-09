import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const EVENTS=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','SessionEnd'];
function command(){const quote=s=>`"${s.replaceAll('\\','/')}"`;const p=fileURLToPath(new URL('./hook.mjs',import.meta.url));if(/["\r\n$`%]/.test(p+process.execPath))throw Error('Install path has unsupported shell characters; move folder to a simple path');return `${quote(process.execPath)} ${quote(p)}`;}
export function modifySettings(settings,cmd,remove=false){const result=structuredClone(settings);if(result.hooks!==undefined&&(typeof result.hooks!=='object'||Array.isArray(result.hooks)))throw Error('Invalid existing hooks');result.hooks??={};
 for(const ev of EVENTS){let groups=result.hooks[ev]||[];if(!Array.isArray(groups))throw Error(`Invalid hook group ${ev}`);groups=groups.map(g=>({...g,hooks:(g.hooks||[]).filter(h=>h.command!==cmd)})).filter(g=>g.hooks.length);if(!remove)groups.push({hooks:[{type:'command',command:cmd,timeout:2}]});if(groups.length)result.hooks[ev]=groups;else delete result.hooks[ev];}
 return result;
}
export function installHooks(cwd,remove=false){const dir=join(resolve(cwd),'.claude'),path=join(dir,'settings.local.json');mkdirSync(dir,{recursive:true});const existing=existsSync(path)?readFileSync(path,'utf8'):'{}';const settings=JSON.parse(existing),next=modifySettings(settings,command(),remove);const stamp=Date.now();if(existsSync(path))writeFileSync(`${path}.maxi-backup-${stamp}`,existing,{flag:'wx',mode:0o600});writeFileSync(path,JSON.stringify(next,null,2)+'\n',{mode:0o600});return path;}
