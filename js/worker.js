/* Monte Carlo worker: prepares the match, calibrates, runs N simulations in chunks and reports progress. */
importScripts("engine.js");
self.onmessage=function(ev){
  const {match,n,seed,id}=ev.data;
  try{
    const t0=Date.now();
    const prep=Engine.prepare(match);
    Engine.calibrate(prep,2500,(seed||1)+7);
    const agg=Engine.newAgg(); const rng=Engine.mulberry32(seed||1);
    const CH=1000;
    for(let done=0;done<n;done+=CH){
      Engine.runChunk(prep,agg,Math.min(CH,n-done),rng);
      self.postMessage({id,type:"progress",done:Math.min(done+CH,n),n});
    }
    const sum=Engine.summarize(agg,prep);
    const info={base:prep.base,afterLineup:prep.afterLineup,tac:prep.tac,form:prep.form,useHome:prep.useHome,calib:prep.calib,calibS:prep.calibS,
      H:{lam:prep.H.lam,shots:prep.H.shots,corners:prep.H.corners,yc:prep.H.yc,str:prep.H.str},A:{lam:prep.A.lam,shots:prep.A.shots,corners:prep.A.corners,yc:prep.A.yc,str:prep.A.str}};
    self.postMessage({id,type:"done",sum,info,ms:Date.now()-t0});
  }catch(e){ self.postMessage({id,type:"error",error:String(e&&e.stack||e)}); }
};
