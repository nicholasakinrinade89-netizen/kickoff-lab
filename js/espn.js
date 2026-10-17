/* Kickoff Lab - ESPN data layer. Fetching (browser) + normalisation (pure, also used by Node tests).
 * The trimmed shapes produced here are identical to what update.py writes into data.js. */
(function(root){
"use strict";
const LEAGUES=[
  {code:"eng.1",short:"Premier League",abbr:"EPL",coef:1.00},
  {code:"eng.2",short:"Championship",abbr:"EFL",coef:0.72},
  {code:"esp.1",short:"LaLiga",abbr:"LIGA",coef:0.95},
  {code:"ita.1",short:"Serie A",abbr:"SA",coef:0.93},
  {code:"ger.1",short:"Bundesliga",abbr:"BUN",coef:0.93},
  {code:"fra.1",short:"Ligue 1",abbr:"L1",coef:0.88},
  {code:"usa.1",short:"MLS",abbr:"MLS",coef:0.75},
  {code:"uefa.champions",short:"Champions League",abbr:"UCL",coef:null},
];
const DOMESTIC=["eng.1","esp.1","ita.1","ger.1","fra.1","eng.2"];
const BASE="https://site.api.espn.com/apis/site/v2/sports/soccer/";
const URLS={
  scoreboard:(l,y)=>`${BASE}${l}/scoreboard?dates=${y}&limit=1000`,
  standings:l=>`https://site.api.espn.com/apis/v2/sports/soccer/${l}/standings`,
  summary:(l,id)=>`${BASE}${l}/summary?event=${id}`,
  roster:(l,tid)=>`${BASE}${l}/teams/${tid}/roster`,
};
const num=s=>s==null?null:(typeof s==="object"?Number(s.value??s.displayValue):Number(s));

function trimEvent(e){ // same shape as ai-predictor/update.py, plus clock info
  const c=e.competitions[0]; const st=e.status||{};
  return {id:e.id,date:e.date,name:e.name,season:{year:(e.season||{}).year},
    status:{type:{state:st.type&&st.type.state,completed:st.type&&st.type.completed,name:st.type&&st.type.name,detail:st.type&&st.type.shortDetail},displayClock:st.displayClock,period:st.period},
    competitions:[{neutralSite:c.neutralSite,venue:{fullName:(c.venue||{}).fullName},
      competitors:c.competitors.map(t=>({homeAway:t.homeAway,score:t.score,form:t.form,
        team:{id:t.team.id,displayName:t.team.displayName,shortDisplayName:t.team.shortDisplayName,abbreviation:t.team.abbreviation,logo:t.team.logo,color:t.team.color,alternateColor:t.team.alternateColor}}))}]};
}
function normEvent(e){
  const c=e.competitions[0];
  const h=c.competitors.find(t=>t.homeAway==="home"), a=c.competitors.find(t=>t.homeAway==="away");
  const team=t=>({id:String(t.team.id),name:t.team.displayName,short:t.team.shortDisplayName||t.team.displayName,abbr:t.team.abbreviation,logo:t.team.logo,color:t.team.color,alt:t.team.alternateColor});
  const st=e.status||{type:{}};
  return {id:String(e.id),date:new Date(e.date),season:e.season&&e.season.year,state:st.type.state,completed:st.type.completed,
    detail:st.type.detail||st.type.shortDetail,clock:st.displayClock,period:st.period,
    neutral:!!c.neutralSite,venue:c.venue&&c.venue.fullName,home:team(h),away:team(a),hs:num(h.score),as:num(a.score)};
}
function playedGames(events, seasonYear){
  return events.map(normEvent).filter(e=>e.completed&&e.season===seasonYear&&e.hs!=null&&e.as!=null&&!isNaN(e.hs))
    .map(e=>({home:e.home,away:e.away,hs:e.hs,as:e.as,date:e.date.getTime(),id:e.id}));
}
function trimStandings(s){
  return {children:(s.children||[]).map(ch=>({name:ch.name,standings:{entries:(ch.standings.entries||[]).map(en=>({team:{id:en.team.id,displayName:en.team.displayName,abbreviation:en.team.abbreviation,logo:(en.team.logos||[{}])[0].href},
    stats:(en.stats||[]).filter(x=>["rank","points","gamesPlayed","wins","ties","losses","pointsFor","pointsAgainst"].includes(x.name)).map(x=>({name:x.name,value:x.value,displayValue:x.displayValue}))}))}}))};
}
const STAT_MAP={appearances:"apps",subIns:"subIns",totalGoals:"goals",goalAssists:"assists",totalShots:"shots",shotsOnTarget:"sot",
  yellowCards:"yc",redCards:"rc",foulsCommitted:"fouls",saves:"saves",goalsConceded:"conceded"};
function trimRosterAthlete(a){
  let stats=null;
  const cats=a.statistics&&a.statistics.splits&&a.statistics.splits.categories;
  if(cats&&cats.length){ stats={}; for(const c of cats) for(const s of c.stats||[]) if(STAT_MAP[s.name]) stats[STAT_MAP[s.name]]=Number(s.value)||0; if(!Object.keys(stats).length) stats=null; }
  const inj=(a.injuries||[]).filter(Boolean);
  return {id:String(a.id),name:a.displayName||a.fullName,short:a.shortName||a.displayName,jersey:a.jersey||"",pos:(a.position&&a.position.abbreviation)||"M",
    age:a.age||null, inj:inj.length?(inj[0].status||inj[0].type||"injured"):null, stats};
}
function trimRoster(r){ return {season:r.season&&r.season.year, athletes:(r.athletes||[]).map(trimRosterAthlete)}; }
function trimSummary(d){
  const comp=d.header&&d.header.competitions&&d.header.competitions[0]||{};
  const box=(d.boxscore&&d.boxscore.teams)||[];
  const reds=t=>{ const b=box.find(x=>String(x.team.id)===String(t)); const s=b&&(b.statistics||[]).find(x=>x.name==="redCards"); return s?Number(s.displayValue)||0:0; };
  return {id:String(comp.id||(d.header&&d.header.id)||""),
    status:comp.status?{state:comp.status.type.state,detail:comp.status.type.shortDetail||comp.status.type.detail,clock:comp.status.displayClock,period:comp.status.period}:null,
    score:(comp.competitors||[]).sort((a,b)=>a.homeAway==="home"?-1:1).map(c=>num(c.score)),
    rosters:(d.rosters||[]).map(r=>({teamId:String(r.team.id),homeAway:r.homeAway,formation:r.formation||null,reds:reds(r.team.id),
      players:(r.roster||[]).map(p=>({id:String(p.athlete.id),name:p.athlete.displayName,short:p.athlete.shortName||p.athlete.displayName,jersey:p.jersey||p.athlete.jersey||"",
        pos:(p.position&&p.position.abbreviation)||"",starter:!!p.starter,place:Number(p.formationPlace)||0,
        subIn:p.subbedIn===true||!!(p.subbedIn&&p.subbedIn.didSub),subOut:p.subbedOut===true||!!(p.subbedOut&&p.subbedOut.didSub)}))}))};
}

// ---------- line-up building ----------
const GROUPS=["G","D","M","F"];
function mergePlayer(sp, rosterById){ // summary player + roster stats/natural position
  const r=rosterById[sp.id];
  const matchPos=GROUPS.includes(sp.pos)?sp.pos:null;
  return {id:sp.id,name:sp.name,short:sp.short,jersey:sp.jersey||(r&&r.jersey)||"",pos:(r&&r.pos)||matchPos||"M",
    pos2:matchPos&&r&&r.pos!==matchPos?matchPos:undefined, stats:r?r.stats:null, inj:r?r.inj:null, age:r?r.age:null};
}
// entries: [{player, place, group}] -> [{player, slot}] for formation f
function assignXI(E, formation, entries){
  const slots=E.formationSlots(formation);
  const res=new Array(slots.length).fill(null);
  const left=[...entries];
  // 1) Opta formation places when the formation is known and the mapping agrees with match positions
  if(slots[0].opta!=null && entries.every(e=>e.place)){
    let ok=true; const tmp=[];
    for(let i=0;i<slots.length;i++){ const e=entries.find(x=>x.place===slots[i].opta); if(!e){ok=false;break;} tmp[i]=e; }
    if(ok){ const bad=tmp.filter((e,i)=>e.group&&e.group!==slots[i].group && !(e.group!=="G"&&slots[i].group!=="G"&&Math.abs(GROUPS.indexOf(e.group)-GROUPS.indexOf(slots[i].group))===1)).length;
      if(bad===0) return tmp.map((e,i)=>({player:e.player,slot:slots[i]})); }
  }
  // 2) by position group, in formation-place order
  left.sort((a,b)=>(a.place||99)-(b.place||99));
  for(const g of GROUPS) for(let i=0;i<slots.length;i++){ if(res[i]||slots[i].group!==g) continue; const k=left.findIndex(e=>(e.group||e.player.pos)===g); if(k>=0) res[i]=left.splice(k,1)[0]; }
  for(let i=0;i<slots.length;i++){ if(!res[i]&&left.length){ const k=slots[i].group==="G"?0:Math.max(0,left.findIndex(e=>(e.group||e.player.pos)!=="G")); res[i]=left.splice(k,1)[0]; } }
  return res.map((e,i)=>e?{player:e.player,slot:slots[i]}:null).filter(Boolean);
}
// Official line-up from a trimmed summary roster. For live games the current XI reflects subs made.
function lineupFromSummary(E, sumRoster, rosterById, live){
  const ps=sumRoster.players; const starters=ps.filter(p=>p.starter);
  if(starters.length!==11) return null;
  const formation=sumRoster.formation&&(E.FORMATIONS[sumRoster.formation]||E.genericLines(sumRoster.formation))?sumRoster.formation:"4-3-3";
  let entries=starters.map(p=>({player:mergePlayer(p,rosterById),place:p.place,group:GROUPS.includes(p.pos)?p.pos:null}));
  let xi=assignXI(E,formation,entries);
  for(const x of xi) if(x.player.pos!==x.slot.group && !x.player.pos2 && x.slot.group!=="G" && x.player.pos!=="G") x.player.pos2=x.slot.group; // deployed there by the manager
  let bench=ps.filter(p=>!p.starter).map(p=>mergePlayer(p,rosterById));
  let subsMade=0;
  if(live){ // apply substitutions already made: sub-on takes the slot of the matching sub-off (same group if possible)
    const outs=xi.filter(x=>ps.find(p=>p.id===x.player.id&&p.subOut));
    const ins=bench.filter(b=>ps.find(p=>p.id===b.id&&p.subIn));
    for(const inn of ins){ const o=outs.find(x=>x.player.pos===inn.pos)||outs[0]; if(!o) break; outs.splice(outs.indexOf(o),1); const old=o.player; o.player=inn; bench=bench.filter(b=>b!==inn); bench.push(Object.assign({},old,{usedSub:true})); subsMade++; }
  }
  return {formation, xi, bench, subsMade};
}
// Probable XI from the team's most recent match line-up, replacing anyone no longer in the squad or injured.
function probableFromLast(E, sumRoster, roster){
  const byId=Object.fromEntries(roster.map(p=>[p.id,p]));
  const base=lineupFromSummary(E,sumRoster,byId,false); if(!base) return null;
  const used=new Set(base.xi.map(x=>x.player.id)); const changes=[];
  for(const x of base.xi){
    const r=byId[x.player.id];
    if(roster.length && (!r || r.inj)){
      const rep=roster.filter(p=>!used.has(p.id)&&!p.inj&&p.pos===x.slot.group).sort((a,b)=>E.starts(b)-E.starts(a))[0];
      if(rep){ changes.push({out:x.player.name,in:rep.name,why:!r?"no longer in squad list":"injury ("+r.inj+")"}); used.add(rep.id); x.player=rep; }
    }
  }
  const bench=benchFrom(E,roster,used);
  return {formation:base.formation, xi:base.xi, bench, changes};
}
function benchFrom(E, roster, used){
  const rest=roster.filter(p=>!used.has(p.id)&&!p.inj).sort((a,b)=>E.starts(b)-E.starts(a)||((b.stats&&b.stats.apps||0)-(a.stats&&a.stats.apps||0)));
  const gk=rest.find(p=>p.pos==="G"); const out=rest.filter(p=>p!==gk).slice(0,gk?8:9);
  return gk?[gk,...out]:out;
}
// Fallback probable XI purely from squad list + season starts.
function probableFromRoster(E, roster, formation){
  formation=formation||"4-3-3";
  const slots=E.formationSlots(formation); const avail=roster.filter(p=>!p.inj);
  const by=(a,b)=>E.starts(b)-E.starts(a)||((b.stats&&b.stats.apps||0)-(a.stats&&a.stats.apps||0));
  const used=new Set(); const xi=[];
  for(const s of slots){
    let c=avail.filter(p=>!used.has(p.id)&&p.pos===s.group).sort(by)[0] || avail.filter(p=>!used.has(p.id)&&p.pos!=="G").sort(by)[0];
    if(!c) continue; used.add(c.id); xi.push({player:c,slot:s});
  }
  return {formation, xi, bench:benchFrom(E,roster,used)};
}
function teamStatsFromRoster(roster, modelTeam){
  const gp=modelTeam?modelTeam.N:0;
  const withStats=roster.filter(p=>p.stats);
  if(!gp||!withStats.length) return {gp, gfPG:modelTeam&&gp?(modelTeam.hGF+modelTeam.aGF)/gp:null, available:false};
  const sum=k=>withStats.reduce((s,p)=>s+(p.stats[k]||0),0);
  const shots=sum("shots"), sot=sum("sot"), yc=sum("yc");
  return {gp, shotsPG:shots>0?shots/gp:null, sotPG:sot>0?sot/gp:null, ycPG:yc/gp, gfPG:(modelTeam.hGF+modelTeam.aGF+4*1.4)/(gp+4), available:shots>0}; // goals/game shrunk toward a typical 1.4
}

// ---------- fetching (browser) ----------
async function getJSON(url, ms){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), ms||15000);
  try{ const r=await fetch(url,{signal:ctl.signal}); if(!r.ok) throw new Error("HTTP "+r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}
async function loadLeagueLive(code){ // ported from ai-predictor
  const now=new Date(), end=new Date(now.getTime()+9*864e5), y=now.getUTCFullYear();
  const first=await getJSON(URLS.scoreboard(code,y));
  const seasonYear=first.leagues[0].season.year;
  let events=first.events||[]; const extra=[];
  if(seasonYear<y) extra.push(getJSON(URLS.scoreboard(code,y-1)));
  if(end.getUTCFullYear()!==y) extra.push(getJSON(URLS.scoreboard(code,end.getUTCFullYear())));
  for(const d of await Promise.all(extra)) events=events.concat(d.events||[]);
  events=events.filter(e=>(e.season||{}).year===seasonYear||e.status.type.state!=="post").map(trimEvent);
  let standings={children:[]}; try{ standings=trimStandings(await getJSON(URLS.standings(code))); }catch(e){}
  return {name:first.leagues[0].name, seasonYear, events, standings, live:true};
}
const API={LEAGUES,DOMESTIC,URLS,num,trimEvent,normEvent,playedGames,trimStandings,trimRoster,trimRosterAthlete,trimSummary,
  mergePlayer,assignXI,lineupFromSummary,probableFromLast,probableFromRoster,benchFrom,teamStatsFromRoster,getJSON,loadLeagueLive};
if(typeof module!=="undefined"&&module.exports) module.exports=API; else root.ESPN=API;
})(typeof self!=="undefined"?self:this);
