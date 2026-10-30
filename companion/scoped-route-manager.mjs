// One core pause binding, with replaceable QQ routes after fully awaited stop.
import {bindRouteLifecycle} from './route-lifecycle.mjs';
export class ScopedRouteManager{
 constructor(){this.current=null;this.core=null;this.binding=null;}
 create(build){
  if(this.current&&!this.current.route.closed)throw Error('Duplicate live isolated QQ route');
  const route=build(),entry={route,started:false};this.current=entry;
  const start=route.world.start;
  route.world.start=async(...args)=>{
   if(route.closed||this.current!==entry)throw Error('Closed QQ route cannot be mounted again');
   const result=await start.apply(route.world,args);entry.started=true;
   if(this.current!==entry||route.closed)throw Error('QQ route replaced while mounting');
   if(!this.core||this.core.bus.isPaused())await route.pause();else route.resume();
   return result;
  };
  return route.world;
 }
 attachCore(core){
  if(this.core||!core?.bus?.isPaused())throw Error('Attach scoped manager once while core is paused');
  this.core=core;
  this.binding=bindRouteLifecycle(core.bus,{
   pause:()=>this.current?.route.pause(),
   resume:()=>{if(this.current?.started&&!this.current.route.closed)this.current.route.resume();},
  });
 }
 async drain(){await this.binding?.drain();await this.current?.route.drain();}
 status(){const entry=this.current,ready=!!entry?.started&&!entry.route.closed&&!entry.route.service.closed;
  let capabilities=null;try{capabilities=entry?.route.capabilityStatus?.()??null;}catch{}
  if(capabilities&&!ready)capabilities={...capabilities,items:Object.fromEntries(Object.entries(capabilities.items).map(([key,value])=>[key,{...value,available:false,blocker:'route-not-ready'}]))};
  return {prepared:!!entry,ready,closed:entry?.route.closed??null,paused:entry?.route.service.paused??null,accepting:ready&&!entry.route.service.paused,capabilities};}
}
