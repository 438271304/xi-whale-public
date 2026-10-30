// Fixed compiler adapter. stdin only; no filesystem entries, project plugins,
// evaluation, package resolution, network or emitted files. Trusted compiler only.
'use strict';
const esbuild=require('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/node_modules/esbuild/lib/main.js');
const MAX_INPUT=600000,MAX_OUTPUT=2000000;
let size=0,chunks=[];
const fail=message=>{throw Error(message);};
const logical=name=>typeof name==='string'&&name.length<=256&&name.split('/').length<=4&&name.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part));
const codePath=name=>logical(name)&&/\.(?:js|mjs)$/.test(name);
const dynamic=/\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r\n?|\n|$))*\(/u;
function checkedCode(code){
 // All dynamic imports are deliberately unsupported, including nonliteral
 // expressions that bundlers may otherwise leave for runtime resolution.
 // Conservative matching can reject quoted/commented import(...) text too.
 if(dynamic.test(code))fail('Dynamic import is unsupported; use static relative imports.');
 return code;
}
function diagnostic(error){
 const messages=error?.errors?.map(item=>item.text)??[error?.message??'Module compilation failed'];
 return messages.slice(0,4).map(message=>String(message).slice(0,400)).join('; ');
}
async function compile(input){
 if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['files','entries'].includes(key)))fail('Expected only frozen files and module entries.');
 const files=input.files,entries=input.entries;
 if(!files||Array.isArray(files)||typeof files!=='object'||Object.keys(files).length>80)fail('Invalid frozen file map.');
 for(const [name,text] of Object.entries(files))if(!logical(name)||typeof text!=='string')fail('Invalid snapshot logical path or text.');
 if(!Array.isArray(entries)||!entries.length||entries.length>24)fail('Choose 1–24 module entries.');
 const outputs=[];let outputBytes=0;
 for(const entry of entries){
  try{
   if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>!['path','contents'].includes(key))||
    Object.hasOwn(entry,'path')===Object.hasOwn(entry,'contents'))fail('Choose a snapshot path or one inline entry.');
   if(Object.hasOwn(entry,'path')&&(!codePath(entry.path)||!Object.hasOwn(files,entry.path)))fail('Module entry is absent from the frozen snapshot.');
   if(Object.hasOwn(entry,'contents')&&typeof entry.contents!=='string')fail('Invalid inline module text.');
   const plugin={name:'frozen-workroom-only',setup(build){
    // Every resolution is intercepted. Nothing falls through to disk/node_modules.
    build.onResolve({filter:/.*/},args=>{
     if(args.kind==='entry-point'){
      if(args.path!=='frozen-entry')return {errors:[{text:'Unexpected entry point.'}]};
      return Object.hasOwn(entry,'path')?{path:entry.path,namespace:'snapshot'}:{path:'inline',namespace:'snapshot-inline'};
     }
     if(args.kind!=='import-statement')return {errors:[{text:'Only static relative module imports are supported.'}]};
     if(!args.path.startsWith('./'))return {errors:[{text:'Only ./ relative snapshot imports are allowed; no packages, URLs, absolute paths or traversal.'}]};
     const relative=args.path.slice(2),base=args.namespace==='snapshot'?args.importer.split('/').slice(0,-1):[];
     const name=[...base,relative].join('/');
     if(!codePath(relative)||!codePath(name)||!Object.hasOwn(files,name))return {errors:[{text:'Imported module is not an allowed frozen snapshot path.'}]};
     return {path:name,namespace:'snapshot'};
    });
    build.onLoad({filter:/.*/,namespace:'snapshot'},args=>({contents:checkedCode(files[args.path]),loader:'js'}));
    build.onLoad({filter:/.*/,namespace:'snapshot-inline'},()=>({contents:checkedCode(entry.contents),loader:'js'}));
   }};
   const result=await esbuild.build({entryPoints:['frozen-entry'],plugins:[plugin],bundle:true,write:false,platform:'browser',format:'iife',
    target:'es2020',logLevel:'silent',metafile:true,treeShaking:true,legalComments:'none',charset:'utf8'});
   // In particular import.meta would otherwise become an empty object in IIFE
   // output. Surface that unsupported behavior instead of hiding broken buttons.
   if(result.warnings.length)fail('Module transformation needs attention: '+result.warnings.map(item=>item.text).join('; '));
   if(result.outputFiles?.length!==1||Object.values(result.metafile.outputs).some(output=>output.imports.some(item=>item.external)))fail('Compilation left external or extra outputs.');
   const code=result.outputFiles[0].text;outputBytes+=Buffer.byteLength(code);
   if(outputBytes>MAX_OUTPUT)fail('Compiled output limit exceeded.');
   outputs.push({ok:true,code});
  }catch(error){outputs.push({ok:false,error:diagnostic(error)});}
 }
 return {ok:outputs.every(output=>output.ok),outputs,compiler:esbuild.version};
}
process.stdin.on('data',chunk=>{size+=chunk.length;if(size>MAX_INPUT){process.stderr.write('Frozen bundle input limit exceeded.');process.exit(1);}chunks.push(chunk);});
process.stdin.on('end',async()=>{
 try{
  const result=await compile(JSON.parse(Buffer.concat(chunks).toString('utf8'))),text=JSON.stringify(result);
  if(Buffer.byteLength(text)>MAX_OUTPUT)fail('Compiled response limit exceeded.');
  process.stdout.write(text);
 }catch(error){process.stdout.write(JSON.stringify({ok:false,outputs:[],error:diagnostic(error)}));process.exitCode=1;}
 finally{esbuild.stop();}
});
