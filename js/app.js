/* Kickoff Lab - UI. Vanilla JS, no external libraries. */
(function(){
"use strict";
const E=window.Engine, S=window.ESPN;
const TZ="America/Iqaluit";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pct=(x,d=0)=>(x*100).toFixed(d)+"%";
const pct1=x=>x<0.0995?(x*100).toFixed(1)+"%":Math.round(x*100)+"%";
const odds=p=>p>0.0005?(1/p).toFixed(2):"–";
const fmtDay=d=>d.toLocaleDateString("en-CA",{timeZone:TZ,weekday:"short",month:"short",day:"numeric"});
const fmtTime=d=>d.toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"})+" ET";
const LEAGUE=Object.fromEntries(S.LEAGUES.map(l=>[l.code,l]));
const LS={get(k,d){try{const v=localStorage.getItem("kl.v1."+k);return v?JSON.parse(v):d;}catch(e){return d;}},
  set(k,v){try{localStorage.setItem("kl.v1."+k,JSON.stringify(v));}catch(e){}}, del(k){try{localStorage.removeItem("kl.v1."+k);}catch(e){}}};
const lastName=p=>{ const s=(p.short||p.name||"").replace(/^([A-ZÀ-Ý][a-z]?\.\s*)+/,""); return s||p.name; };
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("on"),2200); }
function hexColor(c,f){ return /^[0-9a-f]{6}$/i.test(c||"")?"#"+c:f; }
function textOn(hex){ const h=hex.replace("#",""); const r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16); return (r*299+g*587+b*114)/1000>150?"#111":"#fff"; }

// ======================================================================= data
const DATA={leagues:{},loading:{}}; const CACHE={summary:{},roster:{}};
let SNAP=null;
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
async function loadSnapshot(){ if(SNAP!==null) return SNAP; try{ await loadScript("data.js"); SNAP=window.SNAPSHOT||false; }catch(e){ SNAP=false; } return SNAP; }
const FORCE_OFFLINE=/[#&]offline=1/.test(location.hash);
async function loadLeague(code){
  if(code in DATA.leagues) return DATA.leagues[code];
  if(DATA.loading[code]) return DATA.loading[code];
  return DATA.loading[code]=(async()=>{
    let lg=null;
    try{ if(FORCE_OFFLINE) throw new Error("offline test"); lg=await S.loadLeagueLive(code); lg.source="live"; }
    catch(e){ const snap=await loadSnapshot(); if(snap&&snap.leagues&&snap.leagues[code]) lg=Object.assign({},snap.leagues[code],{source:"snapshot"}); }
    if(lg){
      lg.code=code; lg.evs=lg.events.map(S.normEvent);
      lg.model=E.buildLeagueModel(S.playedGames(lg.events,lg.seasonYear));
      lg.teams={}; for(const e of lg.evs) for(const t of [e.home,e.away]) if(!lg.teams[t.id]) lg.teams[t.id]=t;
      lg.rank={}; for(const ch of (lg.standings&&lg.standings.children)||[]) for(const en of ch.standings.entries){ const r=en.stats.find(s=>s.name==="rank"); if(r) lg.rank[String(en.team.id)]=Number(r.value??r.displayValue); }
    }
    DATA.leagues[code]=lg; renderStatus(); if(ROUTE.view==="fixtures") renderFixtures(); return lg;
  })();
}
const loadAll=()=>Promise.all(S.LEAGUES.map(l=>loadLeague(l.code)));
function renderStatus(){
  const ls=S.LEAGUES.map(l=>DATA.leagues[l.code]); const done=ls.filter(x=>x!==undefined).length;
  const live=ls.filter(x=>x&&x.source==="live").length, snap=ls.filter(x=>x&&x.source==="snapshot").length, fail=ls.filter(x=>x===null).length;
  let h="";
  if(done<ls.length) h+=`<span class="badge"><span class="dot"></span> Loading leagues ${done}/${ls.length}…</span>`;
  if(live) h+=`<span class="badge ok"><span class="dot"></span> Live ESPN data · ${live} league${live>1?"s":""}</span>`;
  if(snap) h+=`<span class="badge warn">Offline snapshot · ${snap} league${snap>1?"s":""}${SNAP&&SNAP.fetchedAt?" · "+esc(new Date(SNAP.fetchedAt).toLocaleString("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))+" ET":""}</span>`;
  if(fail) h+=`<span class="badge">${fail} unavailable</span>`;
  $("#status").innerHTML=h;
}
async function getSummary(league,id){
  if(CACHE.summary[id]) return CACHE.summary[id];
  let s=null;
  try{ if(FORCE_OFFLINE) throw 0; s=S.trimSummary(await S.getJSON(S.URLS.summary(league,id))); s.source="live"; }
  catch(e){ const snap=await loadSnapshot(); s=snap&&snap.summaries&&snap.summaries[id]; if(s) s=Object.assign({},s,{source:"snapshot"}); }
  return CACHE.summary[id]=s||null;
}
async function getRoster(leagues,tid){
  if(CACHE.roster[tid]) return CACHE.roster[tid];
  for(const l of leagues){
    try{ if(FORCE_OFFLINE) throw 0; const r=S.trimRoster(await S.getJSON(S.URLS.roster(l,tid))); if(r.athletes.length) return CACHE.roster[tid]={athletes:r.athletes,source:"live",league:l}; }catch(e){}
  }
  const snap=await loadSnapshot();
  if(snap&&snap.rosters){ for(const l of leagues){ const r=snap.rosters[l+":"+tid]; if(r) return CACHE.roster[tid]={athletes:r.athletes,source:"snapshot",league:l}; }
    const k=Object.keys(snap.rosters).find(k=>k.endsWith(":"+tid)); if(k) return CACHE.roster[tid]={athletes:snap.rosters[k].athletes,source:"snapshot",league:k.split(":")[0]}; }
  return null;
}
function domesticOf(tid){ for(const c of [...S.DOMESTIC,"usa.1"]){ const lg=DATA.leagues[c]; if(lg&&lg.model.T[tid]) return c; } for(const c of [...S.DOMESTIC,"usa.1"]){ const lg=DATA.leagues[c]; if(lg&&lg.teams[tid]) return c; } return null; }
function lastMatch(tid, excludeId){
  let best=null;
  for(const l of S.LEAGUES){ const lg=DATA.leagues[l.code]; if(!lg) continue;
    for(const e of lg.evs) if(e.completed&&e.id!==excludeId&&(e.home.id===tid||e.away.id===tid)&&(!best||e.date>best.ev.date)) best={league:l.code,ev:e}; }
  return best;
}
function findEvent(id,league){
  const order=league?[league,...S.LEAGUES.map(l=>l.code)]:S.LEAGUES.map(l=>l.code);
  for(const c of order){ const lg=DATA.leagues[c]; const e=lg&&lg.evs.find(x=>x.id===String(id)); if(e) return {league:c,ev:e}; }
  return null;
}

// ======================================================================= match context
let CTX=null, RESULT=null, ROUTE={view:"fixtures"};
const anonPlayer=(role,i)=>({id:"anon-"+i,name:role,short:role,jersey:"",pos:E.ROLE_GROUP[role],stats:null,anon:true});
async function buildTeam(info, ctxLeague, opts){
  const dom=domesticOf(info.id);
  const leagues=[...new Set([dom,ctxLeague].filter(Boolean))];
  const roster=await getRoster(leagues,info.id);
  const athletes=roster?roster.athletes:[];
  const byId=Object.fromEntries(athletes.map(p=>[p.id,p]));
  let lu=null, source=null;
  if(opts.summaryRoster){
    lu=S.lineupFromSummary(E,opts.summaryRoster,byId,opts.live);
    if(lu) source={type:"official",text:opts.live?`Official line-up from ESPN${lu.subsMade?` · ${lu.subsMade} sub${lu.subsMade>1?"s":""} already made`:""}`:"Official line-up announced (ESPN)"};
  }
  if(!lu){
    const lm=lastMatch(info.id,opts.eventId);
    if(lm){ const sum=await getSummary(lm.league,lm.ev.id); const sr=sum&&sum.rosters.find(r=>r.teamId===info.id);
      if(sr){ lu=S.probableFromLast(E,sr,athletes);
        if(lu){ const opp=lm.ev.home.id===info.id?lm.ev.away.short:lm.ev.home.short;
          source={type:"last",text:`Probable XI: starters from last match vs ${opp} (${fmtDay(lm.ev.date)}, ${LEAGUE[lm.league].short})`+(lu.changes.length?` · changed: ${lu.changes.map(c=>`${c.in} for ${c.out} (${c.why})`).join("; ")}`:"")}; } } }
  }
  if(!lu && athletes.length){ lu=S.probableFromRoster(E,athletes,"4-3-3"); source={type:"roster",text:"Probable XI: most season starts per position (no recent line-up available)"}; }
  if(!lu){ const slots=E.formationSlots("4-3-3"); lu={formation:"4-3-3",xi:slots.map((s,i)=>({player:anonPlayer(s.role,i),slot:s})),bench:[]}; source={type:"none",text:"Squad data unavailable from ESPN: simulating with team-level strength only (no player names)"}; }
  const seen=new Set(), squad=[];
  for(const p of [...lu.xi.map(x=>x.player),...lu.bench,...athletes]) if(!seen.has(p.id)){ seen.add(p.id); squad.push(p); }
  const inXI=new Set(lu.xi.map(x=>x.player.id)), inB=new Set(lu.bench.map(p=>p.id));
  const t={id:info.id,name:info.name,short:info.short,abbr:info.abbr,logo:info.logo,color:hexColor(info.color,"#6366f1"),alt:hexColor(info.alt,"#ffffff"),
    dom, rosterSource:roster?roster.source:null, rosterLeague:roster?roster.league:null,
    formation:lu.formation, xi:lu.xi, bench:lu.bench.filter(p=>!p.usedSub), used:lu.bench.filter(p=>p.usedSub), rest:squad.filter(p=>!inXI.has(p.id)&&!inB.has(p.id)&&!p.usedSub),
    squad, source, orig:null, captainId:null, tactics:Object.assign({},E.DEFAULT_TACTICS), subsUsed:lu.subsMade||0, edited:false,
    statsKnown:athletes.some(p=>p.stats&&(p.stats.apps||0)>0)};
  t.orig={formation:t.formation,xi:t.xi.map(x=>x.player.id),bench:t.bench.map(p=>p.id)};
  return t;
}
function teamFromSaved(t, key){
  const sv=LS.get("lu."+key+"."+t.id,null); if(!sv) return;
  if(sv.tactics) t.tactics=Object.assign({},E.DEFAULT_TACTICS,sv.tactics);
  if(sv.captainId) t.captainId=sv.captainId;
  if(sv.xi&&sv.xi.length===11){
    const by=Object.fromEntries(t.squad.map(p=>[p.id,p]));
    if(sv.xi.every(id=>by[id])){
      const slots=E.formationSlots(sv.formation);
      t.formation=sv.formation; t.xi=slots.map((s,i)=>({player:by[sv.xi[i]],slot:s}));
      const inXI=new Set(sv.xi); const bench=(sv.bench||[]).filter(id=>by[id]&&!inXI.has(id)).map(id=>by[id]);
      t.bench=bench; const inB=new Set(bench.map(p=>p.id)); t.rest=t.squad.filter(p=>!inXI.has(p.id)&&!inB.has(p.id)&&!p.usedSub);
      t.edited=sv.edited!==false && JSON.stringify(sv.xi)!==JSON.stringify(t.orig.xi)||sv.formation!==t.orig.formation;
    }
  }
}
function saveTeam(t){
  LS.set("lu."+CTX.key+"."+t.id,{formation:t.formation,xi:t.xi.map(x=>x.player.id),bench:t.bench.map(p=>p.id),captainId:t.captainId,tactics:t.tactics,savedAt:Date.now()});
  t.edited=JSON.stringify(t.xi.map(x=>x.player.id))!==JSON.stringify(t.orig.xi)||t.formation!==t.orig.formation;
  RESULT=null;
}
function saveCtxPrefs(){ LS.set("ctx."+CTX.key,{homeAdv:CTX.homeAdv,liveMode:CTX.liveMode}); RESULT=null; }
function parseClock(ev){
  const m=/(\d+)'?(?:\s*\+\s*(\d+))?/.exec(ev.clock||ev.detail||""); let minute=m?Number(m[1]):0; let period=ev.period||(minute>45?2:1);
  if(/HT|Half/i.test(ev.detail||"")){ minute=45; period=2; }
  return {minute:Math.min(minute,90),period};
}
async function openFixture(id, league){
  await loadLeague(league||"eng.1");
  let f=findEvent(id,league);
  if(!f){ await loadAll(); f=findEvent(id,league); }
  if(!f) throw new Error("Fixture "+id+" not found in ESPN data.");
  const ev=f.ev; league=f.league;
  if(league==="uefa.champions") await loadAll(); // domestic leagues for rating blend
  const sum=await getSummary(league,ev.id);
  const live=ev.state==="in"||(sum&&sum.status&&sum.status.state==="in");
  const sr=t=>sum&&sum.rosters.find(r=>r.teamId===t.id&&r.players.filter(p=>p.starter).length===11);
  const [home,away]=await Promise.all([buildTeam(ev.home,league,{summaryRoster:sr(ev.home),live,eventId:ev.id}),buildTeam(ev.away,league,{summaryRoster:sr(ev.away),live,eventId:ev.id})]);
  const key="fx"+ev.id;
  const prefs=LS.get("ctx."+key,{});
  const ctx={key,league,ev,quick:false,neutral:ev.neutral,homeAdv:prefs.homeAdv!=null?prefs.homeAdv:!ev.neutral,home,away,summarySource:sum&&sum.source,
    live:live?Object.assign(parseClock(sum&&sum.status?Object.assign({},ev,{clock:sum.status.clock,detail:sum.status.detail,period:sum.status.period}):ev),
      {score:sum&&sum.score&&sum.score[0]!=null?sum.score:[ev.hs||0,ev.as||0],reds:[(sum&&sum.rosters.find(r=>r.teamId===ev.home.id)||{}).reds||0,(sum&&sum.rosters.find(r=>r.teamId===ev.away.id)||{}).reds||0],detail:(sum&&sum.status&&sum.status.detail)||ev.detail}):null,
    liveMode:prefs.liveMode||"now"};
  teamFromSaved(home,key); teamFromSaved(away,key);
  return ctx;
}
async function openQuick(spec, neutral){
  const [a,b]=spec.split(",").map(x=>{ const [l,id]=x.split(":"); return {l,id}; });
  await Promise.all([loadLeague(a.l),loadLeague(b.l)]);
  const ta=DATA.leagues[a.l]&&DATA.leagues[a.l].teams[a.id], tb=DATA.leagues[b.l]&&DATA.leagues[b.l].teams[b.id];
  if(!ta||!tb) throw new Error("Team not found in loaded league data.");
  if(a.l==="uefa.champions"||b.l==="uefa.champions") await loadAll();
  const [home,away]=await Promise.all([buildTeam(ta,a.l,{}),buildTeam(tb,b.l,{})]);
  home.qLeague=a.l; away.qLeague=b.l;
  const key="q"+a.l+a.id+"-"+b.l+b.id; const prefs=LS.get("ctx."+key,{});
  const ctx={key,league:a.l===b.l?a.l:null,leagues:[a.l,b.l],ev:null,quick:true,neutral:!!neutral,homeAdv:prefs.homeAdv!=null?prefs.homeAdv:!neutral,home,away,live:null,liveMode:"full",spec};
  teamFromSaved(home,key); teamFromSaved(away,key);
  return ctx;
}
// ratings and engine input
function ratingsFor(ctx){
  const side=ctx.neutral||!ctx.homeAdv?"n":null;
  const one=(t,s)=>{
    const lgCode=ctx.quick?t.qLeague:ctx.league; const lg=DATA.leagues[lgCode];
    let model=lg&&lg.model, domModel=null, coef=1, statsModel=model, note="";
    const isUCL=lgCode==="uefa.champions";
    if(isUCL||ctx.quick){
      const dom=t.dom&&DATA.leagues[t.dom];
      if(isUCL&&dom){ domModel=dom.model; statsModel=dom.model; note=`blends ${LEAGUE[t.dom].short} form`; }
      coef=(LEAGUE[t.dom]||LEAGUE[lgCode]||{}).coef||0.85;
    }
    const r=model?E.teamRating(model,t.id,side||s,domModel):{att:1,def:1,N:0,form:0};
    if(t.rosterLeague&&DATA.leagues[t.rosterLeague]) statsModel=DATA.leagues[t.rosterLeague].model;
    return {r,coef,model,statsModel,note,lgCode};
  };
  const h=one(ctx.home,"h"), a=one(ctx.away,"a");
  const sameCoef=!ctx.quick&&ctx.league!=="uefa.champions";
  const ms=[h.model,a.model].filter(Boolean);
  const model=ms.length?{muH:ms.reduce((s,m)=>s+m.muH,0)/ms.length,muA:ms.reduce((s,m)=>s+m.muA,0)/ms.length,mu:ms.reduce((s,m)=>s+m.mu,0)/ms.length}:{muH:1.5,muA:1.2,mu:1.35};
  return {h,a,model,sameCoef};
}
function engineMatch(ctx){
  const R=ratingsFor(ctx);
  const team=(t,x)=>({id:t.id,name:t.name,short:t.short,abbr:t.abbr,rating:x.r,leagueCoef:R.sameCoef?1:x.coef,xi:t.xi,bench:t.bench,squad:t.squad,captainId:t.captainId,tactics:t.tactics,
    subsUsed:ctx.live&&ctx.liveMode==="now"?t.subsUsed:0, teamStats:S.teamStatsFromRoster(t.squad.filter(p=>p.stats),x.statsModel&&x.statsModel.T[t.id])});
  const m={home:team(ctx.home,R.h),away:team(ctx.away,R.a),model:R.model,homeAdv:ctx.homeAdv,neutral:ctx.neutral};
  if(ctx.live&&ctx.liveMode==="now"){ m.startMinute=ctx.live.minute; m.startPeriod=ctx.live.period; m.startScore=ctx.live.score.map(Number); m.liveReds=ctx.live.reds; }
  if(!(ctx.live&&ctx.liveMode==="now")){ m.home.bench=[...ctx.home.bench]; m.away.bench=[...ctx.away.bench]; }
  return m;
}
function configLabel(t){ const tc=t.tactics; return `${t.formation} · ${tc.mentality}, ${tc.pressing} press, ${tc.tempo} tempo, ${tc.width} width`; }

// ======================================================================= router
function parseHash(){ const h=location.hash.replace(/^#\/?/,""); const p={}; for(const kv of h.split("&")){ if(!kv) continue; const [k,v]=kv.split("="); p[decodeURIComponent(k)]=v==null?"1":decodeURIComponent(v); } return p; }
function hashFor(p){ return "#"+Object.entries(p).filter(([k,v])=>v!=null&&v!=="").map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
function ctxHash(view,extra){ if(!CTX) return "#"; const base=CTX.quick?{quick:CTX.spec,neutral:CTX.neutral?1:null}:{fixture:CTX.ev.id,league:CTX.league}; return hashFor(Object.assign(base,{view},extra||{})); }
function go(h){ if(location.hash===h) route(); else location.hash=h; }
function setView(view,extra){ history.replaceState(null,"",ctxHash(view,extra)); ROUTE.view=view; renderMatchTab(view); }
let routing=0;
async function route(){
  const p=parseHash(); const my=++routing;
  $$(".navbtn").forEach(b=>b.classList.toggle("on",b.dataset.nav===(p.view==="compare"||p.view==="about"?p.view:(!p.fixture&&!p.quick?"fixtures":""))));
  if(p.view==="compare"&&!p.fixture&&!p.quick){ ROUTE={view:"compare"}; return renderCompare(); }
  if(p.view==="about"&&!p.fixture&&!p.quick){ ROUTE={view:"about"}; return renderAbout(); }
  if(p.fixture||p.quick){
    const key=p.fixture?"fx"+p.fixture:null;
    const view=p.view||"lineup";
    ROUTE={view,params:p};
    if(!CTX||(key&&CTX.key!==key)||(p.quick&&CTX.spec!==p.quick)){
      $("#view").innerHTML=`<div class="card fade"><div class="skel" style="width:50%"></div><div class="skel"></div><div class="skel" style="width:70%"></div><p class="mut sm">Loading fixture, line-ups and squad stats from ESPN…</p></div>`;
      try{ const c=p.fixture?await openFixture(p.fixture,p.league):await openQuick(p.quick,p.neutral==="1"); if(my!==routing) return; CTX=c; RESULT=null; WATCH.stop(); EDIT.side="home"; EDIT.sel=null; }
      catch(e){ console.error(e); $("#view").innerHTML=`<div class="card"><h3>Couldn't open this match</h3><p class="mut">${esc(e.message||e)}</p><button class="btn" onclick="location.hash=''">Back to fixtures</button></div>`; return; }
    }
    if(p.team==="away") EDIT.side="away";
    if(CTX.live&&(p.mode==="full"||p.mode==="now")&&CTX.liveMode!==p.mode){ CTX.liveMode=p.mode; RESULT=null; }
    renderMatchShell(); renderMatchTab(view); setTimeout(loadAll,50);
    if(p.autorun==="1"&&!RESULT) runSims(Number(p.n)||10000, view);
    return;
  }
  ROUTE={view:"fixtures"}; CTX=CTX; renderFixtures(); loadAll();
}
window.addEventListener("hashchange",route);
$("#brand").onclick=()=>go("#");
$$(".navbtn").forEach(b=>b.onclick=()=>go(b.dataset.nav==="fixtures"?"#":"#view="+b.dataset.nav));
function updCmpCount(){ const n=LS.get("compare",[]).length; $("#cmpCount").textContent=n?n:""; }

// ======================================================================= fixtures view
let FXLG="all", QMSTATE=null;
function renderFixtures(){
  if(ROUTE.view!=="fixtures") return;
  const now=Date.now(), end=now+8*864e5; const rows=[]; const counts={all:0};
  for(const l of S.LEAGUES){ const lg=DATA.leagues[l.code]; if(!lg) continue;
    for(const e of lg.evs){ if(e.state==="in"||(e.state==="pre"&&e.date.getTime()>now-3*36e5&&e.date.getTime()<end)){ rows.push({e,l}); counts[l.code]=(counts[l.code]||0)+1; counts.all++; } } }
  rows.sort((a,b)=>(a.e.state==="in"?0:1)-(b.e.state==="in"?0:1)||a.e.date-b.e.date);
  const shown=rows.filter(r=>FXLG==="all"||r.l.code===FXLG);
  const loading=S.LEAGUES.some(l=>!(l.code in DATA.leagues));
  let list="", last="";
  for(const {e,l} of shown){
    const day=e.state==="in"?"🔴 Live now":fmtDay(e.date); if(day!==last){ list+=`<div class="daytitle">${day}</div>`; last=day; }
    const lg=DATA.leagues[l.code]; const rk=id=>lg.rank[id]?`<span class="xs mut">${lg.rank[id]}</span>`:"";
    list+=`<div class="fx fade" data-go="${hashFor({fixture:e.id,league:l.code,view:"lineup"})}">
      <div class="time">${e.state==="in"?`<span class="badge live"><span class="dot"></span>${esc(e.clock||"LIVE")}</span>`:fmtTime(e.date).replace(" ET","")}<small>${e.state==="in"?"":"ET"}</small></div>
      <div class="teams"><div class="lg">${esc(l.short)}${e.venue?" · "+esc(e.venue):""}</div>
        <div>${e.home.logo?`<img src="${esc(e.home.logo)}" alt="" loading="lazy">`:""}${esc(e.home.name)} ${rk(e.home.id)}${e.state==="in"?`<span class="sc">${e.hs??""}</span>`:""}</div>
        <div>${e.away.logo?`<img src="${esc(e.away.logo)}" alt="" loading="lazy">`:""}${esc(e.away.name)} ${rk(e.away.id)}${e.state==="in"?`<span class="sc">${e.as??""}</span>`:""}</div></div>
      <div class="go">Simulate ›</div></div>`;
  }
  if(!list) list=loading?`<div class="card"><div class="skel"></div><div class="skel" style="width:60%"></div><div class="skel" style="width:80%"></div></div>`:`<div class="card mut">No upcoming fixtures in the next 8 days for this league.</div>`;
  const chips=[{code:"all",short:"All"},...S.LEAGUES].map(l=>`<button class="chip ${FXLG===l.code?"on":""}" data-lg="${l.code}">${esc(l.short)}<small>${counts[l.code]||0}</small></button>`).join("");
  const qmState=QMSTATE||LS.get("qm",null);
  $("#view").innerHTML=`
    <div class="card fade" id="qm"><h3>⚡ Quick match <span class="sub">any two teams from the covered leagues</span></h3>
      <div class="qm">
        <div><label class="f">Home team</label><div class="row" style="flex-wrap:nowrap"><select id="qla" style="max-width:46%"></select><select id="qta"></select></div></div>
        <div><label class="f">Away team</label><div class="row" style="flex-wrap:nowrap"><select id="qlb" style="max-width:46%"></select><select id="qtb"></select></div></div>
        <label class="switch" id="qnw"><input type="checkbox" id="qn" hidden><i></i><span class="sm">Neutral venue</span></label>
        <button class="btn pri" id="qgo">Set up match</button>
      </div></div>
    <div class="chips">${chips}</div>
    <div id="fxlist">${list}</div>`;
  const lgOpts=S.LEAGUES.filter(l=>DATA.leagues[l.code]).map(l=>`<option value="${l.code}">${esc(l.short)}</option>`).join("");
  const fillTeams=(lsel,tsel,pref)=>{ const lg=DATA.leagues[$(lsel).value]; const ts=lg?Object.values(lg.teams).sort((a,b)=>a.name.localeCompare(b.name)):[]; $(tsel).innerHTML=ts.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join(""); if(pref&&ts.some(t=>t.id===pref)) $(tsel).value=pref; };
  $("#qla").innerHTML=lgOpts; $("#qlb").innerHTML=lgOpts;
  if(qmState){ if(DATA.leagues[qmState.la]) $("#qla").value=qmState.la; if(DATA.leagues[qmState.lb]) $("#qlb").value=qmState.lb; }
  fillTeams("#qla","#qta",qmState&&qmState.ta); fillTeams("#qlb","#qtb",qmState&&qmState.tb);
  if(!qmState&&$("#qtb").options.length>1) $("#qtb").selectedIndex=1;
  if(qmState&&qmState.n){ $("#qn").checked=true; $("#qnw").classList.add("on"); }
  const keep=()=>{ QMSTATE={la:$("#qla").value,ta:$("#qta").value,lb:$("#qlb").value,tb:$("#qtb").value,n:$("#qn").checked}; };
  $("#qla").onchange=()=>{ fillTeams("#qla","#qta"); keep(); }; $("#qlb").onchange=()=>{ fillTeams("#qlb","#qtb"); keep(); };
  $("#qta").onchange=keep; $("#qtb").onchange=keep;
  $("#qnw").onclick=e=>{ e.preventDefault(); $("#qn").checked=!$("#qn").checked; $("#qnw").classList.toggle("on",$("#qn").checked); keep(); };
  $("#qgo").onclick=()=>{ const la=$("#qla").value,ta=$("#qta").value,lb=$("#qlb").value,tb=$("#qtb").value; if(!ta||!tb) return; if(la===lb&&ta===tb) return toast("Pick two different teams");
    LS.set("qm",{la,ta,lb,tb,n:$("#qn").checked}); go(hashFor({quick:`${la}:${ta},${lb}:${tb}`,neutral:$("#qn").checked?1:null,view:"lineup"})); };
  $$(".chip").forEach(c=>c.onclick=()=>{ FXLG=c.dataset.lg; renderFixtures(); });
  $$(".fx").forEach(f=>f.onclick=()=>go(f.dataset.go));
}

// ======================================================================= match shell
function formStr(t){ const lg=DATA.leagues[CTX.quick?t.qLeague:CTX.league]; const mt=lg&&lg.model.T[t.id]; return mt&&mt.form?mt.form.split("").map(r=>`<span class="fl ${r}">${r}</span>`).join(""):""; }
function renderMatchShell(){
  const c=CTX, h=c.home, a=c.away;
  const lgName=c.quick?(c.leagues[0]===c.leagues[1]?LEAGUE[c.leagues[0]].short:"Cross-league friendly"):LEAGUE[c.league].short;
  const mid=c.live?`<span class="badge live"><span class="dot"></span>LIVE ${esc(c.live.detail||"")}</span><b>${c.live.score[0]} – ${c.live.score[1]}</b>`
    : c.ev?`${fmtDay(c.ev.date)}<b>${fmtTime(c.ev.date).replace(" ET","")}</b>ET`:`Quick match<b>vs</b>${c.neutral?"Neutral venue":"at "+esc(h.short)}`;
  const tm=t=>`<div class="tm">${t.logo?`<img src="${esc(t.logo)}" alt="" crossorigin="anonymous">`:""}<span>${esc(t.name)}</span><span class="form">${formStr(t)}</span></div>`;
  $("#view").innerHTML=`
    <div class="card fade" style="padding:12px 12px 10px">
      <div class="row xs mut" style="margin-bottom:8px"><span class="badge">${esc(lgName)}</span>${c.ev&&c.ev.venue?`<span>📍 ${esc(c.ev.venue)}</span>`:""}<span class="spacer"></span>
        <button class="btn sm" id="copyLink">🔗 Link</button></div>
      <div class="mh">${tm(h)}<div class="mid">${mid}</div>${tm(a)}</div>
    </div>
    <div class="tabs" id="mtabs">${[["lineup","👕 Line-ups"],["tactics","🧠 Tactics"],["results","📊 Results"],["live","🎬 Watch"]].map(([k,l])=>`<button class="tab" data-t="${k}">${l}</button>`).join("")}</div>
    <div id="mview"></div>
    <div class="sticky-run"><button class="btn pri" id="runBtn">▶ Simulate 10,000 matches</button><button class="btn" id="watchBtn" style="max-width:150px">🎬 Watch one</button></div>`;
  $$("#mtabs .tab").forEach(b=>b.onclick=()=>setView(b.dataset.t));
  $("#runBtn").onclick=()=>{ setView("results"); runSims(10000,"results"); };
  $("#watchBtn").onclick=()=>{ setView("live",{autoplay:1}); WATCH.start(); };
  $("#copyLink").onclick=()=>copyText(location.href.split("#")[0]+ctxHash(ROUTE.view),"Link copied");
}
function renderMatchTab(view){
  if(!CTX||!$("#mview")) return;
  $$("#mtabs .tab").forEach(b=>b.classList.toggle("on",b.dataset.t===view));
  if(view!=="live") WATCH.pause();
  ({lineup:renderLineup,tactics:renderTactics,results:renderResults,live:renderWatch}[view]||renderLineup)();
}

// ======================================================================= line-up editor
const EDIT={side:"home",sel:null};
const curTeam=()=>CTX[EDIT.side];
function shirt(t,p,size){ const bg=t.color, fg=textOn(bg); const gk=p.pos==="G"; return `background:${gk?"#f59e0b":bg};color:${gk?"#111":fg}`; }
function renderLineup(){
  const t=curTeam(), other=EDIT.side==="home"?CTX.away:CTX.home;
  const fopts=[...new Set([t.formation,...E.FORMATION_NAMES])].map(f=>`<option ${f===t.formation?"selected":""}>${f}</option>`).join("");
  const srcCls=t.source.type==="official"?"ok":t.source.type==="none"?"live":"warn";
  $("#mview").innerHTML=`
    <div class="row" style="margin-bottom:10px">
      <div class="seg" style="flex:1;max-width:420px">${["home","away"].map(s=>`<button data-side="${s}" class="${EDIT.side===s?"on":""}">${esc(CTX[s].short)}</button>`).join("")}</div>
      <select id="formSel" style="width:auto">${fopts}</select>
      <button class="btn sm" id="resetLU" ${t.edited||t.captainId?"":"disabled"}>↺ Reset</button>
    </div>
    <div class="pitchwrap fade">
      <div><div class="pitch" id="pitch">${pitchLines()}${t.xi.map((x,i)=>plHTML(t,x,i)).join("")}</div>
        <p class="xs mut" style="text-align:center;margin:6px 0 0">Tap a player, then tap another to swap · or drag onto a teammate / bench player</p></div>
      <div>
        <div class="card"><h3>${esc(t.name)} <span class="sub">${esc(t.formation)}${t.edited?" · edited (saved on this device)":""}</span></h3>
          <div class="badge ${srcCls}" style="white-space:normal;line-height:1.35">${esc(t.source.text)}</div>
          ${strengthHTML(t)}
        </div>
        <div class="card" id="selInfo">${selInfoHTML()}</div>
        <div class="card"><h3>🪑 Bench <span class="sub">${t.bench.length} players${t.used&&t.used.length?` · ${t.used.length} already subbed off`:""}</span></h3>
          <div class="bench">${t.bench.map(p=>bpHTML(t,p,"bench")).join("")||'<span class="mut sm">No bench data</span>'}</div></div>
        ${t.rest.length?`<div class="card"><details ${EDIT.openRest?"open":""} id="restD"><summary class="sm" style="cursor:pointer;font-weight:700">Rest of squad (${t.rest.length})</summary><div class="bench" style="margin-top:8px">${t.rest.map(p=>bpHTML(t,p,"rest")).join("")}</div></details></div>`:""}
      </div>
    </div>`;
  $$("#mview .seg button[data-side]").forEach(b=>b.onclick=()=>{ EDIT.side=b.dataset.side; EDIT.sel=null; renderLineup(); });
  $("#formSel").onchange=e=>changeFormation(t,e.target.value);
  $("#resetLU").onclick=()=>resetTeam(t);
  const rd=$("#restD"); if(rd) rd.ontoggle=()=>EDIT.openRest=rd.open;
  bindDrag(); bindSelInfo();
}
function pitchLines(){
  return `<div class="ln" style="inset:2% 3%;border-radius:4px"></div><div class="ln" style="left:3%;right:3%;top:50%;height:0;border-width:2px 0 0"></div>
  <div class="ln" style="left:50%;top:50%;width:26%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%)"></div>
  <div class="ln" style="left:22%;right:22%;top:2%;height:14%;border-top:0"></div><div class="ln" style="left:36%;right:36%;top:2%;height:5%;border-top:0"></div>
  <div class="ln" style="left:22%;right:22%;bottom:2%;height:14%;border-bottom:0"></div><div class="ln" style="left:36%;right:36%;bottom:2%;height:5%;border-bottom:0"></div>`;
}
function plHTML(t,x,i){
  const p=x.player, sel=EDIT.sel&&EDIT.sel.k==="xi:"+i;
  const pen=E.posPenalty(p.pos,x.slot.group,p.pos2,x.slot.role); const oop=pen[0]<1||pen[1]<1;
  return `<div class="pl ${sel?"sel":""}" data-k="xi:${i}" style="left:${x.slot.x}%;top:${4+x.slot.y*0.92}%">
    <div class="sh" style="${shirt(t,p)}">${esc(p.jersey||"")}${t.captainId===p.id?'<span class="cap">C</span>':""}${oop?'<span class="warn" title="Out of position">!</span>':""}</div>
    <div class="nm">${esc(lastName(p))}</div><div class="rl">${x.slot.role}</div></div>`;
}
function bpHTML(t,p,kind){
  const s=p.stats; const sel=EDIT.sel&&EDIT.sel.k===kind+":"+p.id;
  return `<div class="bp ${sel?"sel":""} ${p.inj?"inj":""}" data-k="${kind}:${p.id}"><div class="sh" style="${shirt(t,p)}">${esc(p.jersey||"")}</div>
   <div style="min-width:0"><b>${esc(lastName(p))}${t.captainId===p.id?" (C)":""}</b><span>${p.pos}${s?` · ${s.apps||0} apps · ${s.goals||0}G ${s.assists||0}A`:" · no stats"}${p.inj?" · 🚑 "+esc(p.inj):""}</span></div></div>`;
}
function strengthHTML(t){
  const st=E.lineupStrength(t.xi,t.squad);
  const att=st.pAtt*st.shapeAtt, def=1/(st.pDef*st.shapeDef);
  const missing=st.usual.filter(id=>!t.xi.some(x=>x.player.id===id)).map(id=>t.squad.find(p=>p.id===id)).filter(Boolean);
  const bar=(lbl,v)=>`<div style="margin-top:8px"><div class="row sm"><span>${lbl}</span><span class="spacer"></span><b>${Math.round(v*100)}%</b></div><div class="meter"><i style="width:${Math.min(100,v*80)}%"></i></div></div>`;
  return `${bar("Attack vs usual XI",att)}${bar("Defence vs usual XI",def)}
   <p class="xs mut" style="margin:8px 0 0">${st.statsKnown?`Usual XI = most starts this season (ESPN squad stats).${missing.length?` Not starting: <b style="color:var(--txt)">${missing.map(p=>esc(lastName(p))).join(", ")}</b>.`:" All regular starters are in."} Formation shape: attack ×${st.shapeAtt.toFixed(2)}, concede ×${st.shapeDef.toFixed(2)}.`
     :"ESPN has no season player stats for this squad yet, so line-up strength only reflects positions and formation."}</p>`;
}
function selInfoHTML(){
  const t=curTeam(); if(!EDIT.sel) return `<h3>👆 Select a player</h3><p class="sm mut" style="margin:0">Tap any player to see season stats, set the captain, or swap. Edits save automatically on this device.</p>${t.captainId?"":`<p class="xs mut">No captain set yet.</p>`}`;
  const p=EDIT.sel.p, s=p.stats;
  const g=(v,l)=>`<div><b>${v}</b><span>${l}</span></div>`;
  return `<h3>${esc(p.name)} <span class="sub">#${esc(p.jersey||"–")} · ${({G:"Goalkeeper",D:"Defender",M:"Midfielder",F:"Forward"})[p.pos]||p.pos}${p.pos2?` (played ${p.pos2} last match)`:""}${p.age?` · age ${p.age}`:""}</span></h3>
    ${p.inj?`<div class="badge live">🚑 ${esc(p.inj)}</div>`:""}
    ${s?`<div class="statg">${g(s.apps||0,"Apps")}${g(E.starts(p),"Starts")}${g(s.goals||0,"Goals")}${g(s.assists||0,"Assists")}${g(s.shots||0,"Shots")}${g(s.sot||0,"On tgt")}${p.pos==="G"?g(s.saves||0,"Saves"):g(s.yc||0,"Yellows")}</div>`
      :`<p class="sm mut">No season stats from ESPN for this player${p.anon?" (squad unavailable)":""}.</p>`}
    <div class="row" style="margin-top:10px">${EDIT.sel.k.startsWith("xi:")?`<button class="btn sm" id="capBtn">${t.captainId===p.id?"Remove captain":"©️ Make captain"}</button>`:""}<button class="btn sm" id="selCancel">Cancel</button>
    <span class="xs mut">Now tap a player to swap</span></div>`;
}
function bindSelInfo(){ const c=$("#capBtn"); if(c) c.onclick=()=>{ const t=curTeam(); t.captainId=t.captainId===EDIT.sel.p.id?null:EDIT.sel.p.id; saveTeam(t); toast(t.captainId?lastName(EDIT.sel.p)+" is captain":"Captain removed"); EDIT.sel=null; renderLineup(); };
  const x=$("#selCancel"); if(x) x.onclick=()=>{ EDIT.sel=null; renderLineup(); }; }
function getByKey(t,k){ const [kind,v]=k.split(":"); if(kind==="xi") return t.xi[Number(v)].player; return (kind==="bench"?t.bench:t.rest).find(p=>p.id===v); }
function tap(k){
  const t=curTeam();
  if(EDIT.sel&&EDIT.sel.k===k){ EDIT.sel=null; return renderLineup(); }
  if(!EDIT.sel){ EDIT.sel={k,p:getByKey(t,k)}; return renderLineup(); }
  const a=EDIT.sel.k, b=k; EDIT.sel=null;
  if(!a.startsWith("xi:")&&!b.startsWith("xi:")){ // bench <-> rest
    const [ka,va]=a.split(":"), [kb,vb]=b.split(":");
    if(ka===kb){ EDIT.sel={k:b,p:getByKey(t,b)}; return renderLineup(); }
    const pa=getByKey(t,a), pb=getByKey(t,b); const L={bench:t.bench,rest:t.rest};
    L[ka][L[ka].indexOf(pa)]=pb; L[kb][L[kb].indexOf(pb)]=pa; saveTeam(t); toast(`${lastName(pa)} ⇄ ${lastName(pb)}`); return renderLineup();
  }
  swap(t,a,b);
}
function swap(t,a,b){
  if(!a.startsWith("xi:")){ const x=a; a=b; b=x; }
  const i=Number(a.split(":")[1]); const pa=t.xi[i].player;
  if(b.startsWith("xi:")){ const j=Number(b.split(":")[1]); const pb=t.xi[j].player; t.xi[i].player=pb; t.xi[j].player=pa; toast(`${lastName(pa)} ⇄ ${lastName(pb)}`); }
  else { const [kind,id]=b.split(":"); const L=kind==="bench"?t.bench:t.rest; const k=L.findIndex(p=>p.id===id); const pb=L[k];
    t.xi[i].player=pb; L[k]=pa; if(t.captainId===pa.id) t.captainId=null; toast(`${lastName(pb)} in, ${lastName(pa)} out`); }
  saveTeam(t); renderLineup();
}
function changeFormation(t,f){
  const slots=E.formationSlots(f); const old=t.xi.map(x=>({p:x.player,s:x.slot})); const res=new Array(slots.length);
  const gki=old.findIndex(o=>o.s.group==="G"); const gs=slots.findIndex(s=>s.group==="G");
  if(gki>=0&&gs>=0){ res[gs]=old[gki].p; old.splice(gki,1); }
  const order=slots.map((s,i)=>i).filter(i=>res[i]==null).sort((x,y)=>slots[y].y-slots[x].y);
  for(const i of order){ const s=slots[i]; let best=0,bd=1e9;
    old.forEach((o,k)=>{ const gp=o.p.pos===s.group||o.p.pos2===s.group?0:o.s.group===s.group?8:30; const d=Math.abs(o.s.x-s.x)*0.6+Math.abs(o.s.y-s.y)+gp; if(d<bd){bd=d;best=k;} });
    res[i]=old.splice(best,1)[0].p; }
  t.formation=f; t.xi=slots.map((s,i)=>({player:res[i],slot:s})); saveTeam(t); renderLineup(); toast("Formation "+f);
}
function resetTeam(t){
  LS.del("lu."+CTX.key+"."+t.id);
  const by=Object.fromEntries(t.squad.map(p=>[p.id,p])); const slots=E.formationSlots(t.orig.formation);
  t.formation=t.orig.formation; t.xi=slots.map((s,i)=>({player:by[t.orig.xi[i]],slot:s}));
  t.bench=t.orig.bench.map(id=>by[id]); const inX=new Set(t.orig.xi), inB=new Set(t.orig.bench); t.rest=t.squad.filter(p=>!inX.has(p.id)&&!inB.has(p.id)&&!p.usedSub);
  t.captainId=null; t.tactics=Object.assign({},E.DEFAULT_TACTICS); t.edited=false; RESULT=null; EDIT.sel=null; renderLineup(); toast("Line-up reset");
}
function bindDrag(){
  let st=null;
  const els=$$("#mview [data-k]");
  els.forEach(el=>{
    el.onpointerdown=e=>{ if(e.button>0) return; st={k:el.dataset.k,x:e.clientX,y:e.clientY,el,drag:false,ghost:null,over:null}; el.setPointerCapture(e.pointerId); };
    el.onpointermove=e=>{ if(!st||st.el!==el) return;
      if(!st.drag&&Math.hypot(e.clientX-st.x,e.clientY-st.y)>8){ st.drag=true; const g=(el.querySelector(".sh")||el).cloneNode(true); g.classList.add("ghost"); document.body.appendChild(g); st.ghost=g; }
      if(st.drag){ st.ghost.style.left=e.clientX+"px"; st.ghost.style.top=e.clientY+"px";
        const tgt=document.elementFromPoint(e.clientX,e.clientY); const o=tgt&&tgt.closest("[data-k]");
        if(st.over&&st.over!==o) st.over.classList.remove("drop"); if(o&&o!==el){ o.classList.add("drop"); st.over=o; } else st.over=null; } };
    el.onpointerup=e=>{ if(!st||st.el!==el) return; const s=st; st=null; if(s.ghost) s.ghost.remove();
      if(!s.drag) return tap(s.k);
      if(s.over){ s.over.classList.remove("drop"); const t=curTeam(); const a=s.k,b=s.over.dataset.k; EDIT.sel=null;
        if(!a.startsWith("xi:")&&!b.startsWith("xi:")){ EDIT.sel={k:a,p:getByKey(t,a)}; tap(b); } else swap(t,a,b); } };
    el.onpointercancel=()=>{ if(st&&st.ghost) st.ghost.remove(); st=null; };
  });
}

// ======================================================================= tactics
const TAC_OPTS={mentality:["defensive","balanced","attacking"],pressing:["low","medium","high"],tempo:["slow","normal","fast"],width:["narrow","normal","wide"]};
const TAC_HELP={
  mentality:"Defensive: own chances ×0.85, opponent ×0.88. Attacking: own ×1.12, opponent ×1.10.",
  pressing:"High: own chances ×1.05, opponent ×0.95, strongest before 65' then fades; +25% cards. Low: ×0.96 / ×0.97, −15% cards.",
  tempo:"Fast: +14% shots at −6% quality, and a more open game for both teams (×1.05). Slow: −12% shots, +6% quality, ×0.95.",
  width:"Wide: +25% corners, +6% shots at −5% quality. Narrow: −20% corners, −5% shots at +4% quality."};
function renderTactics(){
  const c=CTX;
  const card=s=>{ const t=c[s]; return `<div class="card"><h3>${t.logo?`<img class="tlogo" src="${esc(t.logo)}" alt="">`:""}${esc(t.name)} <span class="sub">${s}</span></h3>
    ${Object.entries(TAC_OPTS).map(([k,opts])=>`<div class="tac"><div class="lbl"><span style="text-transform:capitalize">${k}</span></div>
      <div class="seg">${opts.map(o=>`<button data-s="${s}" data-k="${k}" data-v="${o}" class="${t.tactics[k]===o?"on":""}">${o}</button>`).join("")}</div></div>`).join("")}</div>`; };
  $("#mview").innerHTML=`<div class="grid2 fade">${card("home")}${card("away")}
    <div class="card span2"><h3>🏟️ Match settings</h3>
      <label class="switch ${c.homeAdv?"on":""}" id="haSw"><i></i><span>Home advantage for ${esc(c.home.short)} ${c.neutral?'<span class="xs mut">(fixture is at a neutral venue)</span>':""}</span></label>
      <p class="xs mut">On: league-average home/away scoring rates and each team's home/away splits. Off: both teams use neutral (overall) rates.</p>
      ${c.live?`<div class="tac" style="margin-top:12px"><div class="lbl"><span>Live match: simulate from…</span></div><div class="seg" id="lmSeg">
        <button data-v="now" class="${c.liveMode==="now"?"on":""}">Now · ${esc(c.live.detail||"")} · ${c.live.score.join("-")}</button><button data-v="full" class="${c.liveMode==="full"?"on":""}">Kick-off (0-0)</button></div>
        <p class="xs mut">"Now" keeps the current score, minute, red cards and substitutions already made (current XI on the pitch).</p></div>`:""}
    </div>
    <div class="card span2"><h3>📖 What the tactics do</h3><div class="why">${Object.entries(TAC_HELP).map(([k,v])=>`<div><b style="text-transform:capitalize">${k}:</b> ${v}</div>`).join("")}
      <div style="margin-top:6px">Effects multiply on top of the data-driven expected goals, then the minute-by-minute engine is re-calibrated. Choosing defensive vs attacking changes both teams' numbers.</div></div></div>
  </div>`;
  $$("#mview .seg button[data-k]").forEach(b=>b.onclick=()=>{ const t=c[b.dataset.s]; t.tactics[b.dataset.k]=b.dataset.v; saveTeam(t); renderTactics(); });
  $("#haSw").onclick=()=>{ c.homeAdv=!c.homeAdv; saveCtxPrefs(); renderTactics(); };
  $$("#lmSeg button").forEach(b=>b.onclick=()=>{ c.liveMode=b.dataset.v; saveCtxPrefs(); renderTactics(); });
}

// ======================================================================= simulation runner
let WORKER=null, RUNID=0;
function getWorker(){ if(WORKER===false) return null; if(WORKER) return WORKER; try{ if(/[#&]worker=0/.test(location.hash)) throw 0; WORKER=new Worker("js/worker.js"); }catch(e){ WORKER=false; } return WORKER||null; }
function runSims(n,viewAfter){
  const match=engineMatch(CTX); const id=++RUNID; const seed=(Date.now()%1e9)|0;
  const started=performance.now();
  const snapshot={key:CTX.key,home:configLabel(CTX.home),away:configLabel(CTX.away)};
  RESULT={running:true,done:0,n};
  if(ROUTE.view==="results") renderResults();
  const finish=(sum,info)=>{ if(id!==RUNID) return; RESULT={sum,info,n,ms:Math.round(performance.now()-started),at:new Date(),cfg:snapshot,match}; if(ROUTE.view==="results") renderResults(); };
  const progress=d=>{ if(id!==RUNID) return; RESULT.done=d; const b=$("#prog i"); if(b) b.style.width=(d/n*100)+"%"; const l=$("#progTxt"); if(l) l.textContent=`${d.toLocaleString()} / ${n.toLocaleString()}`; };
  const w=getWorker();
  if(w){
    w.onmessage=ev=>{ const d=ev.data; if(d.id!==id) return; if(d.type==="progress") progress(d.done); else if(d.type==="done") finish(d.sum,d.info); else { console.error(d.error); WORKER=false; runSims(n,viewAfter); } };
    w.onerror=e=>{ console.error(e); WORKER=false; runSims(n,viewAfter); };
    w.postMessage({match,n,seed,id});
  } else { // chunked on the main thread
    const prep=E.prepare(match); E.calibrate(prep,2500,seed+7); const agg=E.newAgg(); const rng=E.mulberry32(seed); let done=0;
    const step=()=>{ if(id!==RUNID) return; E.runChunk(prep,agg,Math.min(1000,n-done),rng); done=Math.min(done+1000,n); progress(done);
      if(done<n) setTimeout(step,0); else finish(E.summarize(agg,prep),{base:prep.base,afterLineup:prep.afterLineup,tac:prep.tac,form:prep.form,useHome:prep.useHome,calib:prep.calib,H:{lam:prep.H.lam,shots:prep.H.shots,str:prep.H.str},A:{lam:prep.A.lam,shots:prep.A.shots,str:prep.A.str}}); };
    setTimeout(step,0);
  }
}
const nameById=id=>{ for(const t of [CTX.home,CTX.away]){ const p=t.squad.find(x=>x.id===id); if(p) return {p,t}; } return null; };

// ======================================================================= results
function renderResults(){
  const v=$("#mview"); if(!v) return;
  if(!RESULT){ v.innerHTML=`<div class="card fade" style="text-align:center;padding:28px 14px"><div style="font-size:2.4rem">📊</div><h3 style="justify-content:center">Ready to simulate</h3>
      <p class="mut sm">${esc(CTX.home.short)}: ${esc(configLabel(CTX.home))}<br>${esc(CTX.away.short)}: ${esc(configLabel(CTX.away))}${CTX.live&&CTX.liveMode==="now"?`<br>Starting from ${esc(CTX.live.detail)} at ${CTX.live.score.join("-")}`:""}</p>
      <div class="row" style="justify-content:center"><select id="nSel" style="width:auto"><option value="1000">1,000 runs</option><option value="10000" selected>10,000 runs</option><option value="50000">50,000 runs</option></select>
      <button class="btn pri" id="goRun">▶ Run simulation</button></div></div>`;
    $("#goRun").onclick=()=>runSims(Number($("#nSel").value),"results"); return; }
  if(RESULT.running){ v.innerHTML=`<div class="card fade"><h3>⚙️ Simulating ${RESULT.n.toLocaleString()} matches… <span class="sub" id="progTxt">${RESULT.done.toLocaleString()} / ${RESULT.n.toLocaleString()}</span></h3><div class="progress" id="prog"><i style="width:${RESULT.done/RESULT.n*100}%"></i></div>
     <p class="xs mut">Minute-by-minute engine running in a background thread, so the page stays responsive.</p></div>`; return; }
  const r=RESULT.sum, info=RESULT.info, h=CTX.home, a=CTX.away;
  const stale=RESULT.cfg.home!==configLabel(h)||RESULT.cfg.away!==configLabel(a);
  const heatC=p=>`background:rgba(139,92,246,${Math.min(0.95,0.08+p*6)});color:${p>0.06?"#fff":"var(--txt)"}`;
  let heat=`<div class="hd">${esc(h.abbr||"H")}↓</div>`+[0,1,2,3,4,5].map(j=>`<div class="hd">${j}</div>`).join("");
  for(let i=0;i<6;i++){ heat+=`<div class="hd">${i}</div>`; for(let j=0;j<6;j++){ const p=r.grid[i][j]; heat+=`<div style="${heatC(p)}" title="${h.short} ${i}-${j} ${a.short}: ${pct(p,1)}">${(p*100).toFixed(1)}</div>`; } }
  const scorers=side=>{ const t=CTX[side]; const ids=new Set(t.squad.map(p=>p.id)); return r.scorers.filter(s=>ids.has(s.id)).slice(0,8); };
  const sTable=side=>{ const t=CTX[side]; const rows=scorers(side); if(t.source.type==="none") return `<p class="mut sm">Player-level data unavailable.</p>`;
    return `<table class="t"><tr><th>${esc(t.short)}</th><th class="n">Anytime</th><th class="n">Fair odds</th></tr>${rows.map(s=>{ const p=t.squad.find(x=>x.id===s.id); const onB=!t.xi.some(x=>x.player.id===s.id);
      return `<tr><td>${esc(lastName(p))}${onB?' <span class="xs mut">(sub)</span>':""}<div class="pbar" style="width:${Math.min(100,s.p*140)}%;background:${side==="home"?"var(--home)":"var(--away)"}"></div></td><td class="n"><b>${pct1(s.p)}</b></td><td class="n mut">${odds(s.p)}</td></tr>`; }).join("")}</table>`; };
  const statRow=(lbl,x,y,d=1)=>{ const tot=x+y||1; return `<div class="cmpstat"><div class="lbl">${lbl}</div><b>${x.toFixed(d)}</b><div class="b"><div style="width:${x/tot*100}%;background:var(--home)"></div><div style="width:${y/tot*100}%;background:var(--away)"></div></div><b style="text-align:right">${y.toFixed(d)}</b></div>`; };
  const ch=x=>(x>=1?"+":"")+((x-1)*100).toFixed(0)+"%";
  v.innerHTML=`<div class="grid2 fade">
    <div class="card span2">
      <div class="row" style="margin-bottom:8px"><h3 style="margin:0">📊 ${RESULT.n.toLocaleString()} simulations</h3><span class="xs mut">${RESULT.ms} ms · ${RESULT.at.toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"})} ET${CTX.live&&CTX.liveMode==="now"?` · from ${esc(CTX.live.detail)} at ${CTX.live.score.join("-")}`:""}</span><span class="spacer"></span>
        ${stale?`<span class="badge warn">Settings changed: re-run</span>`:""}</div>
      <div class="probs"><div class="h"><b>${pct(r.H)}</b><span>${esc(h.short)} win</span></div><div class="d"><b>${pct(r.D)}</b><span>Draw</span></div><div class="a"><b>${pct(r.A)}</b><span>${esc(a.short)} win</span></div></div>
      <div class="bar"><div style="width:${r.H*100}%;background:var(--home)"></div><div style="width:${r.D*100}%;background:var(--draw)"></div><div style="width:${r.A*100}%;background:var(--away)"></div></div>
      <div class="row xs mut"><span>Model fair odds: <b style="color:var(--txt)">${odds(r.H)} / ${odds(r.D)} / ${odds(r.A)}</b></span><span class="spacer"></span><span>Expected goals <b style="color:var(--txt)">${r.xgH.toFixed(2)} – ${r.xgA.toFixed(2)}</b></span></div>
      <div class="row" style="margin-top:12px"><button class="btn sm" id="saveCmp">⚖️ Save to compare</button><button class="btn sm" id="shareImg">🖼️ Share card (PNG)</button><button class="btn sm" id="copySum">📋 Copy summary</button><button class="btn sm" id="watch1">🎬 Watch one match</button><span class="spacer"></span><button class="btn sm" id="rerun">↻ Re-run</button></div>
    </div>
    <div class="card"><h3>🎯 Most likely scores</h3>
      <div class="top5">${r.top.map(s=>`<div><b>${s.h}-${s.a}</b><span>${pct1(s.p)} · ${odds(s.p)}</span></div>`).join("")}</div>
      <h3 style="margin-top:14px">Scoreline grid <span class="sub">% · rows ${esc(h.short)} goals, columns ${esc(a.short)}</span></h3><div class="heat">${heat}</div></div>
    <div class="card"><h3>📈 Markets <span class="sub">model probability · fair odds</span></h3>
      <div class="kv">
        ${[["Over 1.5",r.o15],["Under 1.5",1-r.o15],["Over 2.5",r.o25],["Under 2.5",1-r.o25],["Over 3.5",r.o35],["Under 3.5",1-r.o35],["Both teams score",r.btts],["BTTS: no",1-r.btts],
           [esc(h.short)+" clean sheet",r.csH],[esc(a.short)+" clean sheet",r.csA],[esc(h.short)+" score first",r.first.h],["No goals",r.first.none]]
          .map(([l,p])=>`<div><b>${pct(p)}</b><span>${l}</span> <small>${odds(p)}</small></div>`).join("")}
      </div></div>
    <div class="card"><h3>⚽ Anytime goalscorer</h3><div class="grid2" style="gap:10px">${sTable("home")}${sTable("away")}</div>
      <p class="xs mut">Share of simulations where the player scores at least once (includes subs who come on). Weighted by ESPN season shots, goals and position.</p></div>
    <div class="card"><h3>📋 Average match stats</h3>
      ${statRow("Goals",r.xgH,r.xgA,2)}${statRow("Shots",r.avgH.shots,r.avgA.shots)}${statRow("Shots on target",r.avgH.sot,r.avgA.sot)}${statRow("Corners",r.avgH.corners,r.avgA.corners)}${statRow("Yellow cards",r.avgH.yc,r.avgA.yc,2)}${statRow("Red cards",r.avgH.rc,r.avgA.rc,2)}
      <p class="xs mut">Shots, on-target rate and cards use each squad's ESPN season totals when available; corners use a league-typical rate scaled by shot volume and width (ESPN feeds used here have no per-team corner data).</p></div>
    <div class="card span2"><h3>🔎 Why these numbers</h3><div class="why">
      <div><b>1. Season data</b> (goals for/against per game, home/away split, shrunk to league average, last-5 form ${ch(info.form.h)} / ${ch(info.form.a)}): expected goals <b>${info.base.lh.toFixed(2)} – ${info.base.la.toFixed(2)}</b>${info.useHome?" with home advantage":" at neutral rates"}.</div>
      <div><b>2. Line-ups</b> vs usual starters: ${esc(h.short)} attack ${ch(info.H.str.pAtt*info.H.str.shapeAtt)}, concede ${ch(info.H.str.pDef*info.H.str.shapeDef)}; ${esc(a.short)} attack ${ch(info.A.str.pAtt*info.A.str.shapeAtt)}, concede ${ch(info.A.str.pDef*info.A.str.shapeDef)} → <b>${info.afterLineup.lh.toFixed(2)} – ${info.afterLineup.la.toFixed(2)}</b>.</div>
      <div><b>3. Tactics</b>: ${esc(h.short)} ${ch(info.tac.h)}, ${esc(a.short)} ${ch(info.tac.a)} → <b>${info.H.lam.toFixed(2)} – ${info.A.lam.toFixed(2)}</b> per 90 minutes.</div>
      <div><b>4. Engine</b>: ~${info.H.shots.toFixed(1)} vs ${info.A.shots.toFixed(1)} shots per match simulated minute by minute with game state, cards, injuries and subs; calibrated so averages match step 3.</div>
      ${!h.statsKnown||!a.statsKnown?`<div class="badge warn" style="margin-top:6px">Player season stats unavailable for ${[h,a].filter(t=>!t.statsKnown).map(t=>esc(t.short)).join(" & ")}: line-up and scorer weights fall back to positions.</div>`:""}
      ${CTX.quick&&CTX.leagues[0]!==CTX.leagues[1]?`<div class="badge warn" style="margin-top:6px">Cross-league match: ratings scaled by an approximate league-strength coefficient (assumption, not data).</div>`:""}
    </div></div>
  </div>`;
  $("#saveCmp").onclick=saveCompare; $("#shareImg").onclick=shareCard; $("#copySum").onclick=()=>copyText(summaryText(),"Summary copied");
  $("#watch1").onclick=()=>{ setView("live",{autoplay:1}); WATCH.start(); }; $("#rerun").onclick=()=>runSims(RESULT.n||10000,"results");
}
function summaryText(){
  const r=RESULT.sum, h=CTX.home, a=CTX.away;
  const when=CTX.ev?`${LEAGUE[CTX.league].short}, ${fmtDay(CTX.ev.date)} ${fmtTime(CTX.ev.date)}`:"Quick match";
  const sc=r.scorers.slice(0,4).map(s=>{ const x=nameById(s.id); return x?`${lastName(x.p)} ${pct(s.p)}`:null; }).filter(Boolean).join(", ");
  return `Kickoff Lab · ${h.name} vs ${a.name} (${when})
${RESULT.n.toLocaleString()} simulations${CTX.live&&CTX.liveMode==="now"?` from ${CTX.live.detail} (${CTX.live.score.join("-")})`:""}: ${h.short} ${pct(r.H)} · Draw ${pct(r.D)} · ${a.short} ${pct(r.A)}
Expected goals ${r.xgH.toFixed(2)}–${r.xgA.toFixed(2)} · Most likely: ${r.top.slice(0,3).map(s=>`${s.h}-${s.a} (${pct1(s.p)})`).join(", ")}
Over 2.5: ${pct(r.o25)} · BTTS: ${pct(r.btts)} · Clean sheet ${h.short} ${pct(r.csH)} / ${a.short} ${pct(r.csA)}
Anytime scorers: ${sc}
Model fair odds: ${odds(r.H)} / ${odds(r.D)} / ${odds(r.A)}
${h.short}: ${configLabel(h)}${h.captainId?` · capt. ${lastName(h.squad.find(p=>p.id===h.captainId))}`:""}
${a.short}: ${configLabel(a)}${a.captainId?` · capt. ${lastName(a.squad.find(p=>p.id===a.captainId))}`:""}
Simulations are estimates, not guarantees.
${location.href.split("#")[0]+ctxHash("results",{autorun:1,mode:CTX.live?CTX.liveMode:null})}`;
}
async function copyText(txt,msg){
  try{ await navigator.clipboard.writeText(txt); toast(msg||"Copied"); }
  catch(e){ const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast(msg||"Copied"); }catch(_){ toast("Copy failed"); } ta.remove(); }
}

// ======================================================================= compare
function saveCompare(){
  const list=LS.get("compare",[]); const r=RESULT.sum, h=CTX.home, a=CTX.away;
  const sc=t=>{ const ids=new Set(t.squad.map(p=>p.id)); return r.scorers.filter(s=>ids.has(s.id)).slice(0,2).map(s=>({n:lastName(t.squad.find(p=>p.id===s.id)),p:s.p})); };
  const side=t=>({name:t.name,short:t.short,logo:t.logo,formation:t.formation,tactics:Object.assign({},t.tactics),captain:t.captainId?lastName(t.squad.find(p=>p.id===t.captainId)):null,
    xi:t.xi.map(x=>lastName(x.player)),edited:t.edited,source:t.source.type});
  list.unshift({id:Date.now(),at:new Date().toISOString(),hash:ctxHash("results",{autorun:1,mode:CTX.live?CTX.liveMode:null}),fixture:`${h.short} vs ${a.short}`,n:RESULT.n,homeAdv:CTX.homeAdv,live:CTX.live&&CTX.liveMode==="now"?CTX.live.detail+" "+CTX.live.score.join("-"):null,
    home:side(h),away:side(a),r:{H:r.H,D:r.D,A:r.A,xgH:r.xgH,xgA:r.xgA,top:r.top.slice(0,3),o25:r.o25,btts:r.btts,csH:r.csH,csA:r.csA,sh:sc(h),sa:sc(a)}});
  LS.set("compare",list.slice(0,8)); updCmpCount(); toast(`Saved to compare (${Math.min(list.length,8)})`);
}
function renderCompare(){
  const list=LS.get("compare",[]);
  if(!list.length){ $("#view").innerHTML=`<div class="card fade" style="text-align:center;padding:30px"><div style="font-size:2.4rem">⚖️</div><h3 style="justify-content:center">Nothing to compare yet</h3><p class="mut sm">Run a simulation, then tap “Save to compare”. Try the same fixture with different line-ups or tactics and compare side by side.</p><button class="btn pri" onclick="location.hash=''">Browse fixtures</button></div>`; return; }
  const best=(k,dir)=>{ const vals=list.map(x=>x.r[k]); return dir>0?Math.max(...vals):Math.min(...vals); };
  const tc=t=>`${t.formation}<br><span class="xs mut">${t.tactics.mentality} · ${t.tactics.pressing} press · ${t.tactics.tempo} · ${t.tactics.width}${t.captain?` · C: ${esc(t.captain)}`:""}${t.edited?" · edited XI":""}</span>`;
  const row=(lbl,f,k)=>`<tr><th>${lbl}</th>${list.map(x=>`<td class="n" ${k&&x.r[k]===best(k,1)&&list.length>1?'style="color:#86efac;font-weight:800"':""}>${f(x)}</td>`).join("")}</tr>`;
  $("#view").innerHTML=`<div class="card fade"><div class="row"><h3 style="margin:0">⚖️ Compare simulations <span class="sub">${list.length} saved on this device</span></h3><span class="spacer"></span><button class="btn sm" id="cmpClear">Clear all</button></div>
   <div class="cmp" style="margin-top:10px"><table class="t">
    <tr><th></th>${list.map((x,i)=>`<td class="n"><b>${esc(x.fixture)}</b><br><span class="xs mut">${new Date(x.at).toLocaleString("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} ET${x.live?" · from "+esc(x.live):""}</span><br><button class="btn sm" data-open="${esc(x.hash)}">Open</button> <button class="btn sm" data-del="${i}">✕</button></td>`).join("")}</tr>
    ${row("Home set-up",x=>tc(x.home))}${row("Away set-up",x=>tc(x.away))}${row("Home advantage",x=>x.homeAdv?"On":"Off")}
    ${row("Home win",x=>`<b>${pct(x.r.H)}</b>`,"H")}${row("Draw",x=>pct(x.r.D),"D")}${row("Away win",x=>`<b>${pct(x.r.A)}</b>`,"A")}
    ${row("Expected goals",x=>`${x.r.xgH.toFixed(2)} – ${x.r.xgA.toFixed(2)}`)}${row("Top scores",x=>x.r.top.map(s=>`${s.h}-${s.a} ${pct1(s.p)}`).join("<br>"))}
    ${row("Over 2.5",x=>pct(x.r.o25),"o25")}${row("BTTS",x=>pct(x.r.btts),"btts")}${row("Clean sheet H / A",x=>`${pct(x.r.csH)} / ${pct(x.r.csA)}`)}
    ${row("Top scorers",x=>[...x.r.sh,...x.r.sa].map(s=>`${esc(s.n)} ${pct(s.p)}`).join("<br>"))}${row("Simulations",x=>x.n.toLocaleString())}
   </table></div><p class="xs mut">Green marks the highest value in each probability row.</p></div>`;
  $("#cmpClear").onclick=()=>{ LS.set("compare",[]); updCmpCount(); renderCompare(); };
  $$("[data-del]").forEach(b=>b.onclick=()=>{ const l=LS.get("compare",[]); l.splice(Number(b.dataset.del),1); LS.set("compare",l); updCmpCount(); renderCompare(); });
  $$("[data-open]").forEach(b=>b.onclick=()=>go(b.dataset.open));
}

// ======================================================================= share card (canvas)
function loadImg(src){ return new Promise(res=>{ if(!src) return res(null); const i=new Image(); i.crossOrigin="anonymous"; i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; }); }
async function drawCard(){
  const W=1080,H=1350, cv=document.createElement("canvas"); cv.width=W; cv.height=H; const g=cv.getContext("2d");
  const r=RESULT.sum, h=CTX.home, a=CTX.away;
  const bg=g.createLinearGradient(0,0,W,H); bg.addColorStop(0,"#1e1b4b"); bg.addColorStop(0.55,"#0f172a"); bg.addColorStop(1,"#042f2e"); g.fillStyle=bg; g.fillRect(0,0,W,H);
  g.globalAlpha=0.07; g.strokeStyle="#fff"; g.lineWidth=4; g.beginPath(); g.arc(W/2,520,230,0,Math.PI*2); g.stroke(); g.globalAlpha=1;
  const F=(s,w)=>`${w||700} ${s}px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif`;
  g.textAlign="center"; g.fillStyle="#a78bfa"; g.font=F(30,800); g.fillText("⚽ KICKOFF LAB",W/2,80);
  g.fillStyle="#9aa3cf"; g.font=F(26,500);
  g.fillText(CTX.ev?`${LEAGUE[CTX.league].short} · ${fmtDay(CTX.ev.date)} · ${fmtTime(CTX.ev.date)}`:"Quick match",W/2,124);
  const [lh,la]=await Promise.all([loadImg(h.logo),loadImg(a.logo)]);
  const drawTeam=(img,t,x)=>{ if(img) g.drawImage(img,x-80,170,160,160); else { g.fillStyle=t.color; g.beginPath(); g.arc(x,250,80,0,7); g.fill(); g.fillStyle=textOn(t.color); g.font=F(48,900); g.fillText(t.abbr||"",x,268); }
    g.fillStyle="#fff"; g.font=F(t.name.length>18?32:38,800); g.fillText(t.name,x,385); };
  drawTeam(lh,h,250); drawTeam(la,a,W-250);
  g.fillStyle="#fff"; g.font=F(44,900); g.fillText("vs",W/2,265);
  const top=r.top[0]; g.fillStyle="#9aa3cf"; g.font=F(24,500); g.fillText("most likely",W/2,305); g.fillStyle="#fff"; g.font=F(56,900); g.fillText(`${top.h}-${top.a}`,W/2,365);
  // probabilities
  const cols=[["#2dd4bf",r.H,h.short+" win"],["#94a3b8",r.D,"Draw"],["#a78bfa",r.A,a.short+" win"]];
  cols.forEach(([c,p,l],i)=>{ const x=W/2+(i-1)*320; g.fillStyle="rgba(255,255,255,.06)"; rr(g,x-145,440,290,150,24); g.fill(); g.fillStyle=c; g.font=F(76,900); g.fillText(pct(p),x,535); g.fillStyle="#9aa3cf"; g.font=F(26,600); g.fillText(l,x,572); });
  let bx=80; const bw=W-160; cols.forEach(([c,p])=>{ g.fillStyle=c; g.fillRect(bx,620,bw*p,18); bx+=bw*p; });
  g.fillStyle="#cbd5e1"; g.font=F(28,600);
  g.fillText(`Expected goals ${r.xgH.toFixed(2)} – ${r.xgA.toFixed(2)}   ·   Over 2.5 ${pct(r.o25)}   ·   BTTS ${pct(r.btts)}`,W/2,690);
  g.textAlign="left"; g.fillStyle="#fff"; g.font=F(32,800); g.fillText("Top scorelines",80,770);
  r.top.forEach((s,i)=>{ const y=820+i*52; g.fillStyle="rgba(255,255,255,.06)"; rr(g,80,y-36,430,46,12); g.fill(); g.fillStyle="#8b5cf6"; rr(g,80,y-36,430*Math.min(1,s.p/r.top[0].p),46,12); g.globalAlpha=.35; g.fill(); g.globalAlpha=1;
    g.fillStyle="#fff"; g.font=F(28,800); g.fillText(`${s.h}-${s.a}`,100,y-4); g.font=F(26,600); g.textAlign="right"; g.fillText(pct1(s.p),495,y-4); g.textAlign="left"; });
  g.fillStyle="#fff"; g.font=F(32,800); g.fillText("Anytime scorers",570,770);
  const sc=r.scorers.slice(0,5).map(s=>({s,x:nameById(s.id)})).filter(o=>o.x&&!o.x.p.anon);
  sc.forEach(({s,x},i)=>{ const y=820+i*52; g.fillStyle=x.t===h?"#2dd4bf":"#a78bfa"; g.beginPath(); g.arc(585,y-14,8,0,7); g.fill(); g.fillStyle="#fff"; g.font=F(28,700); g.fillText(lastName(x.p),605,y-4); g.textAlign="right"; g.font=F(26,600); g.fillText(pct(s.p),1000,y-4); g.textAlign="left"; });
  g.fillStyle="#9aa3cf"; g.font=F(24,500);
  g.fillText(`${h.short}: ${configLabel(h)}`,80,1130); g.fillText(`${a.short}: ${configLabel(a)}`,80,1168);
  g.fillText(`Model fair odds ${odds(r.H)} / ${odds(r.D)} / ${odds(r.A)}  ·  ${RESULT.n.toLocaleString()} simulations${CTX.live&&CTX.liveMode==="now"?" from "+CTX.live.detail:""}`,80,1206);
  g.textAlign="center"; g.fillStyle="#64748b"; g.font=F(22,500); g.fillText("Simulations are estimates, not guarantees. Data: ESPN public feeds. No betting links.",W/2,1300);
  return cv;
}
function rr(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
async function shareCard(){
  const cv=await drawCard(); let url;
  try{ url=cv.toDataURL("image/png"); }catch(e){ return toast("Could not export image"); }
  const fname=`kickoff-lab-${(CTX.home.abbr||"home")}-${(CTX.away.abbr||"away")}.png`.toLowerCase();
  const m=document.createElement("div"); m.className="modal"; m.innerHTML=`<div class="box"><img src="${url}" alt="Result card"><div class="row" style="margin-top:10px">
    <a class="btn pri" href="${url}" download="${fname}" style="text-decoration:none">⬇ Download PNG</a><button class="btn" id="nshare" ${navigator.canShare?"":"hidden"}>Share…</button><span class="spacer"></span><button class="btn" id="mclose">Close</button></div></div>`;
  document.body.appendChild(m); m.onclick=e=>{ if(e.target===m) m.remove(); }; m.querySelector("#mclose").onclick=()=>m.remove();
  m.querySelector("#nshare").onclick=()=>cv.toBlob(async b=>{ const f=new File([b],fname,{type:"image/png"}); try{ if(navigator.canShare({files:[f]})) await navigator.share({files:[f],title:"Kickoff Lab simulation"}); }catch(e){} });
}

// ======================================================================= watch one match
const SPEEDS={1:0.5,5:2.5,20:10}; // match minutes per real second
const WATCH={res:null,min:0,speed:5,playing:false,timer:null,shown:0,ctxKey:null,
  start(){ const match=engineMatch(CTX); const prep=E.prepare(match);
    if(RESULT&&RESULT.info&&RESULT.cfg.home===configLabel(CTX.home)&&RESULT.cfg.away===configLabel(CTX.away)&&RESULT.info.calibS){ prep.calib=RESULT.info.calib; prep.calibS=RESULT.info.calibS; } else E.calibrate(prep,1500,99);
    this.res=E.simulateOne(prep,E.mulberry32((Math.random()*1e9)|0),true); this.prep=prep; this.ctxKey=CTX.key;
    this.min=this.res.events[0].tm; this.shown=0; this.end=this.res.events[this.res.events.length-1].tm; this.playing=true;
    const p=parseHash(); if(p.speed&&SPEEDS[p.speed]) this.speed=Number(p.speed); if(p.at) this.min=Math.min(Number(p.at)>45?Number(p.at)+this.res.stoppage[0]:Number(p.at),this.end);
    if(ROUTE.view==="live") renderWatch(); this.loop(); },
  loop(){ clearInterval(this.timer); this.timer=setInterval(()=>{ if(!this.playing) return; this.min=Math.min(this.end,this.min+SPEEDS[this.speed]/10); this.update(); if(this.min>=this.end){ this.playing=false; this.update(); clearInterval(this.timer); } },100); },
  pause(){ this.playing=false; }, stop(){ this.playing=false; clearInterval(this.timer); this.res=null; },
  update(){ if(ROUTE.view==="live"&&$("#wclock")) paintWatch(); }
};
function renderWatch(){
  const v=$("#mview"); const h=CTX.home,a=CTX.away;
  if(!WATCH.res||WATCH.ctxKey!==CTX.key){ v.innerHTML=`<div class="card fade" style="text-align:center;padding:28px"><div style="font-size:2.4rem">🎬</div><h3 style="justify-content:center">Watch one simulated match</h3>
     <p class="mut sm">Plays back a single run of the engine with your line-ups and tactics: running clock, live commentary, stats and player ratings.</p><button class="btn pri" id="wgo">▶ Kick off</button></div>`;
    $("#wgo").onclick=()=>WATCH.start(); if(parseHash().autoplay==="1") WATCH.start(); return; }
  const lg=t=>t.logo?`<img class="tlogo" style="width:34px;height:34px" src="${esc(t.logo)}" alt="">`:"";
  v.innerHTML=`<div class="grid2 fade">
    <div class="span2">
      <div class="sb"><div class="nm">${lg(h)}<div>${esc(h.short)}</div></div><div><div class="scr" id="wscore">0 - 0</div><div class="clk" id="wclock">0'</div></div><div class="nm">${lg(a)}<div>${esc(a.short)}</div></div></div>
      <div class="mini" id="mini"><div class="ln" style="position:absolute;left:50%;top:0;bottom:0;border-left:2px solid rgba(255,255,255,.35)"></div>
        <div style="position:absolute;left:50%;top:50%;width:70px;height:70px;border:2px solid rgba(255,255,255,.35);border-radius:50%;transform:translate(-50%,-50%)"></div>
        <div style="position:absolute;left:0;top:28%;bottom:28%;width:12%;border:2px solid rgba(255,255,255,.35);border-left:0"></div><div style="position:absolute;right:0;top:28%;bottom:28%;width:12%;border:2px solid rgba(255,255,255,.35);border-right:0"></div>
        <div class="ball" id="ball" style="left:50%;top:50%"></div><div class="flash" id="flash"></div></div>
      <div class="row"><button class="btn sm" id="wplay">⏸ Pause</button>${[1,5,20].map(s=>`<button class="btn sm ${WATCH.speed===s?"pri":""}" data-sp="${s}">${s}x</button>`).join("")}
        <span class="spacer"></span><button class="btn sm" id="wskip">⏭ Full-time</button><button class="btn sm" id="wnew">🎲 New match</button></div>
      <p class="xs mut" style="margin:6px 0 0">1x ≈ 3 min per match · 5x ≈ 40 s · 20x ≈ 10 s. This is one random outcome; see Results for the 10,000-run probabilities.</p>
    </div>
    <div class="card"><h3>🎙️ Commentary</h3><div class="feed" id="feed"></div></div>
    <div><div class="card"><h3>📋 Stats</h3><div id="wstats"></div></div><div class="card"><h3>⭐ Player ratings <span class="sub" id="rnote"></span></h3><div id="wrat" class="grid2" style="gap:10px"></div></div></div>
  </div>`;
  $("#wplay").onclick=()=>{ if(WATCH.min>=WATCH.end) return WATCH.start(); WATCH.playing=!WATCH.playing; if(WATCH.playing) WATCH.loop(); paintWatch(); };
  $$("[data-sp]").forEach(b=>b.onclick=()=>{ WATCH.speed=Number(b.dataset.sp); $$("[data-sp]").forEach(x=>x.classList.toggle("pri",x===b)); });
  $("#wskip").onclick=()=>{ WATCH.min=WATCH.end; WATCH.playing=false; paintWatch(); };
  $("#wnew").onclick=()=>WATCH.start();
  WATCH.shown=0; $("#feed").innerHTML=""; paintWatch();
  if(WATCH.playing) WATCH.loop();
}
function liveRatings(evs,min){ // running ratings from events so far (final ratings come from the engine at full-time)
  const res=WATCH.res, st={};
  const P=id=>st[id]||(st[id]={g:0,a:0,yc:0,rc:0,sv:0,sot:0});
  for(const e of evs){ if(e.type==="goal"&&!e.og){ P(e.pid).g++; if(e.assist) P(e.assist).a++; } if(e.type==="save"){ P(e.pid).sot++; if(e.gk) P(e.gk).sv++; } if(e.type==="yc") P(e.pid).yc++; if(e.type==="rc") P(e.pid).rc++; }
  const sc=evs.length?evs[evs.length-1].score:[0,0]; const out={};
  const on=[new Set(CTX.home.xi.map(x=>x.player.id)),new Set(CTX.away.xi.map(x=>x.player.id))];
  for(const e of evs) if(e.type==="sub"){ on[e.t].add(e.pin); }
  [CTX.home,CTX.away].forEach((t,i)=>{ for(const id of on[i]){ const p=t.squad.find(x=>x.id===id); if(!p) continue; const s=P(id); const conc=sc[1-i];
    let r=6.3+(min>20?(sc[i]>sc[1-i]?0.3:sc[i]<sc[1-i]?-0.3:0):0)+s.g*1.1+s.a*0.7+s.sot*0.15-s.yc*0.3-s.rc*1.6;
    if(p.pos==="G") r+=s.sv*0.3+(conc===0?0.7*min/95:-0.25*conc); else if(p.pos==="D") r+=(conc===0?0.5*min/95:-0.15*conc);
    out[id]=Math.round(Math.max(3,Math.min(10,r))*10)/10; } });
  return out;
}
function paintWatch(){
  const W=WATCH, res=W.res; if(!res||!$("#wclock")) return;
  const m=W.min; const evs=res.events.filter(e=>e.tm<=m); const st1=res.stoppage[0];
  const ft=m>=W.end;
  const tick=res.ticks.filter(t=>t.tm<=Math.floor(m)).pop();
  const score=evs.length?evs[evs.length-1].score:[0,0];
  $("#wscore").textContent=`${score[0]} - ${score[1]}`;
  const mm=Math.floor(m), ss=Math.floor((m-mm)*60);
  const g2=mm-st1; // game minute in the 2nd half
  $("#wclock").textContent=ft?"FT":mm<45?`${mm}:${String(ss).padStart(2,"0")}`:mm<=45+st1?(evs.some(e=>e.type==="ht")?"HT":`45+${mm-45+1}'`):g2>=90?`90+${g2-90+1}'`:`${g2}:${String(ss).padStart(2,"0")}`;
  $("#wplay").textContent=ft?"↻ Replay":W.playing?"⏸ Pause":"▶ Play";
  const feed=$("#feed");
  if(W.shown>evs.length){ feed.innerHTML=""; W.shown=0; }
  const icon={goal:"⚽",save:"🧤",miss:"↗️",corner:"🚩",yc:"🟨",rc:"🟥",sub:"🔁",inj:"🚑",ht:"⏸",ft:"🏁",ko:"▶️"};
  for(let i=W.shown;i<evs.length;i++){ const e=evs[i]; const d=document.createElement("div"); d.className="ev "+e.type;
    const tm=e.t===0?CTX.home.abbr:e.t===1?CTX.away.abbr:""; const ml=e.h===1&&e.m>45?`45+${e.m-45}`:e.h===2&&e.m>90?`90+${e.m-90}`:e.m; d.innerHTML=`<span class="m">${ml}'</span><span>${icon[e.type]||"•"}</span><span>${tm?`<b class="xs" style="color:${e.t===0?"var(--home)":"var(--away)"}">${esc(tm)}</b> `:""}${esc(e.text)}</span>`; feed.prepend(d);
    if(e.type==="goal"&&i>=W.shown&&W.shown>0||e.type==="goal"&&W.playing){ const f=$("#flash"); f.textContent="GOAL!"; f.classList.add("on"); setTimeout(()=>f.classList.remove("on"),1200); } }
  W.shown=evs.length;
  // ball: drift toward the side that had the latest action
  const last=evs.filter(e=>e.t>=0).pop(); const b=$("#ball");
  if(b){ const dir=last?(last.t===0?1:-1):0; const intensity=last&&m-last.tm<3?(last.type==="goal"?0.45:0.3):0.12*Math.sin(m*1.7);
    b.style.left=(50+dir*intensity*100+Math.sin(m*3.1)*8)+"%"; b.style.top=(50+Math.cos(m*2.3)*28)+"%"; }
  const st=tick?tick.st:[{shots:0,sot:0,corners:0,yc:0,rc:0,saves:0},{shots:0,sot:0,corners:0,yc:0,rc:0,saves:0}];
  const lh=W.prep.H.lam, la=W.prep.A.lam; const poss=Math.round(Math.max(32,Math.min(68,50+22*(lh-la)/(lh+la))));
  const row=(l,x,y)=>{ const t=x+y||1; return `<div class="cmpstat"><div class="lbl">${l}</div><b>${x}</b><div class="b"><div style="width:${x/t*100}%;background:var(--home)"></div><div style="width:${y/t*100}%;background:var(--away)"></div></div><b style="text-align:right">${y}</b></div>`; };
  $("#wstats").innerHTML=row("Possession % (model estimate)",poss,100-poss)+row("Shots",st[0].shots,st[1].shots)+row("On target",st[0].sot,st[1].sot)+row("Corners",st[0].corners,st[1].corners)+row("Saves",st[0].saves,st[1].saves)+row("Yellow cards",st[0].yc,st[1].yc)+row("Red cards",st[0].rc,st[1].rc);
  const rat=ft?res.ratings:liveRatings(evs,m);
  $("#rnote").textContent=ft?"full-time":"live";
  const motm=ft?Object.entries(rat).sort((x,y)=>y[1]-x[1])[0]:null;
  $("#wrat").innerHTML=[CTX.home,CTX.away].map((t,i)=>{ const rows=Object.entries(rat).map(([id,r])=>({p:t.squad.find(x=>x.id===id),r})).filter(x=>x.p).sort((x,y)=>y.r-x.r).slice(0,11);
    return `<table class="t"><tr><th>${esc(t.short)}</th><th class="n">Rating</th></tr>${rows.map(x=>`<tr><td>${esc(lastName(x.p))}${t.captainId===x.p.id?" ©":""}${motm&&motm[0]===x.p.id?" ⭐":""}</td><td class="n"><b style="color:${x.r>=7.5?"#86efac":x.r<6?"#fca5a5":"var(--txt)"}">${x.r.toFixed(1)}</b></td></tr>`).join("")}</table>`; }).join("");
}

// ======================================================================= about
function renderAbout(){
  $("#view").innerHTML=`<div class="card fade"><h3>ℹ️ How Kickoff Lab works</h3><div class="why" style="font-size:.88rem">
  <p><b>Data.</b> Fixtures, results and standings come live from ESPN's public scoreboard/standings feeds for the Premier League, Championship, LaLiga, Serie A, Bundesliga, Ligue 1, MLS and the Champions League. Opening a match loads ESPN's match summary: when line-ups are announced you get the <b>official XI, formation and bench</b>. Otherwise a <b>probable XI</b> is built from the team's most recent match line-up (swapping out anyone injured or no longer in the squad), or from season starts per position. Player season stats (appearances, starts, goals, assists, shots, cards) come from ESPN's squad roster feed. If live fetching fails, an offline snapshot (data.js, refreshed with update.py) is used and labelled.</p>
  <p><b>Team strength.</b> Each team gets attack and defence ratings from goals scored/conceded per game this season, split home/away and shrunk toward the league average (4 pseudo-games), plus a ±8% last-5 form nudge (same model as the AI Predictor). Champions League ratings blend in domestic form. Cross-league quick matches use an approximate league-strength coefficient (an assumption).</p>
  <p><b>Line-ups.</b> Your XI is compared with the team's usual starters (most starts this season). Players are valued by how often they start and by goal involvement per appearance, weighted by position; benching key players lowers attack/defence, and out-of-position players (marked !) are penalised. Formation shape adds a small attack/defence trade-off. The captain is shown on the pitch, card and ratings; it has no modelled effect (there's no reliable data for one).</p>
  <p><b>Tactics.</b> ${Object.entries(TAC_HELP).map(([k,v])=>`<i style="text-transform:capitalize">${k}</i>: ${v}`).join(" ")} Home advantage on/off switches between home/away and neutral scoring rates.</p>
  <p><b>Engine.</b> Every match is played minute by minute (with random stoppage time). Each minute each team may shoot; the rate comes from its ESPN shot volume scaled to the expected goals, and rises late in games, for trailing teams and with a man advantage. Shots can go on target (team on-target rate) and in; shooters and scorers are chosen by season shots, goals and position. The engine also simulates corners, yellow/second-yellow/red cards, injuries and up to 5 subs in 3 windows (bench players picked by position and appearances, changing team strength). A 2,500-match pilot calibrates shot volume and conversion so averages match the model. 10,000 matches run in a Web Worker in about a second.</p>
  <p><b>Limitations.</b> Season samples are small early on; ESPN player stats may be missing for some squads (the app says so); corners use league-typical rates; there's no data on injuries beyond ESPN's roster flags, set-piece specialists, weather or motivation. Simulations are estimates, not guarantees.</p></div></div>`;
}

// ======================================================================= init
updCmpCount();
route();
})();
