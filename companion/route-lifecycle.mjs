// Pinned core WebUI uses bus.setPaused. Forward it synchronously so no polling gap exists.
const BOUND=Symbol('scoped-route-lifecycle');
export function bindRouteLifecycle(bus,route){
 if(bus[BOUND]||typeof bus.setPaused!=='function'||typeof bus.isPaused!=='function')throw Error('Unsupported or already bound bus');
 const original=bus.setPaused;let pending=Promise.resolve(),failure=null;
 function pause(){
  const current=route.pause(); // Immediately invalidates turns before returning a drain promise.
  pending=Promise.all([pending,Promise.resolve(current)]).catch(error=>{failure=error;});
 }
 bus.setPaused=function(value){
  if(value)pause();else route.resume();
  return original.call(this,value);
 };
 bus[BOUND]=true;
 if(bus.isPaused())pause();else route.resume();
 return {async drain(){await pending;if(failure)throw failure;}};
}
