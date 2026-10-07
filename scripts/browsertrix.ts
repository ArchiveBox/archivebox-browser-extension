import {build,type Plugin} from 'vite';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'node_modules/browsertrix-behaviors/package.json');

/** Build the vendored upstream engine into the recorder's isolated-world script. */
export function browsertrixSource():Plugin{
  let compiled:Promise<string>|undefined;
  return {name:'browsertrix-source',resolveId(id){if(id==='virtual:browsertrix-behaviors')return '\0'+id},async load(id){
    if(id!=='\0virtual:browsertrix-behaviors')return;
    compiled??=build({configFile:false,root,logLevel:'error',publicDir:false,resolve:{alias:{'query-selector-shadow-dom':require.resolve('query-selector-shadow-dom')}},build:{write:false,minify:true,lib:{entry:root+'vendor/browsertrix-behaviors/src/index.ts',name:'Browsertrix',formats:['iife']}}}).then(result=>{
      const output=(Array.isArray(result)?result[0]:result) as {output:{type:string;code?:string}[]};
      const code=output.output.find(item=>item.type==='chunk')?.code;if(!code)throw Error('Browsertrix bundle is empty');return `export default ${JSON.stringify(code)}`;
    });
    return compiled;
  }};
}
