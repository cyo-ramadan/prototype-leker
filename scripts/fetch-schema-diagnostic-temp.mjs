const url='https://prototype-leker-v2.daily-napkin.workers.dev/schema-diagnostic-temp.json';
let payload=null;
for(let attempt=1;attempt<=36;attempt+=1){
  try{
    const response=await fetch(`${url}?t=${Date.now()}`,{headers:{accept:'application/json','cache-control':'no-cache'}});
    if(response.ok){
      const candidate=await response.json();
      if(candidate?.diagnostic==='TEMP_REMOTE_SCHEMA_ARTIFACT_V1'){payload=candidate;break;}
    }
    console.log(`attempt ${attempt}: HTTP ${response.status}`);
  }catch(error){console.log(`attempt ${attempt}: ${error.message}`)}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!payload)throw new Error('Temporary production schema diagnostic artifact did not become available.');
console.log('=== PRODUCTION SCHEMA DIAGNOSTIC ARTIFACT ===');
console.log(JSON.stringify(payload,null,2));
