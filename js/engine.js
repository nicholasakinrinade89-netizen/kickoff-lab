/* Kickoff Lab - simulation engine (pure JS, no DOM).
 * Runs in the browser main thread, in a Web Worker (importScripts) and in Node (require).
 * Sections: RNG, formations, league model (ported from ai-predictor), line-up strength,
 * tactics, match preparation, minute-by-minute simulation, Monte Carlo aggregation. */
(function (root) {
"use strict";

// ---------------------------------------------------------------- RNG
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function pickW(items, weights, r){ let s=0; for(let i=0;i<weights.length;i++) s+=weights[i]; let x=r*s; for(let i=0;i<weights.length;i++){ x-=weights[i]; if(x<=0) return items[i]; } return items[items.length-1]; }
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// ---------------------------------------------------------------- formations
// Slots are listed back-to-front, left-to-right (team attacking "up").
// x: 0 (left touchline) .. 100 (right), y: 0 (opponent goal) .. 100 (own goal).
// opta: ESPN/Opta "formationPlace" for each slot (best effort; validated against player positions at load time).
const ROLE_GROUP={GK:"G",LB:"D",RB:"D",CB:"D",LWB:"D",RWB:"D",DM:"M",CM:"M",AM:"M",LM:"M",RM:"M",LW:"F",RW:"F",ST:"F"};
const F = (lines, opta)=>({lines, opta});
const FORMATIONS={
  "4-3-3":    F([["GK"],["LB","CB","CB","RB"],["CM","DM","CM"],["LW","ST","RW"]],[1,3,6,5,2,10,4,8,11,9,7]),
  "4-2-3-1":  F([["GK"],["LB","CB","CB","RB"],["DM","DM"],["LW","AM","RW"],["ST"]],[1,3,6,5,2,8,4,11,10,7,9]),
  "4-4-2":    F([["GK"],["LB","CB","CB","RB"],["LM","CM","CM","RM"],["ST","ST"]],[1,3,6,5,2,11,8,4,7,10,9]),
  "4-1-4-1":  F([["GK"],["LB","CB","CB","RB"],["DM"],["LM","CM","CM","RM"],["ST"]],[1,3,6,5,2,4,11,10,8,7,9]),
  "4-4-1-1":  F([["GK"],["LB","CB","CB","RB"],["LM","CM","CM","RM"],["AM"],["ST"]],[1,3,6,5,2,11,8,4,7,10,9]),
  "4-5-1":    F([["GK"],["LB","CB","CB","RB"],["LM","CM","CM","CM","RM"],["ST"]],[1,3,6,5,2,11,10,4,8,7,9]),
  "4-1-2-1-2":F([["GK"],["LB","CB","CB","RB"],["DM"],["CM","CM"],["AM"],["ST","ST"]],[1,3,6,5,2,4,11,7,8,10,9]),
  "4-3-1-2":  F([["GK"],["LB","CB","CB","RB"],["CM","DM","CM"],["AM"],["ST","ST"]],[1,3,6,5,2,8,4,7,10,11,9]),
  "3-4-2-1":  F([["GK"],["CB","CB","CB"],["LWB","CM","CM","RWB"],["AM","AM"],["ST"]],[1,6,5,4,3,8,7,2,10,11,9]),
  "3-4-3":    F([["GK"],["CB","CB","CB"],["LWB","CM","CM","RWB"],["LW","ST","RW"]],[1,6,5,4,3,8,7,2,10,9,11]),
  "3-5-2":    F([["GK"],["CB","CB","CB"],["LWB","CM","DM","CM","RWB"],["ST","ST"]],[1,6,5,4,3,8,11,7,2,10,9]),
  "3-4-1-2":  F([["GK"],["CB","CB","CB"],["LWB","CM","CM","RWB"],["AM"],["ST","ST"]],[1,6,5,4,3,8,7,2,11,10,9]),
  "5-3-2":    F([["GK"],["LWB","CB","CB","CB","RWB"],["CM","DM","CM"],["ST","ST"]],[1,3,6,5,4,2,8,11,7,10,9]),
  "5-4-1":    F([["GK"],["LWB","CB","CB","CB","RWB"],["LM","CM","CM","RM"],["ST"]],[1,3,6,5,4,2,11,8,7,10,9]),
};
// Generic generator for any "a-b-c(-d)" string ESPN may send that is not in the table.
function genericLines(str){
  const n=String(str||"").split("-").map(Number).filter(x=>x>0);
  if(n.reduce((a,b)=>a+b,0)!==10) return null;
  const lines=[["GK"]];
  n.forEach((k,i)=>{
    const last=i===n.length-1, first=i===0;
    let r;
    if(first) r= k===3?["CB","CB","CB"]: k===4?["LB","CB","CB","RB"]: k===5?["LWB","CB","CB","CB","RWB"]: Array(k).fill("CB");
    else if(last) r= k===1?["ST"]: k===2?["ST","ST"]: k===3?["LW","ST","RW"]: Array(k).fill("ST");
    else { const nearFront=i===n.length-2 && n.length>3;
      r= k===1?[i===1?"DM":"AM"]: k===2?(nearFront?["AM","AM"]:(n.length>3?["DM","DM"]:["CM","CM"])): k===3?(nearFront?["LW","AM","RW"]:["CM","CM","CM"])
        : k===4?["LM","CM","CM","RM"]: k===5?["LM","CM","CM","CM","RM"]: Array(k).fill("CM"); }
    lines.push(r);
  });
  return lines;
}
function formationSlots(name){
  const def=FORMATIONS[name]; const lines=def?def.lines:genericLines(name)||FORMATIONS["4-3-3"].lines;
  const slots=[]; const L=lines.length;
  lines.forEach((line,li)=>{
    const y = li===0 ? 92 : 78 - (li-1)*(66/(L-2||1));
    line.forEach((role,i)=>{
      let x = (i+1)*100/(line.length+1);
      if(line.length===4 && li===1) x=[12,37,63,88][i];
      if(line.length===5) x=[9,29.5,50,70.5,91][i];
      let yy=y; if(role==="DM" && line.length===3) yy=y+6; // holding mid sits deeper in a 3
      if((role==="LW"||role==="RW") && line.length===3 && li===L-1) yy=y+4;
      if((role==="LWB"||role==="RWB")) yy=y-4;
      slots.push({role, group:ROLE_GROUP[role], x:Math.round(x*10)/10, y:Math.round(yy*10)/10, opta:def?def.opta[slots.length]:null});
    });
  });
  return slots;
}
const FORMATION_NAMES=Object.keys(FORMATIONS);

// ---------------------------------------------------------------- league model (ported from /workspace/ai-predictor)
const PRIOR_N=4, FORM_W=0.06, FORM_CAP=0.08;
// played: [{home:{id,name,short}, away:{...}, hs, as, date(ms)}] completed games of the current season, any order
function buildLeagueModel(played, extra){
  played=[...played].sort((a,b)=>a.date-b.date);
  const P=20, n=played.length;
  const sumH=played.reduce((s,e)=>s+e.hs,0), sumA=played.reduce((s,e)=>s+e.as,0);
  const muH=(sumH+P*1.55)/(n+P), muA=(sumA+P*1.25)/(n+P), mu=(muH+muA)/2;
  const T={};
  const get=t=>T[t.id]||(T[t.id]={id:t.id,name:t.name,short:t.short,hGF:0,hGA:0,hN:0,aGF:0,aGA:0,aN:0,res:[]});
  for(const e of played){
    const H=get(e.home), A=get(e.away);
    H.hGF+=e.hs; H.hGA+=e.as; H.hN++; A.aGF+=e.as; A.aGA+=e.hs; A.aN++;
    H.res.push({r:e.hs>e.as?"W":e.hs<e.as?"L":"D",gf:e.hs,ga:e.as,home:true,opp:e.away.short,date:e.date});
    A.res.push({r:e.as>e.hs?"W":e.as<e.hs?"L":"D",gf:e.as,ga:e.hs,home:false,opp:e.home.short,date:e.date});
  }
  let ppgSum=0, ppgN=0;
  for(const t of Object.values(T)){
    const N=t.hN+t.aN; t.N=N;
    const oAtt=(t.hGF+t.aGF+PRIOR_N*mu)/(N+PRIOR_N)/mu, oDef=(t.hGA+t.aGA+PRIOR_N*mu)/(N+PRIOR_N)/mu;
    const hAtt=(t.hGF+PRIOR_N*muH)/(t.hN+PRIOR_N)/muH, hDef=(t.hGA+PRIOR_N*muA)/(t.hN+PRIOR_N)/muA;
    const aAtt=(t.aGF+PRIOR_N*muA)/(t.aN+PRIOR_N)/muA, aDef=(t.aGA+PRIOR_N*muH)/(t.aN+PRIOR_N)/muH;
    t.attH=(hAtt+oAtt)/2; t.defH=(hDef+oDef)/2; t.attA=(aAtt+oAtt)/2; t.defA=(aDef+oDef)/2; t.att=oAtt; t.def=oDef;
    const last5=t.res.slice(-5);
    t.form=last5.map(x=>x.r).join("");
    t.ppg5=last5.length?last5.reduce((s,x)=>s+(x.r==="W"?3:x.r==="D"?1:0),0)/last5.length:null;
    const pts=t.res.reduce((s,x)=>s+(x.r==="W"?3:x.r==="D"?1:0),0); t.pts=pts;
    if(N){ppgSum+=pts; ppgN+=N;}
  }
  return {T,muH,muA,mu,leaguePPG:ppgN?ppgSum/ppgN:1.37,played:n, ...(extra||{})};
}
function formAdj(model,t){ return (t&&t.ppg5!=null)?clamp(FORM_W*(t.ppg5-model.leaguePPG),-FORM_CAP,FORM_CAP):0; }
// side: "h" | "a" | "n" (neutral -> overall ratings)
function teamRating(model,id,side,domestic){
  const t=model&&model.T[id];
  let r=t?{att:side==="h"?t.attH:side==="a"?t.attA:t.att, def:side==="h"?t.defH:side==="a"?t.defA:t.def, N:t.N, form:formAdj(model,t)}:{att:1,def:1,N:0,form:0};
  if(domestic && domestic.T[id] && domestic.T[id].N>=3){ // e.g. Champions League: blend domestic ratings
    const dt=domestic.T[id], w=r.N/(r.N+6);
    r={att:w*r.att+(1-w)*dt.att, def:w*r.def+(1-w)*dt.def, N:r.N, form:r.N>=3?r.form:formAdj(domestic,dt), domN:dt.N};
  }
  return r;
}

// ---------------------------------------------------------------- players & line-up strength
// player: {id,name,short,jersey,pos:"G"|"D"|"M"|"F", stats:{apps,subIns,goals,assists,shots,sot,yc,rc,fouls,saves}|null}
const SHOT_PRIOR={GK:0,CB:0.5,LB:0.45,RB:0.45,LWB:0.7,RWB:0.7,DM:0.6,CM:1.0,AM:1.9,LM:1.3,RM:1.3,LW:2.0,RW:2.0,ST:2.7};
const GROUP_PRIOR_ROLE={G:"GK",D:"CB",M:"CM",F:"ST"};
const ATT_W={G:0,D:0.2,M:0.55,F:1.0}, DEF_W={G:1.3,D:0.9,M:0.5,F:0.15};
const ROLE_ATT={GK:0,CB:0.12,LB:0.25,RB:0.25,LWB:0.35,RWB:0.35,DM:0.25,CM:0.45,AM:0.8,LM:0.6,RM:0.6,LW:0.85,RW:0.85,ST:1.0};
const ROLE_DEF={GK:1.3,CB:1.0,LB:0.75,RB:0.75,LWB:0.6,RWB:0.6,DM:0.8,CM:0.5,AM:0.25,LM:0.35,RM:0.35,LW:0.2,RW:0.2,ST:0.12};
function starts(p){ const s=p.stats; return s? Math.max(0,(s.apps||0)-(s.subIns||0)) : 0; }
function playerValues(p, teamGP, statsKnown){
  const s=p.stats;
  if(!statsKnown) return {att:1, def:1, trust:0.5};
  const gp=Math.max(teamGP||1,1);
  const trust=s? clamp((starts(p)+0.35*(s.subIns||0))/gp,0,1) : 0.1;
  const apps=s?(s.apps||0):0;
  const out=s? ((s.goals||0)+0.6*(s.assists||0)+0.05*(s.shots||0))/(apps+2) : 0;
  return {att:0.7+0.3*trust+0.8*Math.min(out,1.2), def:0.7+0.3*trust, trust};
}
// out-of-position multipliers [att, def]
function posPenalty(natural, slotGroup, alt, role){
  if(!natural||natural===slotGroup||alt===slotGroup) return [1,1];
  if((role==="LWB"||role==="RWB") && (natural==="M"||natural==="F")) return [0.97,0.85]; // wingers/mids at wing-back: mild
  if(slotGroup==="G") return [0,0.25];       // outfielder in goal
  if(natural==="G") return [0.05,0.3];       // keeper outfield
  const order={D:0,M:1,F:2}; const d=Math.abs(order[natural]-order[slotGroup]);
  return d===1?[0.88,0.88]:[0.6,0.6];
}
function teamGPFrom(players){ // best guess of team games played from player stats (max appearances)
  let m=0; for(const p of players) if(p.stats) m=Math.max(m,p.stats.apps||0); return m;
}
function usualXI(players){
  const ps=players.filter(p=>p.stats);
  const by=(a,b)=>starts(b)-starts(a)||((b.stats.apps||0)-(a.stats.apps||0));
  const gk=ps.filter(p=>p.pos==="G").sort(by)[0];
  const out=ps.filter(p=>p.pos!=="G").sort(by).slice(0,10);
  return gk?[gk,...out]:out;
}
function usualForSlots(squad, slots){
  const ps=squad.filter(p=>p.stats&&!p.inj);
  const by=(a,b)=>starts(b)-starts(a)||((b.stats.apps||0)-(a.stats.apps||0));
  const used=new Set(), out=[];
  const order=["G","D","M","F"]; const near={G:["G"],D:["D","M"],M:["M","D","F"],F:["F","M"]};
  for(const g of order){ const need=slots.filter(s=>s.group===g);
    for(const sl of need){ let c=null; for(const gg of near[g]){ c=ps.filter(p=>!used.has(p.id)&&(p.pos===gg||p.pos2===gg)).sort(by)[0]; if(c) break; }
      if(c){ used.add(c.id); out.push({p:c,slot:sl}); } } }
  return out;
}
// xi: [{player, slot}] ; squad: all known players of the team (roster + bench)
function lineupStrength(xi, squad, teamGP){
  const statsKnown=squad.some(p=>p.stats&&(p.stats.apps||0)>0);
  const gp=teamGP||teamGPFrom(squad);
  let ca=0,cd=0; const det=[];
  for(const {player,slot} of xi){
    const v=playerValues(player,gp,statsKnown), pen=posPenalty(player.pos,slot.group,player.pos2,slot.role);
    ca+=ROLE_ATT[slot.role]*v.att*pen[0]; cd+=ROLE_DEF[slot.role]*v.def*pen[1];
    det.push({id:player.id,att:v.att,def:v.def,trust:v.trust,pen});
  }
  // reference: usual XI (most starts) in natural positions; shape-neutral group weights
  let ua=0,ud=0,ca2=0,cd2=0;
  // usual XI fitted to the same slot groups (so only personnel differs, not shape)
  const usualFit=statsKnown?usualForSlots(squad,xi.map(x=>x.slot)):[];
  const usual=usualFit.map(u=>u.p);
  if(usualFit.length===11){
    for(const u of usualFit){ const v=playerValues(u.p,gp,true), pen=posPenalty(u.p.pos,u.slot.group,u.p.pos2,u.slot.role); ua+=ATT_W[u.slot.group]*v.att*pen[0]; ud+=DEF_W[u.slot.group]*v.def*pen[1]; }
    for(const {player,slot} of xi){ const v=playerValues(player,gp,true), pen=posPenalty(player.pos,slot.group,player.pos2,slot.role); ca2+=ATT_W[slot.group]*v.att*pen[0]; cd2+=DEF_W[slot.group]*v.def*pen[1]; }
  }
  // personnel factor (who plays) vs usual XI
  let pAtt=1,pDef=1;
  if(ua>0){ pAtt=Math.pow(clamp(ca2/ua,0.5,1.2),0.6); pDef=Math.pow(clamp(ud/cd2,0.8,1.7),0.6); }
  else { // no stats: positions only (penalise out-of-position players)
    let a=0,d=0,a0=0,d0=0; for(const {player,slot} of xi){ const pen=posPenalty(player.pos,slot.group,player.pos2,slot.role); a+=ATT_W[slot.group]*pen[0]; d+=DEF_W[slot.group]*pen[1]; a0+=ATT_W[slot.group]; d0+=DEF_W[slot.group]; }
    pAtt=Math.pow(a/a0,0.7); pDef=Math.pow(d0/Math.max(d,0.01),0.7);
  }
  // formation shape factor vs a 4-2-3-1 reference
  const ref=formationSlots("4-2-3-1"); const ra=ref.reduce((s,x)=>s+ROLE_ATT[x.role],0), rd=ref.reduce((s,x)=>s+ROLE_DEF[x.role],0);
  const sa=xi.reduce((s,x)=>s+ROLE_ATT[x.slot.role],0), sd=xi.reduce((s,x)=>s+ROLE_DEF[x.slot.role],0);
  const shapeAtt=Math.pow(sa/ra,0.35), shapeDef=Math.pow(rd/sd,0.35);
  return {attMult:pAtt*shapeAtt, concedeMult:pDef*shapeDef, pAtt, pDef, shapeAtt, shapeDef, statsKnown, usual:usual.map(p=>p.id), det, gp};
}

// ---------------------------------------------------------------- tactics (documented in the UI "How it works")
const TACTICS={
  mentality:{defensive:{own:0.85,opp:0.88,cards:0.95}, balanced:{own:1,opp:1,cards:1}, attacking:{own:1.12,opp:1.10,cards:1.05}},
  pressing:{low:{own:0.96,opp:0.97,cards:0.85,early:1.0,late:1.0}, medium:{own:1,opp:1,cards:1,early:1,late:1}, high:{own:1.05,opp:0.95,cards:1.25,early:1.06,late:0.9}},
  // tempo: changes shot volume and shot quality (fast = more, worse shots; both teams' games more open)
  tempo:{slow:{shots:0.88,conv:1.06,open:0.95}, normal:{shots:1,conv:1,open:1}, fast:{shots:1.14,conv:0.94,open:1.05}},
  // width: corners and crossing (wide = more corners and shots from crosses, slightly lower conversion)
  width:{narrow:{shots:0.95,conv:1.04,corners:0.8,oppCorners:1.0}, normal:{shots:1,conv:1,corners:1,oppCorners:1}, wide:{shots:1.06,conv:0.95,corners:1.25,oppCorners:1.0}},
};
const DEFAULT_TACTICS={mentality:"balanced",pressing:"medium",tempo:"normal",width:"normal"};

// ---------------------------------------------------------------- preparation
// match = {home:TeamIn, away:TeamIn, model:{muH,muA,mu}, homeAdv:bool, neutral:bool, startMinute, startScore:[h,a], liveReds:[h,a]}
// TeamIn = {id,name,short,abbr, rating:{att,def,form}, leagueCoef, xi:[{player,slot}], bench:[player], squad:[player], captainId, tactics, teamStats:{gp,shotsPG,sotPG,ycPG,gfPG}}
function prepare(match){
  const H=match.home, A=match.away;
  const useHome=match.homeAdv!==false && !match.neutral;
  const baseH=useHome?match.model.muH:match.model.mu, baseA=useHome?match.model.muA:match.model.mu;
  const cH=H.leagueCoef||1, cA=A.leagueCoef||1; // cross-league adjustment (1 when same league)
  const rH=H.rating, rA=A.rating;
  let lh=baseH*rH.att*rA.def*(cH/cA), la=baseA*rA.att*rH.def*(cA/cH);
  const formH=1+(rH.form||0), formA=1+(rA.form||0);
  lh*=formH; la*=formA;
  const base={lh,la};
  const sH=lineupStrength(H.xi,H.squad,H.teamStats&&H.teamStats.gp), sA=lineupStrength(A.xi,A.squad,A.teamStats&&A.teamStats.gp);
  lh*=sH.attMult*sA.concedeMult; la*=sA.attMult*sH.concedeMult;
  const afterLineup={lh,la};
  const tH=Object.assign({},DEFAULT_TACTICS,H.tactics), tA=Object.assign({},DEFAULT_TACTICS,A.tactics);
  const M=TACTICS.mentality, Pr=TACTICS.pressing, Te=TACTICS.tempo, W=TACTICS.width;
  const tacH=M[tH.mentality].own*M[tA.mentality].opp*Pr[tH.pressing].own*Pr[tA.pressing].opp*Te[tH.tempo].open*Te[tA.tempo].open*
             Te[tH.tempo].shots*Te[tH.tempo].conv*W[tH.width].shots*W[tH.width].conv;
  const tacA=M[tA.mentality].own*M[tH.mentality].opp*Pr[tA.pressing].own*Pr[tH.pressing].opp*Te[tA.tempo].open*Te[tH.tempo].open*
             Te[tA.tempo].shots*Te[tA.tempo].conv*W[tA.width].shots*W[tA.width].conv;
  lh*=tacH; la*=tacA;
  lh=clamp(lh,0.12,5); la=clamp(la,0.12,5);
  const side=(T,t,lam,str)=>{
    const ts=T.teamStats||{};
    const gfPG=ts.gfPG||1.35;
    let shots=(ts.shotsPG&&ts.gp>=3)?ts.shotsPG:12.5;
    shots=clamp(shots*Math.pow(clamp(lam/Math.max(gfPG,0.4),0.6,1.7),0.4),5,26)*Te[t.tempo].shots*W[t.width].shots;
    const sotRate=(ts.sotPG&&ts.shotsPG)?clamp(ts.sotPG/ts.shotsPG,0.25,0.5):0.34;
    const corners=clamp(5.0*Math.pow(shots/12.5,0.7)*W[t.width].corners,1.5,12);
    const yc=((ts.ycPG&&ts.gp>=3)?clamp(ts.ycPG,0.8,3.5):1.9)*Pr[t.pressing].cards*M[t.mentality].cards;
    return {lam, shots, sotRate, corners, yc, tac:t, str};
  };
  return {
    H:side(H,tH,lh,sH), A:side(A,tA,la,sA),
    teams:{home:H, away:A}, base, afterLineup, tac:{h:tacH,a:tacA}, form:{h:formH,a:formA}, useHome,
    startMinute:match.startMinute||0, startPeriod:match.startPeriod||0, startScore:match.startScore||[0,0], liveReds:match.liveReds||[0,0],
    calib:[1,1], calibS:[1,1],
  };
}

// ---------------------------------------------------------------- one match
function scorerWeights(p, role){ // shot weight and conversion weight from stats, shrunk to positional priors
  const prior=SHOT_PRIOR[role]!=null?SHOT_PRIOR[role]:SHOT_PRIOR[GROUP_PRIOR_ROLE[p.pos]||"CM"];
  const s=p.stats; const k=3;
  const apps=s?((s.apps||0)-(s.subIns||0)+0.4*(s.subIns||0)):0;
  let shot=s?((s.shots||0)+k*prior)/(apps+k):prior;
  if(p.pos==="G"||role==="GK") shot=0;
  const conv=s?((s.goals||0)+8*0.11)/((s.shots||0)+8):0.11;
  return {shot, conv, gw:shot*conv, assist:s?((s.assists||0)+2*(role in {AM:1,LW:1,RW:1,LM:1,RM:1}?0.25:0.12))/(apps+2):0.12,
          foul:s?((s.fouls||0)+3*1.1)/(apps+3):1.1, yc:s?((s.yc||0)+3*0.15)/(apps+3):0.15};
}
function buildSideState(T, sideParams){
  const on=T.xi.map(({player,slot})=>({p:player, role:slot.role, slot, w:scorerWeights(player,slot.role), mins:0, start:true}));
  const bench=T.bench.filter(p=>p).map(p=>({p, role:GROUP_PRIOR_ROLE[p.pos]||"CM", w:null}));
  return {on, bench, subs:T.subsUsed||0, windows:T.subsUsed?1:0, reds:0, yellow:{}, sent:{}, injuredPending:null, sp:sideParams};
}
// time profile: goals get more likely as the match goes on (approx. real-world distribution)
const prof=m=>0.8+0.4*Math.min(m,95)/90;

function simulateOne(prep, rng, record){
  const sides=[buildSideState(prep.teams.home,prep.H), buildSideState(prep.teams.away,prep.A)];
  const score=[prep.startScore[0],prep.startScore[1]];
  const st=[{shots:0,sot:0,corners:0,yc:0,rc:0,fouls:0,saves:0,xg:0},{shots:0,sot:0,corners:0,yc:0,rc:0,fouls:0,saves:0,xg:0}];
  const goals=[]; const ev=record?[]:null; const ratings=record?{}:null;
  const stat=record?{}:null; const ticks=record?[]:null; // per-player counters for ratings
  const ps=id=>stat[id]||(stat[id]={g:0,a:0,sot:0,sh:0,yc:0,rc:0,sv:0,mins:0,inj:0});
  sides[0].reds=prep.liveReds[0]; sides[1].reds=prep.liveReds[1];
  const st1=1+Math.floor(rng()*4), st2=3+Math.floor(rng()*5);
  const startM=prep.startMinute, startP=prep.startPeriod||(prep.startMinute>45?2:1);
  const plan=[0,1].map(i=>{ // planned substitution minutes (3 windows, up to 5 subs)
    const w1=56+Math.floor(rng()*16), w2=w1+6+Math.floor(rng()*10), w3=Math.min(w2+5+Math.floor(rng()*8),88);
    return [{m:w1,n:rng()<0.6?2:1},{m:w2,n:rng()<0.5?2:1},{m:w3,n:1}];
  });
  const shotsBase=[prep.H.shots/90*prep.calibS[0], prep.A.shots/90*prep.calibS[1]];
  const convBase=[prep.H.lam/prep.H.shots*prep.calib[0], prep.A.lam/prep.A.shots*prep.calib[1]];
  const cornerR=[prep.H.corners/90, prep.A.corners/90], ycR=[prep.H.yc/90, prep.A.yc/90];
  const strMult=[1,1]; // updated as subs change personnel
  let curHalf=1, curTm=0; const push=(m,type,t,text,extra)=>{ if(ev) ev.push(Object.assign({m,h:curHalf,tm:curTm,type,t,text,score:[score[0],score[1]]},extra||{})); };
  const nameOf=x=>x.p.short||x.p.name;
  const timeline=[]; for(let m=1;m<=45+st1;m++) timeline.push([1,m]); for(let m=46;m<=90+st2;m++) timeline.push([2,m]);
  if(record){ curTm=startP===2?startM+st1:startM; curHalf=startP; } if(record) push(startM||0,"ko",-1,startM?`Simulation picks up at ${startM}' with the score ${score[0]}-${score[1]}.`:"Kick-off!");
  for(const [half,m] of timeline){
    if(half<startP || (half===startP && m<=startM)) continue;
    curHalf=half; curTm=half===1?m:m+st1;
    if(half===2 && m===46 && record){ curHalf=1; curTm=45+st1+0.5; push(45,"ht",-1,`Half-time: ${prep.teams.home.short} ${score[0]}-${score[1]} ${prep.teams.away.short}`); curHalf=2; curTm=m+st1; }
    for(let t=0;t<2;t++){
      const S=sides[t], O=sides[1-t], tac=S.sp.tac, otac=O.sp.tac;
      // substitutions
      if(half===2){
        for(const w of plan[t]){
          if(w.m===m && S.subs<5 && S.windows<3){
            let n=w.n; const diff=score[t]-score[1-t]; if(diff<0 && m<80) n++;
            let did=0;
            for(let k=0;k<n && S.subs<5;k++){ if(doSub(t,m,false)) did++; }
            if(did) S.windows++;
          }
        }
      }
      if(S.injuredPending && S.subs<5){ doSub(t,m,true,S.injuredPending); S.injuredPending=null; }
      // attacking intensity this minute
      const diff=score[t]-score[1-t];
      let gs=1; if(diff<0 && m>60) gs=1.2+(m>80?0.1:0); else if(diff>0 && m>70) gs=0.88; else if(diff===0 && m>80) gs=1.05;
      const men=1+0.18*(O.reds-S.reds); // man advantage
      const press=TACTICS.pressing[tac.pressing], opress=TACTICS.pressing[otac.pressing];
      const pt=(m<=65?press.early:press.late)*(m>70?(opress.late<1?1.06:1):1);
      const rate=shotsBase[t]*prof(m)*gs*Math.max(men,0.5)*pt*strMult[t];
      if(rng()<rate){
        st[t].shots++;
        const shooter=pickW(S.on, S.on.map(x=>x.w.shot+0.0001), rng());
        const isGoalP=convBase[t]/(gs>1?1.03:1);
        const q=isGoalP*(shooter.w.conv/0.11)**0.5;
        st[t].xg+=q;
        const onT=rng()<S.sp.sotRate;
        if(record){ ps(shooter.p.id).sh++; }
        if(onT){
          st[t].sot++; if(record) ps(shooter.p.id).sot++;
          if(rng()<Math.min(0.9,q/S.sp.sotRate)){
            score[t]++;
            let scorer=pickW(S.on, S.on.map(x=>x.w.gw+0.00001), rng()), og=false, pen=false;
            const r=rng(); if(r<0.025){ og=true; scorer=pickW(O.on,O.on.map(x=>x.role==="GK"?0.2:(x.slot.group==="D"?3:1)),rng()); }
            else if(r<0.115){ pen=true; scorer=S.on.reduce((a,b)=>b.w.gw>a.w.gw?b:a,S.on[0]); }
            let assister=null;
            if(!og && !pen && rng()<0.75){ const cand=S.on.filter(x=>x!==scorer); assister=pickW(cand,cand.map(x=>x.role==="GK"?0.003:x.w.assist+0.01),rng()); }
            goals.push({t, id:scorer.p.id, og, pen, m});
            if(record){ if(!og) ps(scorer.p.id).g++; if(assister) ps(assister.p.id).a++; }
            push(m,"goal",t, og?`OWN GOAL! ${nameOf(scorer)} turns it into his own net.`: pen?`GOAL! ${nameOf(scorer)} converts the penalty.`:
              `GOAL! ${nameOf(scorer)} scores${assister?`, assisted by ${nameOf(assister)}`:""}.`,{pid:scorer.p.id,og,pen,assist:assister&&assister.p.id});
          } else {
            st[1-t].saves++;
            if(record){ const gk=O.on.find(x=>x.role==="GK"); if(gk) ps(gk.p.id).sv++; push(m,"save",t,`${nameOf(shooter)} forces a save${gk?` from ${nameOf(gk)}`:""}.`,{pid:shooter.p.id,gk:gk&&gk.p.id}); }
          }
        } else if(record && rng()<0.45) push(m,"miss",t,`${nameOf(shooter)} ${["shoots wide","fires over the bar","has an effort blocked","drags it past the post"][Math.floor(rng()*4)]}.`,{pid:shooter.p.id});
      }
      if(rng()<cornerR[t]*prof(m)*gs){ st[t].corners++; if(record&&rng()<0.35) push(m,"corner",t,`Corner to ${t?prep.teams.away.short:prep.teams.home.short}.`); }
      // discipline
      const late=(m>75?1.25:1)*(diff<0?1.1:1);
      if(rng()<ycR[t]*late){
        const cand=S.on.filter(x=>!S.sent[x.p.id]);
        const off=pickW(cand,cand.map(x=>x.w.yc*(x.role==="GK"?0.3:1)+0.01),rng());
        let who=off; if(S.yellow[off.p.id] && rng()<0.75){ const c2=cand.filter(x=>!S.yellow[x.p.id]); if(c2.length) who=c2[Math.floor(rng()*c2.length)]; }
        if(S.yellow[who.p.id]){ sendOff(t,who,m,true); }
        else { S.yellow[who.p.id]=1; st[t].yc++; if(record){ ps(who.p.id).yc++; push(m,"yc",t,`Yellow card for ${nameOf(who)}.`,{pid:who.p.id}); } }
      }
      if(rng()<0.035/95){ const cand=S.on.filter(x=>x.role!=="GK"); sendOff(t,pickW(cand,cand.map(x=>x.w.foul),rng()),m,false); }
      if(rng()<0.22/95 && !S.injuredPending && S.subs<5){
        const cand=S.on; const inj=cand[Math.floor(rng()*cand.length)]; S.injuredPending=inj;
        if(record){ ps(inj.p.id).inj=1; push(m,"inj",t,`${nameOf(inj)} is down injured and can't continue.`,{pid:inj.p.id}); }
      }
    }
    if(record){ for(let t=0;t<2;t++) for(const x of sides[t].on) ps(x.p.id).mins++; ticks.push({m,half,tm:curTm,st:[Object.assign({},st[0]),Object.assign({},st[1])],score:[score[0],score[1]]}); }
  }
  function sendOff(t,x,m,second){
    const S=sides[t]; S.sent[x.p.id]=1; S.reds++; st[t].rc++; if(second) st[t].yc++;
    S.on=S.on.filter(y=>y!==x);
    if(record){ const s=ps(x.p.id); s.rc++; if(second) s.yc++; push(m,"rc",t,second?`Second yellow! ${nameOf(x)} is sent off.`:`RED CARD! ${nameOf(x)} is sent off.`,{pid:x.p.id}); }
    if(x.role==="GK"){ // emergency keeper: sub one on if possible, else an outfielder goes in goal
      const bk=S.bench.find(b=>b.p.pos==="G");
      if(bk && S.subs<5){ const out=S.on.filter(y=>y.role!=="GK").sort((a,b)=>ROLE_ATT[b.role]-ROLE_ATT[a.role])[0]; if(out) replace(t,out,bk,"GK",m,"tactical change after the red card"); }
      else if(S.on.length){ const y=S.on.find(z=>z.slot.group==="D")||S.on[0]; y.role="GK"; y.w=scorerWeights(y.p,"GK"); strMult[t]*=0.85; }
    }
  }
  function replace(t,out,inn,role,m,why){
    const S=sides[t];
    const vOut=playerValues(out.p,prep[t?"A":"H"].str.gp,prep[t?"A":"H"].str.statsKnown), vIn=playerValues(inn.p,prep[t?"A":"H"].str.gp,prep[t?"A":"H"].str.statsKnown);
    const wa=ROLE_ATT[role]/10; strMult[t]*=1+wa*((vIn.att*posPenalty(inn.p.pos,ROLE_GROUP[role],inn.p.pos2,role)[0])/Math.max(vOut.att,0.1)-1)*0.6;
    strMult[t]*=1.01; // fresh legs
    const slot=Object.assign({},out.slot,{role,group:ROLE_GROUP[role]});
    S.on=S.on.map(y=>y===out?{p:inn.p,role,slot,w:scorerWeights(inn.p,role),start:false}:y);
    S.bench=S.bench.filter(b=>b!==inn); S.subs++;
    if(record) push(m,"sub",t,`Substitution: ${inn.p.short||inn.p.name} replaces ${nameOf(out)}${why?` (${why})`:""}.`,{pin:inn.p.id,pout:out.p.id});
  }
  function doSub(t,m,forced,who){
    const S=sides[t]; if(!S.bench.length) return false;
    let out=who;
    if(out && !S.on.includes(out)) return false;
    if(!out){ // tired/attacking players more likely to come off; never the keeper
      const cand=S.on.filter(x=>x.role!=="GK" && x.start!==false);
      if(!cand.length) return false;
      out=pickW(cand,cand.map(x=>({F:3,M:2.2,D:1}[x.slot.group]||1)*(S.yellow[x.p.id]?1.6:1)),rng());
    }
    const g=out.slot.group;
    let pool=S.bench.filter(b=>b.p.pos===g); if(!pool.length) pool=S.bench.filter(b=>b.p.pos!=="G"||g==="G"); if(!pool.length) return false;
    const inn=pickW(pool,pool.map(b=>1+(b.p.stats?(b.p.stats.apps||0):0)),rng());
    replace(t,out,inn,out.role,m,forced?"injury":"");
    return true;
  }
  if(record){ curTm=90+st2+st1+0.5; curHalf=2; } if(record) push(90+st2,"ft",-1,`Full-time: ${prep.teams.home.short} ${score[0]}-${score[1]} ${prep.teams.away.short}`);
  const res={score, st, goals};
  if(record){ res.events=ev; res.ticks=ticks; res.stoppage=[st1,st2]; res.ratings=computeRatings(prep,stat,score,sides); res.finalOn=sides.map(s=>s.on.map(x=>x.p.id)); }
  return res;
}
function computeRatings(prep,stat,score,sides){
  const out={};
  ["home","away"].forEach((k,t)=>{
    const T=prep.teams[k]; const all=[...T.xi.map(x=>({p:x.player,g:x.slot.group})),...T.bench.map(p=>({p,g:p.pos}))];
    for(const {p,g} of all){
      const s=stat[p.id]; if(!s||!s.mins) continue;
      const conc=score[1-t], res=score[t]>score[1-t]?0.3:score[t]<score[1-t]?-0.3:0;
      let r=6.3+res+s.g*1.1+s.a*0.7+s.sot*0.15+s.sh*0.05-s.yc*0.3-s.rc*1.6;
      if(g==="G") r+=s.sv*0.3+(conc===0?0.7:-0.25*conc);
      else if(g==="D") r+=(conc===0?0.5:-0.15*conc);
      if(s.mins<30) r=6+(r-6)*0.6;
      out[p.id]=Math.round(clamp(r,3,10)*10)/10;
    }
  });
  return out;
}

// ---------------------------------------------------------------- Monte Carlo
function calibrate(prep, n, seed){
  // Pilot run from kick-off: scale shot volume and per-shot conversion so the dynamic effects
  // (game state, red cards, subs, fatigue) average out to the model's expected shots and goals.
  const rng=mulberry32(seed||12345); const sm=[0,0], sh=[0,0];
  const p2=Object.assign({},prep,{startMinute:0,startPeriod:1,startScore:[0,0],liveReds:[0,0],calib:[1,1],calibS:[1,1]});
  for(let i=0;i<n;i++){ const r=simulateOne(p2,rng,false); sm[0]+=r.score[0]; sm[1]+=r.score[1]; sh[0]+=r.st[0].shots; sh[1]+=r.st[1].shots; }
  const cs=[prep.H.shots/Math.max(sh[0]/n,0.5), prep.A.shots/Math.max(sh[1]/n,0.5)].map(x=>clamp(x,0.5,1.6));
  const c=[prep.H.lam/Math.max(sm[0]/n,0.05)/cs[0], prep.A.lam/Math.max(sm[1]/n,0.05)/cs[1]].map(x=>clamp(x,0.3,2.5));
  prep.calib=c; prep.calibS=cs; return c;
}
function newAgg(){ return {n:0, grid:Array.from({length:11},()=>new Array(11).fill(0)), H:0,D:0,A:0, gh:0,ga:0,
  st:[{shots:0,sot:0,corners:0,yc:0,rc:0},{shots:0,sot:0,corners:0,yc:0,rc:0}], scorers:{}, goalsBy:{}, first:{h:0,a:0,none:0}, totals:new Array(12).fill(0)}; }
function addResult(agg,r){
  const [h,a]=r.score; agg.n++; agg.grid[Math.min(h,10)][Math.min(a,10)]++;
  if(h>a) agg.H++; else if(h<a) agg.A++; else agg.D++;
  agg.gh+=h; agg.ga+=a; agg.totals[Math.min(h+a,11)]++;
  for(let t=0;t<2;t++){ const s=agg.st[t], x=r.st[t]; s.shots+=x.shots; s.sot+=x.sot; s.corners+=x.corners; s.yc+=x.yc; s.rc+=x.rc; }
  const seen={};
  for(const g of r.goals){ if(g.og) continue; agg.goalsBy[g.id]=(agg.goalsBy[g.id]||0)+1; if(!seen[g.id]){ seen[g.id]=1; agg.scorers[g.id]=(agg.scorers[g.id]||0)+1; } }
  const fg=r.goals.find(g=>g.m>0); if(!fg) agg.first.none++; else if(fg.t===0) agg.first.h++; else agg.first.a++;
}
function runChunk(prep, agg, n, rng){ for(let i=0;i<n;i++) addResult(agg, simulateOne(prep,rng,false)); return agg; }
function summarize(agg, prep){
  const n=agg.n, p=x=>x/n, G=agg.grid;
  let o15=0,o25=0,o35=0,btts=0,csH=0,csA=0; const scores=[];
  for(let i=0;i<=10;i++) for(let j=0;j<=10;j++){ const c=G[i][j]; if(!c) continue;
    if(i+j>1)o15+=c; if(i+j>2)o25+=c; if(i+j>3)o35+=c; if(i>0&&j>0)btts+=c; if(j===0)csH+=c; if(i===0)csA+=c; scores.push([i,j,c]); }
  scores.sort((a,b)=>b[2]-a[2]);
  const avg=t=>({shots:agg.st[t].shots/n, sot:agg.st[t].sot/n, corners:agg.st[t].corners/n, yc:agg.st[t].yc/n, rc:agg.st[t].rc/n});
  const scorers=Object.entries(agg.scorers).map(([id,c])=>({id, p:c/n, goals:(agg.goalsBy[id]||0)/n})).sort((a,b)=>b.p-a.p);
  return {n, H:p(agg.H), D:p(agg.D), A:p(agg.A), xgH:agg.gh/n, xgA:agg.ga/n, o15:p(o15), o25:p(o25), o35:p(o35), btts:p(btts), csH:p(csH), csA:p(csA),
    grid:G.slice(0,6).map(r=>r.slice(0,6).map(c=>c/n)), top:scores.slice(0,5).map(([i,j,c])=>({h:i,a:j,p:c/n})),
    avgH:avg(0), avgA:avg(1), scorers, first:{h:p(agg.first.h),a:p(agg.first.a),none:p(agg.first.none)},
    totals:agg.totals.map(c=>c/n), lam:{h:prep.H.lam,a:prep.A.lam}};
}
function runAll(prep, n, seed){ calibrate(prep,2500,(seed||1)+7); const agg=newAgg(); runChunk(prep,agg,n,mulberry32(seed||1)); return summarize(agg,prep); }

const API={mulberry32, FORMATIONS, FORMATION_NAMES, ROLE_GROUP, formationSlots, genericLines, buildLeagueModel, teamRating, formAdj,
  lineupStrength, usualXI, usualForSlots, playerValues, posPenalty, starts, teamGPFrom, TACTICS, DEFAULT_TACTICS, prepare, simulateOne, calibrate,
  newAgg, addResult, runChunk, summarize, runAll, scorerWeights, clamp};
if(typeof module!=="undefined" && module.exports) module.exports=API; else root.Engine=API;
})(typeof self!=="undefined"?self:this);
