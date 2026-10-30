import {fork} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const app='C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app';
const root='C:/Users/USER/PersonalAgentRuntime/whale-v1';
if(process.argv[2]==='child'){
  await import(pathToFileURL(join(app,'build/cortico/src/extensions/runtime.ts')).href);
  const selector=join(root,'core-entry.json');
  const entry=existsSync(selector)?JSON.parse(readFileSync(selector,'utf8')).entry:'legacy';
  if(!['legacy','scoped'].includes(entry))throw Error('Unknown validated core entry');
  const {main}=await import(pathToFileURL(join(app,entry==='scoped'?'core/companion.scoped-candidate.ts':'core/companion.ts')).href);
  await main();
}else{
  const lock=join(root,'launcher.lock');
  if(existsSync(lock)){
    const prior=Number(readFileSync(lock,'utf8'));
    let alive=true;try{process.kill(prior,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
    if(alive)throw new Error('Whale launcher already running');
    unlinkSync(lock);
  }
  const original=JSON.parse(readFileSync('D:/Coopanion/data/home/companion/config.json','utf8'));
  if(original.worlds?.qq?.enabled!==false)throw new Error('Original QQ client must be disabled first');
  writeFileSync(lock,String(process.pid),{flag:'wx'});
  process.on('exit',()=>{if(existsSync(lock)&&readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock);});
  const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
    USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,
    CORTICO_HOME:join(root,'home'),CORTICO_EXTENSIONS_DIR:join(root,'extensions'),
    COOPANION_CHANNEL:'portable',COOPANION_VERSION:'0.2.8-whale-v1',WHALE_START_PAUSED:'1'};
  const child=fork(fileURLToPath(import.meta.url),['child'],{env,silent:true,
    execArgv:['--import',pathToFileURL(join(app,'node_modules/tsx/dist/loader.mjs')).href]});
  const receipt=join(root,'runtime.json');
  const save=value=>writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),supervisor:process.pid,pid:child.pid,...value},null,2));
  save({state:'starting'});
  child.stdout.on('data',b=>appendFileSync(join(root,'runtime.log'),b));
  child.stderr.on('data',b=>appendFileSync(join(root,'runtime.log'),b));
  child.on('message',message=>{if(message.type==='companion:ready')save({state:'ready-paused',port:message.port,keyMissing:message.keyMissing});});
  child.on('exit',code=>{save({state:'stopped',code});process.exitCode=code??1;});
}
