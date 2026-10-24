export const ROSTER={karen:{name:'Karen',role:'Pelaksana tugas',character:'karen',color:'#927bb7',home:[8.4,4.55]},hana:{name:'Hana',role:'Task & strategi · pantau agent',character:'hana',color:'#7f9e8e',home:[11.6,1.5]},elle:{name:'Elle',role:'Pendamping · tanya-jawab ringan',character:'elle',color:'#829ebd',home:[5.3,9.0]}};
export function persona(s){const explicit=String(s.character||'').toLowerCase();if(ROSTER[explicit])return explicit;const name=String(s.name||'').trim().toLowerCase();return Object.keys(ROSTER).find(k=>name===k||name.startsWith(k+' ')||name.startsWith(k+'-')||new RegExp('^'+k+'\\d').test(name))||null;}
export function withPersona(s){const key=persona(s);return key?{...s,...ROSTER[key],name:s.name||ROSTER[key].name,character:key}:s;}
export function roleTarget(s,index,others=[],now=Date.now()){
 const key=persona(s),desk=[[8.4,4.55],[11.5,4.55],[8.4,8],[11.5,8]][index%4];
 if(s.runtime==='IDLE'){const seed=[...String(s.id)].reduce((n,c)=>n+c.charCodeAt(0),0),phase=Math.floor((now+seed*997)/13000)%6;if(key==='elle')return phase===3?[5.9,8.2]:ROSTER.elle.home;const stops=[[3,8.6],[3.6,6.2],[3.6,6.2],[13,8.8],[13.6,8.1],[3,8.6]];const d=stops[phase];return [d[0]+index*.16,d[1]+index*.12];}
 if(key==='elle')return ROSTER.elle.home;
 if(s.runtime==='WORKING'&&(s.board_until>now||s.claim_until>now))return [11.6,1.5];
 if(key==='hana'&&s.runtime==='WORKING'){
  if(s.office_action==='inspect'){const colleagues=others.filter(x=>persona(x)!=='hana'&&persona(x)!=='elle'&&!['EXITED','CRASHED'].includes(x.runtime));if(colleagues.length){const chosen=colleagues[Math.floor(now/6500)%colleagues.length],i=others.indexOf(chosen),d=[[8.4,4.55],[11.5,4.55],[8.4,8],[11.5,8]][i%4];return [d[0]-.9,d[1]+.4];}}
  return ROSTER.hana.home;
 }
 return key==='karen'?ROSTER.karen.home:desk;
}
