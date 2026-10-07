// Reproduce the offline runtime assets, validating publisher SHA-256 digests.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const lock=JSON.parse(await readFile(require.resolve('pyodide/pyodide-lock.json'),'utf8'));
const packages=[],seen=new Set();
async function asset(url,filename,sha256,loader='wheel'){
  const body=Buffer.from(await(await fetch(url)).arrayBuffer());
  if(createHash('sha256').update(body).digest('hex')!==sha256)throw Error('Digest mismatch: '+filename);
  await writeFile(new URL('../../public/forum-dl/'+filename,import.meta.url),body);
  packages.push({filename,sha256,loader,url});
}
async function pyodide(name){
  if(seen.has(name))return;seen.add(name);
  const pkg=lock.packages[name];for(const dependency of pkg.depends)await pyodide(dependency);
  await asset('https://cdn.jsdelivr.net/pyodide/v0.29.3/full/'+pkg.file_name,pkg.file_name,pkg.sha256,'pyodide');
}
for(const name of ['lxml','regex','beautifulsoup4','python-dateutil','pytz'])await pyodide(name);
for(const [name,version] of [['pydantic','1.10.26'],['tenacity','9.1.4'],['dateparser','1.2.2'],['tzlocal','5.3.1'],['html2text','2025.4.15']]){
  const metadata=await(await fetch(`https://pypi.org/pypi/${name}/${version}/json`)).json();
  const wheel=metadata.urls.find(item=>item.filename.endsWith('py3-none-any.whl')||item.filename.endsWith('py2.py3-none-any.whl'));
  if(!wheel)throw Error('No pure wheel: '+name);await asset(wheel.url,wheel.filename,wheel.digests.sha256);
}
await writeFile(new URL('./packages.json',import.meta.url),JSON.stringify(packages,null,2)+'\n');
