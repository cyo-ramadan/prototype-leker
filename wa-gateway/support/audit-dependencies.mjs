import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('package-lock.json',root),'utf8').replace(/^\uFEFF/,''));
const packages=Object.entries(lock.packages).filter(([path])=>path);
const issues=[]; const lifecycle=[];
for (const [path,pkg] of packages) {
  if (!pkg.resolved?.startsWith('https://registry.npmjs.org/') || !pkg.integrity?.startsWith('sha512-')) issues.push(path);
  if (pkg.hasInstallScript) lifecycle.push(path);
}
console.log(JSON.stringify({packages:packages.length,registryOrIntegrityIssues:issues,packagesWithInstallScripts:lifecycle,scriptPolicy:readFileSync(new URL('.npmrc',root),'utf8').trim()},null,2));
if(issues.length) process.exitCode=1;
