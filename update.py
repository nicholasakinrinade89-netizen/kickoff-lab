#!/usr/bin/env python3
"""Kickoff Lab offline snapshot. Writes data.js (window.SNAPSHOT) used by index.html only when live
ESPN fetches fail. Snapshots: fixtures/results + standings for every league, squad rosters with
season stats for every team, and match summaries (line-ups) for upcoming fixtures plus each
involved team's most recent match (for probable XIs).  Usage:  python3 update.py
Public ESPN JSON only (no API key). Shapes mirror js/espn.js trim* functions."""
import json, os, sys, gzip, datetime, urllib.request
from concurrent.futures import ThreadPoolExecutor

LEAGUES = ["eng.1", "eng.2", "esp.1", "ita.1", "ger.1", "fra.1", "usa.1", "uefa.champions"]
DOMESTIC = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "eng.2", "usa.1"]
B = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
SB = B + "{l}/scoreboard?dates={y}&limit=1000"
ST = "https://site.api.espn.com/apis/v2/sports/soccer/{l}/standings"
SUM = B + "{l}/summary?event={e}"
ROS = B + "{l}/teams/{t}/roster"
HERE = os.path.dirname(os.path.abspath(__file__))
STAT_MAP = {"appearances": "apps", "subIns": "subIns", "totalGoals": "goals", "goalAssists": "assists", "totalShots": "shots",
            "shotsOnTarget": "sot", "yellowCards": "yc", "redCards": "rc", "foulsCommitted": "fouls", "saves": "saves", "goalsConceded": "conceded"}

def get(url, tries=3):
    for i in range(tries):
        try: return _get(url)
        except Exception:
            if i == tries - 1: raise

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
    return json.loads(data)

def num(x):
    try: return float(x)
    except Exception: return None

def trim_event(e):
    c = e["competitions"][0]; st = e.get("status", {}); ty = st.get("type", {})
    return {"id": e["id"], "date": e["date"], "name": e.get("name"), "season": {"year": e.get("season", {}).get("year")},
            "status": {"type": {"state": ty.get("state"), "completed": ty.get("completed"), "name": ty.get("name"), "detail": ty.get("shortDetail")},
                       "displayClock": st.get("displayClock"), "period": st.get("period")},
            "competitions": [{"neutralSite": c.get("neutralSite"), "venue": {"fullName": (c.get("venue") or {}).get("fullName")},
                "competitors": [{"homeAway": t["homeAway"], "score": t.get("score"), "form": t.get("form"),
                    "team": {k: t["team"].get(k) for k in ("id", "displayName", "shortDisplayName", "abbreviation", "logo", "color", "alternateColor")}}
                    for t in c["competitors"]]}]}

def trim_standings(s):
    keep = {"rank", "points", "gamesPlayed", "wins", "ties", "losses", "pointsFor", "pointsAgainst"}
    return {"children": [{"name": ch.get("name"), "standings": {"entries": [
        {"team": {"id": en["team"]["id"], "displayName": en["team"].get("displayName"), "abbreviation": en["team"].get("abbreviation"),
                  "logo": ((en["team"].get("logos") or [{}])[0]).get("href")},
         "stats": [{"name": x.get("name"), "value": x.get("value"), "displayValue": x.get("displayValue")} for x in en.get("stats", []) if x.get("name") in keep]}
        for en in ch["standings"]["entries"]]}} for ch in s.get("children", [])]}

def trim_athlete(a):
    stats = None
    cats = ((a.get("statistics") or {}).get("splits") or {}).get("categories") or []
    if cats:
        stats = {}
        for c in cats:
            for s in c.get("stats", []):
                if s.get("name") in STAT_MAP: stats[STAT_MAP[s["name"]]] = num(s.get("value")) or 0
        stats = stats or None
    inj = [i for i in (a.get("injuries") or []) if i]
    return {"id": str(a["id"]), "name": a.get("displayName") or a.get("fullName"), "short": a.get("shortName") or a.get("displayName"),
            "jersey": a.get("jersey") or "", "pos": (a.get("position") or {}).get("abbreviation") or "M", "age": a.get("age"),
            "inj": (inj[0].get("status") or inj[0].get("type") or "injured") if inj else None, "stats": stats}

def didsub(x):
    return bool(x.get("didSub")) if isinstance(x, dict) else bool(x)

def trim_summary(d):
    comp = ((d.get("header") or {}).get("competitions") or [{}])[0]
    box = (d.get("boxscore") or {}).get("teams") or []
    def reds(tid):
        for b in box:
            if str(b["team"]["id"]) == str(tid):
                for s in b.get("statistics", []):
                    if s.get("name") == "redCards": return int(num(s.get("displayValue")) or 0)
        return 0
    st = comp.get("status")
    comps = sorted(comp.get("competitors", []), key=lambda c: 0 if c.get("homeAway") == "home" else 1)
    return {"id": str(comp.get("id") or ""),
            "status": {"state": st["type"]["state"], "detail": st["type"].get("shortDetail") or st["type"].get("detail"), "clock": st.get("displayClock"), "period": st.get("period")} if st else None,
            "score": [num(c.get("score")) for c in comps],
            "rosters": [{"teamId": str(r["team"]["id"]), "homeAway": r.get("homeAway"), "formation": r.get("formation"), "reds": reds(r["team"]["id"]),
                         "players": [{"id": str(p["athlete"]["id"]), "name": p["athlete"].get("displayName"), "short": p["athlete"].get("shortName") or p["athlete"].get("displayName"),
                                      "jersey": p.get("jersey") or p["athlete"].get("jersey") or "", "pos": (p.get("position") or {}).get("abbreviation") or "",
                                      "starter": bool(p.get("starter")), "place": int(num(p.get("formationPlace")) or 0),
                                      "subIn": didsub(p.get("subbedIn")), "subOut": didsub(p.get("subbedOut"))}
                                     for p in r.get("roster", [])]} for r in d.get("rosters", [])]}

def pmap(fn, items, workers=12):
    with ThreadPoolExecutor(workers) as ex: return list(ex.map(fn, items))

def safe(fn):
    def w(x):
        try: return fn(x)
        except Exception as ex:
            print(f"  failed {x}: {ex}", file=sys.stderr); return None
    return w

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    end = now + datetime.timedelta(days=9)
    snap = {"fetchedAt": now.isoformat().replace("+00:00", "Z"), "leagues": {}, "rosters": {}, "summaries": {}}
    def league(l):
        first = get(SB.format(l=l, y=now.year))
        season_year = first["leagues"][0]["season"]["year"]
        events = list(first.get("events", []))
        if season_year < now.year: events += get(SB.format(l=l, y=now.year - 1)).get("events", [])
        if end.year != now.year: events += get(SB.format(l=l, y=end.year)).get("events", [])
        keep = [trim_event(e) for e in events if e.get("season", {}).get("year") == season_year or e["status"]["type"].get("state") != "post"]
        try: st = trim_standings(get(ST.format(l=l)))
        except Exception as ex: print(f"  standings failed for {l}: {ex}", file=sys.stderr); st = {"children": []}
        return l, {"name": first["leagues"][0].get("name", l), "seasonYear": season_year, "events": keep, "standings": st}
    for res in pmap(safe(league), LEAGUES, 8):
        if res: snap["leagues"][res[0]] = res[1]; print(f"{res[0]}: {len(res[1]['events'])} events (season {res[1]['seasonYear']})")
    # teams -> roster league (domestic first)
    team_league = {}
    for l in DOMESTIC + ["uefa.champions"]:
        for e in snap["leagues"].get(l, {}).get("events", []):
            for c in e["competitions"][0]["competitors"]:
                team_league.setdefault(str(c["team"]["id"]), l)
    def roster(item):
        tid, l = item
        r = get(ROS.format(l=l, t=tid))
        return f"{l}:{tid}", {"athletes": [trim_athlete(a) for a in r.get("athletes", [])]}
    for res in pmap(safe(roster), list(team_league.items())):
        if res and res[1]["athletes"]: snap["rosters"][res[0]] = res[1]
    print(f"rosters: {len(snap['rosters'])}/{len(team_league)}")
    # summaries: upcoming fixtures (line-ups when announced) + last completed match of each involved team
    wanted = {}
    nowiso, endiso = (now - datetime.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%MZ"), end.strftime("%Y-%m-%dT%H:%MZ")
    last = {}
    for l, lg in snap["leagues"].items():
        for e in lg["events"]:
            ty = e["status"]["type"]; ids = [str(c["team"]["id"]) for c in e["competitions"][0]["competitors"]]
            if ty.get("state") == "in" or (ty.get("state") == "pre" and nowiso <= e["date"] <= endiso):
                wanted[e["id"]] = l
            if ty.get("completed"):
                for t in ids:
                    if t not in last or e["date"] > last[t][0]: last[t] = (e["date"], e["id"], l)
    involved = {str(c["team"]["id"]) for l, lg in snap["leagues"].items() for e in lg["events"] if e["id"] in wanted for c in e["competitions"][0]["competitors"]}
    for t in involved:
        if t in last: wanted[last[t][1]] = last[t][2]
    def summary(item):
        eid, l = item
        return eid, trim_summary(get(SUM.format(l=l, e=eid)))
    for res in pmap(safe(summary), list(wanted.items())):
        if res: snap["summaries"][res[0]] = res[1]
    print(f"summaries: {len(snap['summaries'])}/{len(wanted)}")
    with open(os.path.join(HERE, "data.js"), "w") as f:
        f.write("// Auto-generated by update.py - offline snapshot of public ESPN data (Kickoff Lab)\n")
        f.write("window.SNAPSHOT = " + json.dumps(snap, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print("wrote data.js", snap["fetchedAt"], f"{os.path.getsize(os.path.join(HERE, 'data.js'))/1e6:.1f} MB")

if __name__ == "__main__":
    main()
