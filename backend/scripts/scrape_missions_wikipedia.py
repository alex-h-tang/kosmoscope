# python scrape_missions_wikipedia.py --csv missions_wikipedia.csv --out missions_wikipedia.csv --force --sleep 1.0
import re
import time
import argparse
import os
from urllib.parse import quote
import pandas as pd
import requests
from bs4 import BeautifulSoup

API = "https://en.wikipedia.org/w/api.php"
WIKI_BASE = "https://en.wikipedia.org/wiki/"
HEADERS = {"User-Agent": "MissionScraper/1.3.1 (research use; contact if needed)"}

def log(msg):
    print(msg, flush=True)

def is_probably_mission(title, mission):
    m = mission.strip()
    tests = []
    # STS
    if re.match(r"(?i)sts[-\s_]*\d+$", m):
        n = re.sub(r"[^0-9]", "", m); tests.append(re.compile(rf"(?i)^STS[-\s_]?{n}$"))
    # Apollo
    if re.match(r"(?i)apollo[-\s_]*\d+$", m):
        n = re.sub(r"[^0-9]", "", m); tests.append(re.compile(rf"(?i)^Apollo[-\s_]?{n}$"))
    # Gemini (allow 6A)
    if re.match(r"(?i)gemini[-\s_]*\d+[A-Za-z]?$", m):
        g = re.sub(r"(?i)^gemini[\s_-]*", "", m); tests.append(re.compile(rf"(?i)^Gemini[-\s_]?{re.escape(g)}$"))
    # Mercury-Atlas
    if re.match(r"(?i)(mercury[-\s_]*atlas|ma)[-\s_]*\d+$", m):
        n = re.sub(r"[^0-9]", "", m); tests.append(re.compile(rf"(?i)^Mercury[-\s_]?Atlas[-\s_]?{n}$"))
    # Soyuz (support 31/29 -> 31)
    if re.match(r"(?i)soyuz(\s|\-)?\d+(/\d+)?$", m):
        n = re.findall(r"\d+", m)
        if n: tests.append(re.compile(rf"(?i)^Soyuz[-\s_]?{n[0]}$"))
    # Vostok/Voskhod/Shenzhou
    for prog in ["Vostok","Voskhod","Shenzhou"]:
        if re.match(rf"(?i){prog}[-\s_]*\d+$", m):
            n = re.findall(r"\d+", m)[0]; tests.append(re.compile(rf"(?i)^{prog}[-\s_]?{n}$"))
    # Exact fallback
    tests.append(re.compile(rf"(?i)^{re.escape(m)}$"))
    title_l = title.strip()
    for rx in tests:
        if rx.search(title_l):
            return True
    return False

def try_api_search(mission):
    params = {
        "action": "query",
        "list": "search",
        "srsearch": f'intitle:"{mission}"',
        "srlimit": 10,
        "srnamespace": 0,
        "format": "json"
    }
    r = requests.get(API, params=params, headers=HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    hits = data.get("query",{}).get("search",[])
    ranked = []
    for h in hits:
        title = h.get("title","")
        score = 0
        if title.lower() == mission.lower():
            score += 100
        if is_probably_mission(title, mission):
            score += 50
        if any(bad in title.lower() for bad in ["t2","synchronous optical","list of","fictional","ulf merbold"]):
            score -= 100
        ranked.append((score, title))
    ranked.sort(reverse=True)
    return [t for s,t in ranked if s > -50]

def resolve_title(mission):
    variants = [mission, mission.replace(" ", "_")]
    if "/" in mission:
        a = mission.split("/")[0].strip()
        variants += [mission.replace("/", " "), mission.replace("/", "_"), a]
    if mission.upper().startswith("MA-"):
        n = re.sub(r"[^0-9]", "", mission)
        if n: variants += [f"Mercury-Atlas {n}", f"Mercury-Atlas_{n}"]
    if mission.upper().startswith("STS"):
        n = re.sub(r"[^0-9]", "", mission)
        if n: variants += [f"STS {n}", f"STS-{n}", f"STS_{n}"]

    for v in dict.fromkeys(variants):
        url = WIKI_BASE + quote(v)
        rr = requests.get(url, headers=HEADERS, timeout=20)
        if rr.status_code == 200 and len(rr.text) > 2000:
            soup = BeautifulSoup(rr.text, "html.parser")
            h1 = soup.find("h1")
            t = h1.get_text(" ", strip=True) if h1 else v
            if is_probably_mission(t, mission):
                return t, url, rr.text

    for t in try_api_search(mission):
        url = WIKI_BASE + quote(t.replace(" ", "_"))
        rr = requests.get(url, headers=HEADERS, timeout=20)
        if rr.status_code == 200 and len(rr.text) > 2000:
            if is_probably_mission(t, mission):
                return t, url, rr.text
    return None, None, None

# ---------- Parsing ----------
MASS_PAT = re.compile(r"\b(kg|kilogram|kilograms|lb|pounds?)\b", re.IGNORECASE)

def clean_text(s):
    if not s: return s
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def get_infobox_rows(infobox):
    """Return the <tr> rows that are *direct* children of <tbody> if present, else of the table.
    This fixes the earlier bug where rows were invisible due to <tbody> nesting."""
    body = infobox.find("tbody")
    container = body if body else infobox
    rows = container.find_all("tr", recursive=False)
    # If some pages don't use <tbody> and have nested structures, fallback to shallow scan.
    if not rows:
        rows = infobox.find_all("tr", recursive=True)[:60]
    return rows

def parse_infobox(html):
    soup = BeautifulSoup(html, "html.parser")
    infobox = soup.select_one("table.infobox")
    data = {}
    if not infobox:
        return data

    rows = get_infobox_rows(infobox)

    def cell_for(labels, exact=False):
        for tr in rows:
            th = tr.find("th")
            key = clean_text(th.get_text(" ", strip=True)).lower() if th else ""
            td = tr.find("td")
            if not td: 
                continue
            if exact:
                for lab in labels:
                    if key == lab:
                        return clean_text(td.get_text(" ", strip=True)), td
            else:
                for lab in labels:
                    if lab in key:
                        return clean_text(td.get_text(" ", strip=True)), td
        return "", None

    launch_date, _ = cell_for(["launch date"], exact=True)
    if not launch_date:
        launch_date, _ = cell_for(["launch date and time", "date and time", "launch"], exact=False)
    if MASS_PAT.search(launch_date):
        launch_date = ""

    launch_site, ltd = cell_for(["launch site"], exact=True)
    if not launch_site:
        launch_site, ltd = cell_for(["launch location", "launch base"], exact=False)

    landing_site, land_td = cell_for(["landing site"], exact=True)
    if not landing_site:
        landing_site, land_td = cell_for(["splashdown site", "recovery site", "landing"], exact=False)
    if MASS_PAT.search(landing_site):
        landing_site = ""

    duration, _ = cell_for(["mission duration"], exact=True)
    if not duration:
        duration, _ = cell_for(["duration"], exact=False)
    if MASS_PAT.search(duration):
        duration = ""

    rocket, _ = cell_for(["rocket"], exact=True)
    if not rocket:
        rocket, _ = cell_for(["launch vehicle", "carrier rocket"], exact=False)

    destination, _ = cell_for(["space station","destination"], exact=True)
    if not destination:
        destination, _ = cell_for(["docked with","space station","visited"], exact=False)

    def coords_from_td(td):
        if not td: return ""
        geo = td.select_one(".geo")
        return clean_text(geo.get_text(" ", strip=True)) if geo else ""

    launch_coords = coords_from_td(ltd)
    landing_coords = coords_from_td(land_td)

    def coalesce(site, coords):
        if site and coords and ("," not in site or not any(k in site for k in ["Cosmodrome","Kennedy","Canaveral","Baikonur","Jiuquan","Tanegashima","Xichang"])):
            return f"{site} ({coords})"
        return site or coords or ""

    data["launch_site"] = coalesce(launch_site, launch_coords)
    data["landing_site"] = coalesce(landing_site, landing_coords)
    data["launch_date"] = launch_date
    data["mission_duration"] = duration
    data["rocket"] = rocket
    data["destination"] = destination
    return data

# ---------- Main ----------
NEEDED = [
    "Launch site / base (or coordinates)",
    "Destination station",
    "Launch (UTC)",
    "Mission duration",
    "Landing site (or coordinates)",
    "Rocket type",
]

def needs_update(row, force=False):
    if force: return True
    for c in NEEDED:
        v = row.get(c, "")
        if pd.isna(v) or (isinstance(v, str) and not v.strip()):
            return True
    return False

def scrape_one(mission):
    t, url, html = resolve_title(mission)
    if not html: 
        return None
    info = parse_infobox(html)
    return {
        "Mission": mission,
        "Launch site / base (or coordinates)": info.get("launch_site",""),
        "Destination station": info.get("destination",""),
        "Launch (UTC)": info.get("launch_date",""),
        "Mission duration": info.get("mission_duration",""),
        "Landing site (or coordinates)": info.get("landing_site",""),
        "Rocket type": info.get("rocket",""),
        "Source URL": url
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--only", help="Comma-separated list of mission names to scrape (for testing)")
    args = ap.parse_args()

    path = args.csv
    if not os.path.exists(path):
        raise SystemExit(f"CSV not found: {path}")
    df = pd.read_csv(path)

    for c in ["Mission"] + NEEDED + ["Source URL"]:
        if c not in df.columns:
            df[c] = ""

    if args.only:
        filter_set = set([m.strip() for m in args.only.split(",")])
        idxs = [i for i,m in enumerate(df["Mission"].astype(str).tolist()) if m in filter_set]
    else:
        idxs = range(len(df))

    updated = 0
    for i in idxs:
        row = df.iloc[i]
        mission = str(row["Mission"]).strip()
        if not mission:
            continue
        if not needs_update(row, force=args.force):
            continue
        log(f"[{i+1}/{len(df)}] {mission}")
        try:
            r = scrape_one(mission)
            if r:
                for k, v in r.items():
                    df.at[i, k] = v
                updated += 1
                out_now = args.out or path
                df.to_csv(out_now, index=False)
                log(f"  -> updated row {i+1} and saved to {out_now}")
            else:
                log("  !! no mission page resolved")
        except Exception as e:
            log(f"  !! error: {e}")
        time.sleep(args.sleep)

    out_final = args.out or path
    df.to_csv(out_final, index=False)
    log(f"Done. Updated rows: {updated}. Wrote: {out_final}")

if __name__ == "__main__":
    main()
