import json, random
from pathlib import Path
root = Path("/tmp/claude-0/-home-user-solana-sentinel/d5febe13-4617-50ea-aa2a-dcfe8c1d2c6e/scratchpad/design/project")

BG="#0E0C09"; S1="#18150F"; LINE="#221E17"; LINE2="#3A342A"; TXT="#F4F1EA"; MUT="#A39C8E"; NEON="#CCFF00"; OK="#00C805"; WARN="#FFB01F"; BAD="#FF5000"

def head(title):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500&amp;family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&amp;display=swap">
<style>
body{{margin:0;background:{BG}}}
a{{color:{NEON}}}a:hover{{color:#E2FF66}}
.sx{{font-family:'Geist',system-ui,sans-serif;color:{TXT};background:{BG};-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.45}}
.num{{font-variant-numeric:tabular-nums}}
.mono{{font-family:'Geist Mono',ui-monospace,monospace}}
.serif{{font-family:'Source Serif 4',Georgia,serif}}
.sr{{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
.pill{{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}}
.p-ok{{background:{OK};color:#04140A}}
.p-warn{{background:{WARN};color:#1C1303}}
.p-bad{{background:{BAD};color:#1C0A02}}
.p-neutral{{background:#2B261E;color:#E9E4DA}}
.p-line{{border:1px solid {LINE2};color:#E9E4DA}}
.cta{{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:{NEON};color:{BG};border:0;border-radius:999px;min-height:48px;padding:0 24px;font:600 15px 'Geist',sans-serif;cursor:pointer;text-decoration:none}}
.btn2{{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:{TXT};border:1px solid {LINE2};border-radius:999px;min-height:44px;padding:0 18px;font:600 14px 'Geist',sans-serif;cursor:pointer;text-decoration:none}}
.txtbtn{{background:transparent;border:0;color:{TXT};font:600 14px 'Geist',sans-serif;cursor:pointer;min-height:44px;padding:0 4px}}
.danger{{color:#FF7A3D}}
.field{{width:100%;box-sizing:border-box;height:48px;border-radius:12px;border:1px solid {LINE2};background:{S1};color:{TXT};padding:0 16px;font:15px 'Geist',sans-serif}}
.field::placeholder{{color:#8F897D}}
.label{{display:block;font-size:13px;font-weight:600;color:#D6D0C4;margin-bottom:8px}}
.hint{{font-size:12px;color:{MUT};margin-top:6px;line-height:1.4}}
.muted{{color:{MUT}}}
.row{{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid {LINE}}}
.navlink{{color:#C9C3B6;text-decoration:none;font-size:15px;font-weight:500;padding:24px 0;border-bottom:2px solid transparent}}
.navlink:hover{{color:{TXT}}}
.on{{color:{TXT};border-bottom-color:{NEON}}}
.seg{{display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border-radius:999px;font:600 13px 'Geist',sans-serif;color:#C9C3B6;background:transparent;border:0;cursor:pointer}}
.seg-on{{background:{TXT};color:{BG}}}
.eyebrow{{font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:{MUT}}}
.h2{{font-size:22px;font-weight:600;letter-spacing:-0.01em;margin:0}}
button:focus-visible,a:focus-visible,input:focus-visible{{outline:2px solid {NEON};outline-offset:2px}}
</style>
</helmet>
'''

def tail(w,h, extra=""):
    props = {"$preview":{"width":w,"height":h}}
    return f'''</x-dc>
<script type="text/x-dc" data-dc-script data-props='{json.dumps(props)}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''

def icon(name, size=18, color="currentColor", sw=1.75):
    paths = {
      "search": '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
      "plus": '<path d="M12 5v14M5 12h14"></path>',
      "copy": '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a1 1 0 0 1 1-1h9"></path>',
      "ext": '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"></path>',
      "up": '<path d="M7 17L17 7M9 7h8v8"></path>',
      "down": '<path d="M7 7l10 10M17 9v8H9"></path>',
      "check": '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
      "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path>',
      "home": '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"></path>',
      "wallet": '<rect x="3.5" y="6" width="17" height="13" rx="2.5"></rect><path d="M16 12.5h2M3.5 9.5h17"></path>',
      "gear": '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"></path>',
      "alert": '<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17v.5"></path>',
      "lock": '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
      "chev": '<path d="M9 6l6 6-6 6"></path>',
      "dot": '<circle cx="12" cy="12" r="4" fill="currentColor"></circle>',
    }
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>'

def mark(size=28):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="14" stroke="{TXT}" stroke-width="2"></circle><path d="M6 16c3-5.5 6.5-8 10-8s7 2.5 10 8c-3 5.5-6.5 8-10 8s-7-2.5-10-8z" stroke="{TXT}" stroke-width="2"></path><circle cx="16" cy="16" r="3.5" fill="{NEON}"></circle></svg>'

def topbar(active):
    links = [("Home","Main.dc.html"),("Wallets","Wallet.dc.html"),("Alerts","Alerts.dc.html"),("Setup","Setup.dc.html")]
    AC = ' aria-current="page"'
    nav = "".join(f'<a class="navlink{" on" if n==active else ""}" href="{h}"{AC if n==active else ""}>{n}</a>' for n,h in links)
    return f'''<header style="border-bottom: 1px solid {LINE}">
<div style="max-width: 1280px; margin: 0 auto; padding: 0 32px; display: flex; align-items: center; gap: 40px">
<a href="Main.dc.html" style="display: flex; align-items: center; gap: 10px; text-decoration: none; color: {TXT}">{mark()}<span class="serif" style="font-size: 24px; font-weight: 600; letter-spacing: -0.01em">Sentinel</span></a>
<nav aria-label="Workspace" style="display: flex; gap: 28px">{nav}</nav>
<div style="flex-grow: 1"></div>
<label style="position: relative; display: block; width: 260px"><span class="sr">Search watched wallets</span><span style="position: absolute; left: 14px; top: 11px; color: {MUT}">{icon("search")}</span><input class="field" style="height: 40px; border-radius: 999px; padding-left: 42px; font-size: 14px" placeholder="Search wallets"></label>
<button class="btn2" style="min-height: 40px; padding: 0 6px 0 6px; gap: 10px" aria-label="Account menu for designer"><span style="width: 28px; height: 28px; border-radius: 999px; background: #2B261E; display: inline-flex; align-items: center; justify-content: center; font-size: 13px">D</span><span style="padding-right: 10px">designer</span></button>
</div>
</header>
'''

def strip(seed, n, w=840, h=150, big=False):
    random.seed(seed)
    lanes = {"trade":(40,OK,5.5 if big else 5),"unk":(82,"#8F897D",3.6),"fail":(122,BAD,4.5)}
    xs = sorted(random.uniform(16,w-16) for _ in range(n))
    out=[f'<line x1="0" y1="{y}" x2="{w}" y2="{y}" stroke="{LINE}" stroke-width="1"></line>' for y,_,_ in lanes.values()]
    for x in xs:
        r=random.random(); k="trade" if r<0.3 else ("unk" if r<0.9 else "fail")
        y,c,rad=lanes[k]
        out.append(f'<circle cx="{x:.1f}" cy="{y}" r="{rad}" fill="{c}"></circle>')
    # "now" marker
    out.append(f'<line x1="{w-2}" y1="18" x2="{w-2}" y2="{h-10}" stroke="{NEON}" stroke-width="1.5" stroke-dasharray="3 4"></line>')
    return f'<svg viewBox="0 0 {w} {h}" width="100%" style="display: block; height: auto" role="img" aria-label="Sample: recent observations by time, grouped by outcome">{"".join(out)}</svg>'

def chart(seed, n, w=840, h=220, scrub=True, label=True, show=("buy","sell","fail")):
    random.seed(seed)
    ts = sorted(random.uniform(0,1) for _ in range(n))
    kinds = []
    for _ in ts:
        r=random.random(); kinds.append("buy" if r<0.16 else ("sell" if r<0.3 else ("fail" if r>0.94 else "unk")))
    pad_t, pad_b = 46 if scrub else 12, 14
    pts=[(8+t*(w-16), h-pad_b-(i+1)/n*(h-pad_t-pad_b)) for i,t in enumerate(ts)]
    d="M8,"+f"{h-pad_b:.1f}"+"".join(f" H{x:.1f} V{y:.1f}" for x,y in pts)+f" H{w-8}"
    out=[f'<line x1="8" y1="{h-pad_b}" x2="{w-8}" y2="{h-pad_b}" stroke="{LINE2}" stroke-width="1" stroke-dasharray="2 5"></line>',
         f'<path d="{d}" fill="none" stroke="{TXT}" stroke-width="2" stroke-linejoin="round"></path>']
    sx=None
    for (x,y),k in zip(pts,kinds):
        if k not in show: pass
        elif k=="buy": out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{OK}" stroke="{BG}" stroke-width="2"></circle>')
        elif k=="sell": out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{BAD}" stroke="{BG}" stroke-width="2"></circle>')
        elif k=="fail": out.append(f'<rect x="{x-3.5:.1f}" y="{h-pad_b-3.5}" width="7" height="7" fill="{BAD}" transform="rotate(45 {x:.1f} {h-pad_b})"></rect>')
        if k=="sell" and sx is None and x>w*0.45 and "sell" in show: sx=(x,y)
    if scrub and sx:
        x,y=sx
        out.append(f'<line x1="{x:.1f}" y1="30" x2="{x:.1f}" y2="{h-pad_b}" stroke="#6E685D" stroke-width="1"></line>')
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="none" stroke="{BAD}" stroke-width="2"></circle>')
    return f'<svg viewBox="0 0 {w} {h}" width="100%" style="display: block; height: auto" role="img" aria-label="Sample chart: cumulative observations in the recent window, with classified buys and sells marked">{"".join(out)}</svg>'

def spark(seed, color, n=14, w=96, h=32):
    random.seed(seed)
    ts=sorted(random.uniform(0,1) for _ in range(n))
    d=f"M0,{h-2}"+"".join(f" H{t*w:.1f} V{h-2-(i+1)/n*(h-4):.1f}" for i,t in enumerate(ts))+f" H{w}"
    return f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true"><path d="{d}" fill="none" stroke="{color}" stroke-width="1.75" stroke-linejoin="round"></path></svg>'

def legend():
    return f'''<div style="display: flex; flex-wrap: wrap; gap: 20px; font-size: 13px; color: #C9C3B6">
<span style="display: inline-flex; align-items: center; gap: 8px"><span style="width: 16px; height: 2px; background: {TXT}"></span>Observations in window</span>
<span style="display: inline-flex; align-items: center; gap: 8px"><span style="width: 10px; height: 10px; border-radius: 999px; background: {OK}"></span>Buy</span>
<span style="display: inline-flex; align-items: center; gap: 8px"><span style="width: 10px; height: 10px; border-radius: 999px; background: {BAD}"></span>Sell</span>
<span style="display: inline-flex; align-items: center; gap: 8px"><span style="width: 8px; height: 8px; background: {BAD}; transform: rotate(45deg)"></span>Failed</span>
<span class="muted">Unmarked steps are unclassified — the parser abstained, not proof of no trade.</span>
</div>'''

def wrap(inner):
    return f'<div class="sx" style="min-height: 100vh">\n{inner}\n</div>\n'


def card_attn(ic, color, title, body, action, href):
    return f'''<article style="border: 1px solid {LINE}; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 10px; min-width: 0">
<span style="width: 36px; height: 36px; border-radius: 999px; background: {S1}; display: inline-flex; align-items: center; justify-content: center">{icon(ic,18,color)}</span>
<h3 style="margin: 0; font-size: 15px; font-weight: 600">{title}</h3>
<p class="muted" style="margin: 0; font-size: 13px; line-height: 1.45; flex-grow: 1">{body}</p>
<a href="{href}" style="font-size: 14px; font-weight: 600; text-decoration: none; color: {TXT}; display: inline-flex; align-items: center; gap: 4px; min-height: 32px">{action}{icon("chev",16)}</a>
</article>'''

def kstat(l, v, sub=""):
    sub_s = f'<span class="muted" style="font-size: 12px">{sub}</span>' if sub else ""
    return f'<div style="display: flex; flex-direction: column; gap: 2px; padding: 14px 0; border-bottom: 1px solid {LINE}"><span class="muted" style="font-size: 13px">{l}</span><span class="num" style="font-size: 20px; font-weight: 500">{v}</span>{sub_s}</div>'

def dayhead(t):
    return f'<h3 class="eyebrow" style="margin: 24px 0 0; padding-bottom: 8px; border-bottom: 1px solid {LINE}">{t}</h3>'

def health_row(c, label, value, warn=False):
    vc = WARN if warn else "#C9C3B6"
    return f'<div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid {LINE}; font-size: 14px"><span style="display: inline-flex; align-items: center; gap: 10px"><span style="width: 8px; height: 8px; border-radius: 999px; background: {c}"></span>{label}</span><span class="num" style="color: {vc}; font-size: 13px">{value}</span></div>'

# ---------------- Main (Home) ----------------
wallet_rows = [
 ("9WzD…AWWM",None,"p-ok","Current","12s ago · 50 obs"),
 ("7xKX…9fQa",None,"p-ok","Current","31s ago · 50 obs"),
 ("HN7c…Ywrh",None,"p-ok","Current","44s ago · 19 obs"),
 ("4Nd1…mBzK",None,"p-warn","Catching up","Backfilling recent window"),
]
SPARK = {"p-ok":"#C9C3B6","p-warn":WARN,"p-neutral":"#4A443A"}
def wrows():
    s=""
    for a,label,cls,st,sub in wallet_rows:
        name = f'<span class="mono" style="font-size: 15px">{a}</span>' + (f'<span class="muted" style="font-size: 13px; margin-left: 8px">{label}</span>' if label else "")
        s+=f'''<a href="Wallet.dc.html" class="row" style="text-decoration: none; color: {TXT}; padding: 14px 0">
<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span>{name}</span><span class="muted" style="font-size: 13px">{sub}</span></span>
<span style="display: flex; align-items: center; gap: 14px">{spark(hash(a)%97, SPARK[cls])}<span class="pill {cls}" style="min-width: 92px; justify-content: center">{st}</span></span>
</a>'''
    return s

activity = [
 ("up","BUY 1,250.5","So11…1112","9WzD…AWWM","Slot 312,345,678 · 06:48","p-ok","Classified"),
 ("unk","Unsupported instruction layout","","7xKX…9fQa","Slot 312,345,600 · 06:35","p-neutral","Unclassified"),
 ("down","SELL 88.0","JUPy…vCN","9WzD…AWWM","Slot 312,344,912 · 06:12","p-ok","Classified"),
 ("fail","Transaction failed on chain","","7xKX…9fQa","Slot 312,344,500 · 05:58","p-bad","Failed"),
]
def arows(include_wallet=True):
    s=""
    for kind,title,mint,w,meta,cls,st in activity:
        ic = {"up":icon("up",18,OK),"down":icon("down",18,BAD),"unk":icon("dot",18,"#8F897D"),"fail":icon("alert",18,BAD)}[kind]
        mint_s = f' <span class="mono muted" style="font-size: 13px">{mint}</span>' if mint else ""
        wl = f'<span class="mono">{w}</span> · ' if include_wallet else ""
        s+=f'''<div class="row">
<span style="display: flex; align-items: center; gap: 14px; min-width: 0"><span style="width: 40px; height: 40px; border-radius: 999px; background: {S1}; border: 1px solid {LINE}; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0">{ic}</span>
<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-weight: 600" class="num">{title}{mint_s}</span><span class="muted num" style="font-size: 13px">{wl}{meta}</span></span></span>
<span style="display: flex; align-items: center; gap: 4px"><span class="pill {cls}">{st}</span><a href="#" aria-label="Open transaction in Solana Explorer" style="color: {MUT}; display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; justify-content: center">{icon("ext",18)}</a></span>
</div>'''
    return s

def stat(v,l,cap,first=False):
    rule = "" if first else f"border-left: 1px solid {LINE}; "
    return f'''<div style="display: flex; flex-direction: column; gap: 4px; padding: 0 24px; {rule}">
<span class="muted" style="font-size: 13px">{l}</span>
<span class="num" style="font-size: 36px; font-weight: 500; letter-spacing: -0.03em; line-height: 1.1">{v}</span>
<span class="muted" style="font-size: 12px">{cap}</span>
</div>'''

main = head("Sentinel — Home") + wrap(topbar("Home") + f'''<main style="max-width: 1280px; margin: 0 auto; padding: 48px 32px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 64px; box-sizing: border-box">
<div style="display: flex; flex-direction: column; gap: 40px; min-width: 0">
<section aria-labelledby="hero" style="display: flex; flex-direction: column; gap: 14px">
<span class="eyebrow">Shared monitor</span>
<h1 id="hero" style="margin: 0; font-size: 56px; line-height: 1.02; font-weight: 500; letter-spacing: -0.035em">3 of 4 wallets current</h1>
<div style="display: flex; align-items: center; gap: 10px; font-size: 16px"><span style="color: {WARN}; display: inline-flex">{icon("alert",18,WARN)}</span><span style="color: {WARN}; font-weight: 600">Monitoring degraded</span><span class="muted">· 4Nd1…mBzK is still backfilling its recent window</span></div>
<div style="display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 4px; font-size: 13px; color: #C9C3B6"><span style="display: inline-flex; align-items: center; gap: 7px"><span style="width: 7px; height: 7px; border-radius: 999px; background: {OK}"></span>Worker running</span><span style="display: inline-flex; align-items: center; gap: 7px"><span style="width: 7px; height: 7px; border-radius: 999px; background: {OK}"></span>Backup verified 6h ago</span><span style="display: inline-flex; align-items: center; gap: 7px; color: {WARN}"><span style="width: 7px; height: 7px; border-radius: 999px; background: {WARN}"></span>Off-host copy overdue</span><span style="display: inline-flex; align-items: center; gap: 7px"><span style="width: 7px; height: 7px; border-radius: 999px; background: {OK}"></span>RPC connected</span><span style="display: inline-flex; align-items: center; gap: 7px"><span style="width: 7px; height: 7px; border-radius: 999px; background: {OK}"></span>Telegram bot saved</span><span class="muted">· Updated 6s ago</span></div>
</section>
<section aria-labelledby="obs" style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px">
<h2 id="obs" class="h2">Recent observations</h2>
<div role="group" aria-label="Filter observations" style="display: flex; gap: 4px"><button class="seg seg-on" aria-pressed="true">All wallets</button><button class="seg" aria-pressed="false">9WzD…AWWM</button><button class="seg" aria-pressed="false">7xKX…9fQa</button><button class="seg" aria-pressed="false">More</button></div>
</div>
{chart(7,96)}
<div style="display: flex; justify-content: space-between" class="muted num"><span style="font-size: 12px">04:12 · oldest in window</span><span style="font-size: 12px">06:49 · now</span></div>
{legend()}
</section>
<section aria-label="Monitor statistics" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-left: -24px; padding: 24px 0; border-top: 1px solid {LINE}; border-bottom: 1px solid {LINE}">
{stat("1,284","Stored observations","Kept in the journal",True)}
{stat("37","Trade legs","Supported BUY/SELL")}
{stat("212","Unclassified","Not proof of no trade")}
{stat("0","Pending alerts","Waiting to be sent")}
</section>
<section aria-labelledby="act" style="display: flex; flex-direction: column">
<div style="display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid {LINE}"><h2 id="act" class="h2">Recent activity</h2><a href="Wallet.dc.html" style="font-size: 14px; font-weight: 600; text-decoration: none">View all</a></div>
{arows()}
<p class="muted" style="font-size: 12px; margin: 16px 0 0">Bounded recent window per wallet, not lifetime history. Quantities only — USD prices are unavailable. Read-only chain access; Sentinel never signs or trades.</p>
</section>
</div>
<aside aria-label="Watchlist and setup" style="display: flex; flex-direction: column; gap: 24px">
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 24px; display: flex; flex-direction: column">
<div style="display: flex; align-items: center; justify-content: space-between"><div><h2 class="h2" style="font-size: 18px">Watchlist</h2><span class="muted" style="font-size: 13px">Shared by both members</span></div><span class="pill p-neutral num">4 wallets</span></div>
<form style="display: flex; gap: 8px; margin: 20px 0 6px"><label style="flex-grow: 1"><span class="sr">Public wallet address</span><input class="field mono" style="height: 44px; font-size: 13px" placeholder="Paste a public address"></label><button class="cta" style="min-height: 44px; width: 44px; padding: 0" aria-label="Watch wallet">{icon("plus",20,BG,2.2)}</button></form>
<p class="hint" style="margin: 0 0 8px">Public address only. Never paste a private key or seed phrase.</p>
{wrows()}
</section>
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 14px">
<div style="display: flex; align-items: center; justify-content: space-between"><h2 class="h2" style="font-size: 18px">Setup</h2><span class="muted num" style="font-size: 13px">3 of 4 done</span></div>
<div style="height: 6px; border-radius: 999px; background: #2B261E; overflow: hidden"><div style="width: 75%; height: 6px; background: {NEON}"></div></div>
<a href="Setup.dc.html" class="row" style="text-decoration: none; color: {TXT}; border-bottom: 0; padding: 4px 0"><span style="display: flex; flex-direction: column"><span style="font-weight: 600">Verify your Telegram destination</span><span class="muted" style="font-size: 13px">Alerts reach Telegram only after you verify</span></span><span style="color: {MUT}">{icon("chev",20)}</span></a>
</section>
<p class="muted" style="font-size: 12px; margin: 0; padding: 0 4px">Monitoring pauses while the host Mac is asleep or offline. Updated 6s ago.</p>
</aside>
</main>
''') + tail(1440,1320)

# ---------------- Wallet detail ----------------
wallet = head("Sentinel — Wallet") + wrap(topbar("Wallets") + f'''<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 64px; box-sizing: border-box">
<div style="display: flex; flex-direction: column; gap: 36px; min-width: 0">
<section style="display: flex; flex-direction: column; gap: 12px">
<a href="Main.dc.html" style="font-size: 14px; font-weight: 600; text-decoration: none; color: {MUT}">Wallets</a>
<div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap"><h1 class="mono" style="margin: 0; font-size: 36px; font-weight: 500; letter-spacing: -0.02em">9WzDXwBb…L9zYtAWWM</h1><button class="btn2" style="min-height: 36px; padding: 0 14px; font-size: 13px">{icon("copy",16)}Copy address</button></div>
<div style="display: flex; align-items: center; gap: 10px; font-size: 16px"><span class="pill p-ok">Current</span><span class="muted">Last head observation 12s ago · parser revision 3</span></div>
</section>
<section aria-labelledby="wa" style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
<div><span class="muted" style="font-size: 13px">Supported trade legs in the last 50 observations</span><div class="num" style="font-size: 56px; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05">14</div></div>
<div role="group" aria-label="Filter observations" style="display: flex; gap: 4px"><button class="seg seg-on" aria-pressed="true">All 50</button><button class="seg" aria-pressed="false">Buys</button><button class="seg" aria-pressed="false">Sells</button><button class="seg" aria-pressed="false">Unclassified</button></div>
</div>
{chart(21,50)}
{legend()}
</section>
<section aria-labelledby="wks" style="display: flex; flex-direction: column">
<h2 id="wks" class="h2" style="margin-bottom: 4px">Key statistics</h2>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 32px">
{kstat("Observations","50","recent window")}{kstat("Buys","9")}{kstat("Sells","5")}{kstat("Unclassified","33","parser abstained")}
{kstat("Failed","3")}{kstat("Coverage","Current","head polled 12s ago")}{kstat("Parser revision","3")}{kstat("Rules on this wallet","2","1 enabled")}
</div>
</section>
<section aria-labelledby="wl" style="display: flex; flex-direction: column">
<h2 id="wl" class="h2">Observations</h2>
{dayhead("Today")}
{arows(False)}
<p class="muted" style="font-size: 12px; margin: 16px 0 0">Most recent 50 observations. Reinterpretations by a newer parser do not send historical alerts. USD unavailable.</p>
</section>
</div>
<aside aria-label="Alert on this wallet" style="display: flex; flex-direction: column; gap: 24px">
<form style="border: 1px solid {LINE}; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 20px">
<div role="tablist" aria-label="Alert side" style="display: flex; gap: 24px; border-bottom: 1px solid {LINE}">
<button role="tab" aria-selected="true" style="background: transparent; border: 0; border-bottom: 2px solid {NEON}; color: {TXT}; font: 600 16px 'Geist', sans-serif; padding: 0 0 12px; min-height: 44px; cursor: pointer">Alert on buys</button>
<button role="tab" aria-selected="false" style="background: transparent; border: 0; border-bottom: 2px solid transparent; color: {MUT}; font: 600 16px 'Geist', sans-serif; padding: 0 0 12px; min-height: 44px; cursor: pointer">Alert on sells</button>
</div>
<label><span class="label">Rule name</span><input class="field" value="Wallet buy"></label>
<label><span class="label">Token filter <span class="muted" style="font-weight: 400">(optional)</span></span><input class="field mono" style="font-size: 13px" placeholder="Any token"></label>
<label><span class="label">Cooldown</span><span style="display: flex; align-items: center; gap: 10px"><input class="field num" style="width: 120px" value="60"><span class="muted">minutes</span></span><span class="hint" style="display: block">0–10080. Repeat alerts within the cooldown are suppressed.</span></label>
<div style="display: flex; justify-content: space-between; font-size: 14px; padding: 12px 0; border-top: 1px solid {LINE}"><span class="muted">Delivered to</span><span>Shared inbox + verified Telegram</span></div>
<button class="cta" type="submit" style="width: 100%">Create buy alert</button>
<p class="hint" style="margin: -8px 0 0; text-align: center">Applies to future finalized, supported activity only.</p>
</form>
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 8px 24px">
<div class="row"><span style="display: flex; flex-direction: column"><span style="font-weight: 600">Wallet sell</span><span class="muted" style="font-size: 13px">SELL · this wallet · any token · 30 min cooldown</span></span><button role="switch" aria-checked="true" aria-label="Wallet sell enabled" style="width: 48px; height: 28px; border-radius: 999px; border: 0; background: {OK}; position: relative; cursor: pointer"><span style="position: absolute; right: 3px; top: 3px; width: 22px; height: 22px; border-radius: 999px; background: {TXT}"></span></button></div>
<div class="row" style="border-bottom: 0"><span style="display: flex; flex-direction: column"><span style="font-weight: 600">JUP buys</span><span class="muted" style="font-size: 13px">BUY · this wallet · JUPy…vCN · 1 day cooldown</span></span><button role="switch" aria-checked="false" aria-label="JUP buys enabled" style="width: 48px; height: 28px; border-radius: 999px; border: 0; background: #3A342A; position: relative; cursor: pointer"><span style="position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 999px; background: #C9C3B6"></span></button></div>
</section>
<button class="txtbtn danger" style="align-self: flex-start">Remove from watchlist</button>
</aside>
</main>
''') + tail(1440,1240)

# ---------------- Alerts ----------------
inbox = [
 ("up",OK,"Wallet buy","BUY 1,250.5 So11…1112 · 9WzD…AWWM","2m","In inbox",""),
 ("down",BAD,"Wallet sell","SELL 88.0 JUPy…vCN · 9WzD…AWWM","38m","In inbox",""),
 ("up",OK,"Wallet buy","BUY 410.0 So11…1112 · 9WzD…AWWM","41m","Suppressed · cooldown",""),
 ("up",OK,"JUP buys","BUY 3.2 JUPy…vCN · 7xKX…9fQa","Yesterday","In inbox",""),
]
def irows():
    s=""
    for k,c,t,b,tm,st,op in inbox:
        s+=f'''<article class="row" style="align-items: flex-start; {op}">
<span style="display: flex; gap: 14px; min-width: 0"><span style="width: 40px; height: 40px; border-radius: 999px; background: {S1}; border: 1px solid {LINE}; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0">{icon(k,18,c)}</span>
<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><h3 style="margin: 0; font-size: 15px; font-weight: 600">{t}</h3><span class="num" style="font-size: 14px; color: #D6D0C4">{b}</span><span class="muted" style="font-size: 12px">{st}</span></span></span>
<span class="muted num" style="font-size: 13px; white-space: nowrap">{tm}</span>
</article>'''
    return s
deliv = [("p-ok","Sent","Wallet buy · 2m","1 attempt"),("p-ok","Sent","Wallet sell · 38m","1 attempt"),("p-bad","Failed","JUP buys · Yesterday","3 attempts · chat not found")]
def drows():
    s=""
    for cls,st,t,a in deliv:
        btn = '<button class="btn2" style="min-height: 36px; font-size: 13px">Retry</button>' if st=="Failed" else ""
        s+=f'<div class="row"><span style="display: flex; flex-direction: column"><span style="font-weight: 600; font-size: 14px">{t}</span><span class="muted" style="font-size: 12px">{a}</span></span><span style="display: flex; gap: 8px; align-items: center">{btn}<span class="pill {cls}">{st}</span></span></div>'
    return s

alerts = head("Sentinel — Alerts") + wrap(topbar("Alerts") + f'''<main style="max-width: 1280px; margin: 0 auto; padding: 48px 32px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 64px; box-sizing: border-box">
<div style="display: flex; flex-direction: column; gap: 28px; min-width: 0">
<div style="display: flex; flex-direction: column; gap: 8px"><span class="eyebrow">Shared inbox</span><h1 style="margin: 0; font-size: 48px; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05">Alerts</h1></div>
<div role="tablist" aria-label="Alert views" style="display: flex; gap: 4px"><button role="tab" aria-selected="true" class="seg seg-on">Inbox</button><button role="tab" aria-selected="false" class="seg">Rules · 3</button></div>
<section aria-label="Inbox">{irows()}</section>
<p class="muted" style="font-size: 12px; margin: 0">Alerts are sent only for finalized transactions in supported parser shapes. Both members see the same inbox.</p>
</div>
<aside aria-label="Your Telegram deliveries" style="display: flex; flex-direction: column; gap: 24px">
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 24px; display: flex; flex-direction: column">
<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px"><div><h2 class="h2" style="font-size: 18px">Your Telegram</h2><span class="muted" style="font-size: 13px">Chat ••••4417 · verified</span></div><span class="pill p-ok">On</span></div>
<div style="border: 1px solid {WARN}; border-radius: 14px; padding: 16px; margin: 12px 0 4px; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; justify-content: space-between; gap: 12px"><span style="display: flex; flex-direction: column"><span style="font-weight: 600; font-size: 14px">Wallet sell · 1h</span><span class="muted" style="font-size: 12px">1 attempt · timed out after send</span></span><span class="pill p-warn">May have arrived</span></div>
<p style="margin: 0; font-size: 13px; color: #E9E4DA; line-height: 1.45">This message may already be in Telegram. Check there first — retrying can send a duplicate.</p>
<button class="btn2" style="min-height: 40px; font-size: 13px; border-color: {WARN}; color: {WARN}; align-self: flex-start">Retry anyway</button>
</div>
{drows()}
</section>
<a href="Setup.dc.html" class="btn2" style="align-self: flex-start">Manage destination</a>
</aside>
</main>
''') + tail(1440,1040)

# ---------------- Setup ----------------
steps=[("done","Solana connection","Dedicated HTTPS RPC verified"),("done","Shared Telegram bot","Token saved, never shown again"),("now","Your Telegram destination","Each member verifies their own chat"),("todo","Team access","2 of 2 members active")]
def srows():
    s=""
    for st,t,sub in steps:
        if st=="done": dot=f'<span style="width: 32px; height: 32px; border-radius: 999px; background: {OK}; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0">{icon("check",18,"#04140A",2.4)}</span>'
        elif st=="now": dot=f'<span style="width: 32px; height: 32px; border-radius: 999px; border: 2px solid {NEON}; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0"><span style="width: 10px; height: 10px; border-radius: 999px; background: {NEON}"></span></span>'
        else: dot=f'<span style="width: 32px; height: 32px; border-radius: 999px; border: 2px solid {LINE2}; flex-shrink: 0; box-sizing: border-box"></span>'
        cur = ' aria-current="step"' if st=="now" else ""
        bg = f"background: {S1}; " if st=="now" else ""
        s+=f'<a href="#"{cur} style="{bg}display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: 14px; text-decoration: none; color: {TXT}">{dot}<span style="display: flex; flex-direction: column"><span style="font-weight: 600">{t}</span><span class="muted" style="font-size: 13px">{sub}</span></span></a>'
    return s
setup = head("Sentinel — Setup") + wrap(topbar("Setup") + f'''<main style="max-width: 1280px; margin: 0 auto; padding: 48px 32px 80px; display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 72px; box-sizing: border-box">
<nav aria-label="Setup steps" style="display: flex; flex-direction: column; gap: 4px">
<span class="eyebrow" style="padding: 0 16px 12px">Setup · 3 of 4</span>
{srows()}
</nav>
<div style="display: flex; flex-direction: column; gap: 48px; max-width: 640px">
<section style="display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 12px"><span class="eyebrow">Step 3</span><h1 class="serif" style="margin: 0; font-size: 44px; font-weight: 500; line-height: 1.08; letter-spacing: -0.01em">Get alerts in your own Telegram.</h1><p class="muted" style="margin: 0; font-size: 16px">Start the shared bot in Telegram, then enter your numeric chat ID. We’ll send a code to prove the chat is yours.</p></div>
<label><span class="label">Chat ID</span><input class="field num" placeholder="e.g. 123456789"><span class="hint" style="display: block">Message the bot, then use @userinfobot or getUpdates to find your numeric ID.</span></label>
<button class="cta" style="align-self: flex-start">Send verification code</button>
<div style="display: flex; flex-direction: column; gap: 10px; padding-top: 24px; border-top: 1px solid {LINE}">
<span class="label" id="codel">Verification code</span>
<div role="group" aria-labelledby="codel" style="display: flex; gap: 10px">{"".join(f'<input class="field num" aria-label="Digit {i+1}" style="width: 52px; height: 60px; text-align: center; font-size: 22px; padding: 0" maxlength="1">' for i in range(6))}</div>
<span class="hint">Enter the code exactly as Telegram shows it.</span>
</div>
</section>
<section aria-labelledby="team" style="display: flex; flex-direction: column">
<div style="display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid {LINE}"><h2 id="team" class="h2">Team access</h2><span class="muted" style="font-size: 13px">Two equal members</span></div>
<div class="row"><span style="display: flex; align-items: center; gap: 12px"><span style="width: 36px; height: 36px; border-radius: 999px; background: #2B261E; display: inline-flex; align-items: center; justify-content: center; font-weight: 600">D</span><span style="display: flex; flex-direction: column"><span style="font-weight: 600">designer <span class="muted" style="font-weight: 400">· you</span></span><span class="muted" style="font-size: 13px">Enabled · signed in here</span></span></span><button class="btn2" style="min-height: 36px; font-size: 13px">Rotate credential</button></div>
<div class="row"><span style="display: flex; align-items: center; gap: 12px"><span style="width: 36px; height: 36px; border-radius: 999px; background: #2B261E; display: inline-flex; align-items: center; justify-content: center; font-weight: 600">R</span><span style="display: flex; flex-direction: column"><span style="font-weight: 600">reviewer</span><span class="muted" style="font-size: 13px">Enabled</span></span></span><span style="display: flex; gap: 8px"><button class="btn2" style="min-height: 36px; font-size: 13px">Rotate</button><button class="btn2 danger" style="min-height: 36px; font-size: 13px">Revoke</button></span></div>
<div style="margin-top: 20px; border-radius: 14px; background: {S1}; border: 1px solid {LINE2}; padding: 18px; display: flex; flex-direction: column; gap: 12px">
<span style="display: flex; align-items: center; gap: 8px; font-weight: 600">{icon("lock",18,NEON)}New credential for reviewer</span>
<div style="display: flex; gap: 8px; align-items: center"><code class="mono" style="flex-grow: 1; background: {BG}; border-radius: 10px; padding: 12px 14px; font-size: 14px; letter-spacing: 0.08em">••••••••••••••••••••••••••••••••</code><button class="cta" style="min-height: 44px">Copy</button></div>
<span class="hint" style="margin: 0">Shown once. It disappears when you hide it, sign out or your session ends. Share it privately.</span>
</div>
</section>
</div>
</main>
''') + tail(1440,1260)

# ---------------- Sign in ----------------
signin = head("Sentinel — Sign in") + wrap(f'''<header style="max-width: 1280px; margin: 0 auto; padding: 24px 32px; display: flex; align-items: center; gap: 10px">{mark()}<span class="serif" style="font-size: 24px; font-weight: 600">Sentinel</span></header>
<main style="max-width: 1280px; margin: 0 auto; padding: 64px 32px 96px; display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 96px; align-items: center; box-sizing: border-box">
<section style="display: flex; flex-direction: column; gap: 24px">
<h1 class="serif" style="margin: 0; font-size: 72px; line-height: 1.02; font-weight: 500; letter-spacing: -0.02em">Watch the wallets<br>that matter.</h1>
<p class="muted" style="margin: 0; font-size: 18px; max-width: 520px">A private, shared monitor for two. Read-only chain access — Sentinel never signs, broadcasts or trades.</p>
<div style="display: flex; gap: 8px; flex-wrap: wrap"><span class="pill p-line">Finalized transactions only</span><span class="pill p-line">Telegram alerts</span><span class="pill p-line">Runs on your Mac</span></div>
</section>
<form style="border: 1px solid {LINE}; border-radius: 20px; padding: 32px; display: flex; flex-direction: column; gap: 20px; background: {S1}">
<h2 class="h2">Sign in</h2>
<div role="status" style="border-radius: 12px; border: 1px solid {WARN}; padding: 12px 14px; font-size: 14px; color: #F6DFA6">Your session ended. Sign in again.</div>
<label><span class="label">Username</span><input class="field" style="background: {BG}" autocomplete="username" value="designer"></label>
<label><span class="label">Access credential</span><input class="field" style="background: {BG}" type="password" autocomplete="current-password" value="credential"></label>
<button class="cta" type="submit" style="width: 100%">Sign in</button>
<p class="hint" style="margin: 0">Use the personal credential your teammate shared or you saved during host setup.</p>
</form>
</main>
''') + tail(1440,880)

# ---------------- Mobile ----------------
def mrows():
    s=""
    for a,label,cls,st,sub in wallet_rows:
        s+=f'<a href="Wallet.dc.html" class="row" style="text-decoration: none; color: {TXT}; padding: 14px 0"><span style="display: flex; flex-direction: column; gap: 2px"><span class="mono" style="font-size: 15px">{a}</span><span class="muted" style="font-size: 12px">{sub}</span></span><span class="pill {cls}">{st}</span></a>'
    return s
tabs=[("home","Home",True),("wallet","Wallets",False),("bell","Alerts",False),("gear","Setup",False)]
tabbar="".join(f'<a href="#" style="display: flex; flex-direction: column; align-items: center; gap: 4px; text-decoration: none; color: {TXT if on else MUT}; font-size: 11px; font-weight: 600; min-width: 64px; min-height: 44px">{icon(i,22,NEON if on else MUT)}{n}</a>' for i,n,on in tabs)
mobile = head("Sentinel — Mobile home") + f'''<div class="sx" style="width: 390px; height: 844px; position: relative; overflow: hidden; display: flex; flex-direction: column">
<header style="display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 8px"><span style="display: flex; align-items: center; gap: 8px">{mark(24)}<span class="serif" style="font-size: 20px; font-weight: 600">Sentinel</span></span><button aria-label="Account menu for designer" style="width: 44px; height: 44px; border-radius: 999px; border: 0; background: #2B261E; color: {TXT}; font: 600 14px 'Geist', sans-serif">D</button></header>
<main style="padding: 8px 20px 100px; display: flex; flex-direction: column; gap: 20px; overflow: hidden">
<section style="display: flex; flex-direction: column; gap: 8px"><h1 style="margin: 0; font-size: 36px; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05">3 of 4 wallets current</h1><span style="color: {WARN}; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 6px">{icon("alert",16,WARN)}Monitoring degraded</span></section>
{chart(7,60,w=350,h=170,scrub=False)}
<div role="group" aria-label="Filter observations" style="display: flex; gap: 2px"><button class="seg seg-on" aria-pressed="true">All</button><button class="seg" aria-pressed="false">Buys</button><button class="seg" aria-pressed="false">Sells</button></div>
<section><div style="display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid {LINE}; padding-bottom: 8px"><h2 class="h2" style="font-size: 18px">Watchlist</h2><button class="txtbtn" style="color: {NEON}">Add</button></div>{mrows()}</section>
</main>
<nav aria-label="Workspace" style="position: absolute; left: 0; right: 0; bottom: 0; height: 84px; border-top: 1px solid {LINE}; background: {BG}; display: flex; justify-content: space-around; align-items: center; padding-bottom: 12px">{tabbar}</nav>
</div>
''' + tail(390,844)


chart_variants = "".join(
  f'<sc-if value="{{{{show{key}}}}}" hint-placeholder-val="{{{{{"true" if key=="All" else "false"}}}}}">{chart(7,96,show=sh)}</sc-if>'
  for key,sh in [("All",("buy","sell","fail")),("Buys",("buy",)),("Sells",("sell",))])
seg_btns = "".join(f'<button class="seg {{{{seg{k}}}}}" aria-pressed="{{{{pressed{k}}}}}" onClick="{{{{pick{k}}}}}">{lbl}</button>' for k,lbl in [("All","All"),("Buys","Buys"),("Sells","Sells")])

main = head("Sentinel — Home") + wrap(topbar("Home") + f'''<main style="max-width: 1280px; margin: 0 auto; padding: 48px 32px 96px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 64px; box-sizing: border-box">
<div style="display: flex; flex-direction: column; gap: 44px; min-width: 0">
<section aria-labelledby="hero" style="display: flex; flex-direction: column; gap: 12px">
<span class="eyebrow">Shared monitor · 4 wallets</span>
<h1 id="hero" style="margin: 0; font-size: 60px; line-height: 1; font-weight: 500; letter-spacing: -0.04em">3 of 4 wallets current</h1>
<div style="display: flex; align-items: center; gap: 10px; font-size: 16px"><span style="color: {WARN}; display: inline-flex">{icon("alert",18,WARN)}</span><span style="color: {WARN}; font-weight: 600">Monitoring degraded</span><span class="muted">· 4Nd1…mBzK is still backfilling its recent window</span></div>
</section>
<section aria-labelledby="obs" style="display: flex; flex-direction: column; gap: 14px; margin-top: -16px">
<h2 id="obs" class="sr">Observations in the recent window</h2>
<div style="position: relative">
<sc-if value="{{{{showSells}}}}" hint-placeholder-val="{{{{false}}}}"><span></span></sc-if>
{chart_variants}
<div style="position: absolute; top: 0; left: 52%; transform: translateX(-50%); background: {S1}; border: 1px solid {LINE2}; border-radius: 12px; padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; pointer-events: none">
<span class="num" style="font-size: 12px; color: {MUT}">06:12 · Slot 312,344,912</span>
<span class="num" style="font-size: 14px; font-weight: 600"><span style="color: {BAD}">SELL</span> 88.0 <span class="mono" style="font-size: 12px">JUPy…vCN</span></span>
<span class="mono muted" style="font-size: 12px">9WzD…AWWM</span>
</div>
</div>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 4px; border-top: 1px solid {LINE}">
<div role="group" aria-label="Show on chart" style="display: flex; gap: 4px; padding-top: 10px">{seg_btns}</div>
<span class="muted num" style="font-size: 12px; padding-top: 10px">04:12 → 06:49 · most recent 50 per wallet</span>
</div>
{legend()}
</section>
<section aria-labelledby="attn" style="display: flex; flex-direction: column; gap: 14px">
<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 id="attn" class="h2">Needs attention</h2><span class="muted num" style="font-size: 13px">3 items</span></div>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
{card_attn("alert",WARN,"Off-host backup copy overdue","Last copy finished 2 days ago. Run the copy on the host Mac; local backups are still verified.","How to fix","Setup.dc.html")}
{card_attn("wallet",WARN,"4Nd1…mBzK catching up","Backfilling a bounded recent window. Alerts start once its coverage is current.","View wallet","Wallet.dc.html")}
{card_attn("bell",WARN,"1 Telegram send may have arrived","The send timed out after leaving. Check Telegram before retrying to avoid a duplicate.","Review delivery","Alerts.dc.html")}
</div>
</section>
<section aria-labelledby="ks" style="display: flex; flex-direction: column">
<h2 id="ks" class="h2" style="margin-bottom: 4px">Key statistics</h2>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 32px">
{kstat("Stored observations","1,284")}{kstat("Archived","400")}{kstat("Journal capacity","62%","of retention limit")}{kstat("Pending alerts","0")}
{kstat("Trade legs","37","supported BUY/SELL")}{kstat("Unclassified","212","not proof of no trade")}{kstat("Failed","9","failed on chain")}{kstat("Wallets current","3 / 4")}
</div>
</section>
<section aria-labelledby="act" style="display: flex; flex-direction: column">
<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 id="act" class="h2">Recent activity</h2><a href="Wallet.dc.html" style="font-size: 14px; font-weight: 600; text-decoration: none">View all</a></div>
{dayhead("Today")}
{arows()}
<p class="muted" style="font-size: 12px; margin: 16px 0 0">Bounded recent window per wallet, not lifetime history. Quantities only — USD prices are unavailable. Read-only chain access; Sentinel never signs or trades.</p>
</section>
</div>
<aside aria-label="Watchlist and system" style="display: flex; flex-direction: column; gap: 20px">
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 22px 22px 8px; display: flex; flex-direction: column">
<div style="display: flex; align-items: center; justify-content: space-between"><h2 class="h2" style="font-size: 18px">Watchlist</h2><button class="cta" style="min-height: 36px; padding: 0 14px; font-size: 13px">{icon("plus",16,BG,2.2)}Add wallet</button></div>
<div role="group" aria-label="Filter watchlist" style="display: flex; gap: 4px; margin: 14px 0 4px"><button class="seg seg-on" aria-pressed="true">All 4</button><button class="seg" aria-pressed="false">Needs attention 1</button></div>
{wrows()}
</section>
<section style="border: 1px solid {LINE}; border-radius: 16px; padding: 22px; display: flex; flex-direction: column">
<h2 class="h2" style="font-size: 18px; margin-bottom: 6px">System</h2>
{health_row(OK,"Worker heartbeat","4s ago")}
{health_row(OK,"Local backup","verified 6h ago")}
{health_row(WARN,"Off-host copy","2 days ago · overdue",True)}
{health_row(OK,"Solana RPC","verified at setup")}
{health_row(OK,"Telegram bot","saved")}
{health_row(OK,"Your destination","verified · on")}
<p class="muted" style="font-size: 12px; margin: 12px 0 0">Monitoring pauses while the host Mac is asleep or offline. Updated 6s ago.</p>
</section>
</aside>
</main>
''') + tail(1440,1600)
main = main.replace("""renderVals() {
return {};
}""", """renderVals() {
const f = (this.state && this.state.filter) || 'All';
const pick = (k) => () => this.setState({ filter: k });
const v = {};
['All','Buys','Sells'].forEach((k) => {
v['show' + k] = f === k;
v['seg' + k] = f === k ? 'seg-on' : '';
v['pressed' + k] = f === k ? 'true' : 'false';
v['pick' + k] = pick(k);
});
return v;
}""")
main = main.replace('<sc-if value="{{showSells}}" hint-placeholder-val="{{false}}"><span></span></sc-if>\n','')

# ---------------- Foundations (design system) ----------------
def swatch(hexv, name, role, dark_text=False):
    tc = BG if dark_text else TXT
    return f'<div style="display: flex; flex-direction: column; gap: 8px"><div style="height: 88px; border-radius: 14px; background: {hexv}; border: 1px solid {LINE2}; display: flex; align-items: flex-end; padding: 10px; box-sizing: border-box; color: {tc}; font-size: 12px; font-weight: 600" class="mono">{hexv}</div><span style="font-weight: 600; font-size: 14px">{name}</span><span class="muted" style="font-size: 12px; line-height: 1.4">{role}</span></div>'
def typerow(spec, sample, style):
    return f'<div style="display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; align-items: baseline; padding: 16px 0; border-bottom: 1px solid {LINE}"><span class="mono muted" style="font-size: 12px">{spec}</span><span style="{style}">{sample}</span></div>'
def sect(title, body, note=""):
    n = f'<p class="muted" style="margin: 0; font-size: 13px; max-width: 760px">{note}</p>' if note else ""
    return f'<section style="display: flex; flex-direction: column; gap: 18px; padding: 40px 0; border-top: 1px solid {LINE}"><h2 class="h2">{title}</h2>{n}{body}</section>'

found = head("Sentinel — Foundations") + wrap(f'''<main style="max-width: 1280px; margin: 0 auto; padding: 56px 32px 96px; box-sizing: border-box">
<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">{mark(36)}<span class="eyebrow">Sentinel design system · v1</span></div>
<h1 class="serif" style="margin: 0 0 12px; font-size: 64px; font-weight: 500; letter-spacing: -0.02em; line-height: 1">Foundations</h1>
<p class="muted" style="margin: 0 0 24px; font-size: 18px; max-width: 720px">Quiet ground, big numbers, one electric accent. Every status is a word plus a color, never a color alone.</p>
{sect("Color", f'<div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px">{swatch(BG,"Ground","Page background. Warm near-black, never pure #000.")}{swatch(S1,"Surface","Inputs, raised panels, tooltips.")}{swatch(LINE2,"Hairline","Borders and dividers. Sections, not boxes.")}{swatch(TXT,"Ink","Primary text and the chart line.",True)}{swatch(MUT,"Muted","Secondary text. 7:1 on Ground.",True)}{swatch(NEON,"Neon","One primary action per view. Nothing else.",True)}</div><div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px">{swatch(OK,"Go","Current, verified, sent, buy.",True)}{swatch(WARN,"Caution","Degraded, overdue, catching up, may have arrived.",True)}{swatch(BAD,"Stop","Failed, error, sell, revoke.",True)}{swatch("#2B261E","Neutral","Waiting, unclassified, not configured.")}</div>', "Go and Stop differ in lightness as well as hue, and every pill carries its word.")}
{sect("Type", typerow("Geist 500 · 60/60 · -4%","3 of 4 wallets current","font-size: 60px; font-weight: 500; letter-spacing: -0.04em; line-height: 1") + typerow("Source Serif 4 500 · 44/48","Get alerts in your own Telegram.","font-family: Source Serif 4, Georgia, serif; font-size: 44px; font-weight: 500; line-height: 1.08") + typerow("Geist 600 · 22/28","Recent activity","font-size: 22px; font-weight: 600") + typerow("Geist 500 · 20 · tabular","1,284 · 62% · 3 / 4","font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums") + typerow("Geist 400 · 15/22","Bounded recent window per wallet, not lifetime history.","font-size: 15px") + typerow("Geist 600 · 13 · caps +6%","SHARED MONITOR","font-size: 13px; font-weight: 600; letter-spacing: 0.06em; color: " + MUT) + typerow("Geist Mono 400 · 15","9WzDXwBb…L9zYtAWWM","font-family: Geist Mono, monospace; font-size: 15px"), "Serif only for editorial moments (sign-in, setup steps). Numbers are always tabular so columns don’t jitter on refresh.")}
{sect("Status pills", '<div style="display: flex; flex-wrap: wrap; gap: 10px"><span class="pill p-ok">Current</span><span class="pill p-ok">Verified</span><span class="pill p-ok">Sent</span><span class="pill p-warn">Catching up</span><span class="pill p-warn">Overdue</span><span class="pill p-warn">May have arrived</span><span class="pill p-bad">Failed</span><span class="pill p-bad">Error</span><span class="pill p-neutral">Waiting</span><span class="pill p-neutral">Unclassified</span><span class="pill p-neutral">Not configured</span></div>', "Filled pills are state. Outline pills are tags. Unknown server values render as a neutral pill showing the raw value.")}
{sect("Actions", f'<div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center"><button class="cta">Create buy alert</button><button class="btn2">Rotate credential</button><button class="btn2 danger">Revoke</button><button class="txtbtn">Cancel</button><button class="seg seg-on">All</button><button class="seg">Buys</button><button class="cta" style="opacity: 0.4">Saving…</button></div>', "Neon is reserved for the single most important action on a screen. Destructive actions always confirm inline before they run.")}
{sect("Inputs", f'<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px"><label><span class="label">Wallet address</span><input class="field mono" style="font-size: 13px" placeholder="Paste a public address"><span class="hint" style="display: block">Public address only. Never a private key.</span></label><label><span class="label">Cooldown</span><input class="field num" value="60" style="border-color: {NEON}; box-shadow: 0 0 0 3px rgba(204,255,0,0.18)"><span class="hint" style="display: block">Focused</span></label><label><span class="label">HTTPS RPC endpoint</span><input class="field" value="http://rpc.example" aria-invalid="true" style="border-color: {BAD}"><span class="hint" style="display: block; color: #FF8A5C">The endpoint must start with https://</span></label></div>')}
{sect("Chart", f'<div style="display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 40px; align-items: center"><div>{chart(3,40,w=760,h=200)}</div><ul class="muted" style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.7"><li>Line = cumulative observations, a step per transaction.</li><li>Green dot = classified buy, orange = classified sell.</li><li>Diamond on the baseline = failed transaction.</li><li>Unmarked steps = unclassified, never shown as “no trade”.</li><li>No price axis. USD is never implied.</li></ul></div>')}
</main>''') + tail(1440,2380)

# ---------------- States ----------------
def phone(title, inner):
    return f'''<div style="display: flex; flex-direction: column; gap: 14px"><span class="eyebrow">{title}</span>
<div style="width: 390px; height: 760px; border: 1px solid {LINE2}; border-radius: 28px; overflow: hidden; display: flex; flex-direction: column; position: relative">
<header style="display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 6px"><span style="display: flex; align-items: center; gap: 8px">{mark(22)}<span class="serif" style="font-size: 19px; font-weight: 600">Sentinel</span></span><span style="width: 36px; height: 36px; border-radius: 999px; background: #2B261E; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600">D</span></header>
<div style="padding: 10px 20px; display: flex; flex-direction: column; gap: 18px">{inner}</div></div></div>'''
def sk(w, h, r=8): return f'<div style="width: {w}; height: {h}px; border-radius: {r}px; background: #1E1A14"></div>'

first_run = f'''<h1 style="margin: 0; font-size: 34px; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05">Watch your first wallet</h1>
<p class="muted" style="margin: 0; font-size: 15px">Paste any public Solana address. Both members will see it, and monitoring picks it up automatically.</p>
<label><span class="sr">Public wallet address</span><input class="field mono" style="font-size: 13px" placeholder="Paste a public address"></label>
<button class="cta" style="width: 100%">Watch wallet</button>
<p class="hint" style="margin: -6px 0 0">No sample wallets are ever added for you.</p>
<div style="border-top: 1px solid {LINE}; padding-top: 16px; display: flex; flex-direction: column; gap: 4px">
<div style="display: flex; justify-content: space-between"><span style="font-weight: 600">Finish setup</span><span class="muted num" style="font-size: 13px">2 of 4</span></div>
<div style="height: 6px; border-radius: 999px; background: #2B261E; overflow: hidden"><div style="width: 50%; height: 6px; background: {TXT}"></div></div>
{health_row(OK,"Solana RPC","verified")}{health_row(OK,"Telegram bot","saved")}{health_row("#4A443A","Your destination","not verified")}{health_row("#4A443A","First wallet","not added")}
</div>'''
loading = f'''{sk("70%",36)}{sk("45%",16)}{sk("100%",150,12)}
<div style="display: flex; gap: 6px">{sk("56px",32,999)}{sk("64px",32,999)}{sk("64px",32,999)}</div>
{"".join(f'<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid {LINE}"><div style="display: flex; flex-direction: column; gap: 6px">{sk("120px",14)}{sk("80px",11)}</div>{sk("84px",28,999)}</div>' for _ in range(4))}
<span class="muted" role="status" style="font-size: 13px">Connecting to your workspace…</span>'''
offline = f'''<div role="alert" style="border: 1px solid {WARN}; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px"><span style="font-weight: 600; color: {WARN}; display: inline-flex; gap: 8px; align-items: center">{icon("alert",16,WARN)}Can’t reach the host Mac</span><span style="font-size: 13px; color: #E9E4DA">Showing data from 06:49. The Mac may be asleep, restarting or offline. Retrying every 15s.</span></div>
<h1 style="margin: 0; font-size: 34px; font-weight: 500; letter-spacing: -0.035em; line-height: 1.05; color: #8F897D">3 of 4 wallets current</h1>
<span class="muted" style="font-size: 13px">Last known · may be out of date</span>
<div style="opacity: 0.45">{chart(7,60,w=350,h=150,scrub=False)}</div>
<section>{"".join(f'<div class="row" style="padding: 12px 0"><span class="mono" style="font-size: 14px; color: #8F897D">{a}</span><span class="pill p-neutral">Last: {st}</span></div>' for a,_,_,st,_ in wallet_rows)}</section>
<button class="btn2" style="width: 100%">Retry now</button>'''

states = head("Sentinel — States") + wrap(f'''<main style="max-width: 1360px; margin: 0 auto; padding: 56px 32px 72px; box-sizing: border-box; display: flex; flex-direction: column; gap: 32px">
<div><span class="eyebrow">States</span><h1 class="h2" style="font-size: 32px; margin-top: 8px">First run, loading and offline</h1><p class="muted" style="margin: 8px 0 0; font-size: 15px; max-width: 760px">Designed as carefully as the populated view. Offline keeps the last data visible but greys it out and says exactly how old it is.</p></div>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; justify-items: center">
{phone("First run · no wallets", first_run)}{phone("Loading", loading)}{phone("Offline · stale data", offline)}
</div>
</main>''') + tail(1440,1080)

files = {"Main.dc.html":main,"Wallet.dc.html":wallet,"Alerts.dc.html":alerts,"Setup.dc.html":setup,"SignIn.dc.html":signin,"Mobile.dc.html":mobile,"Foundations.dc.html":found,"States.dc.html":states}
for n,c in files.items(): (root/n).write_text(c)

canvas = {"v":3,"createdOnFiles":{"v":1,"at":"2026-10-01T07:14:22Z"},"title":"Sentinel Dashboard Redesign","launch":{"view":"canvas"},"pages":[],
 "boards":{
  "Main.dc.html":{"x":0,"y":0,"w":1440,"h":1600,"title":"Home","expand":"fill","is_interactive":True},
  "Wallet.dc.html":{"x":1520,"y":0,"w":1440,"h":1560,"title":"Wallet detail + create alert","expand":"fill"},
  "Alerts.dc.html":{"x":3040,"y":0,"w":1440,"h":1040,"title":"Alerts + Telegram deliveries","expand":"fill"},
  "Setup.dc.html":{"x":0,"y":1720,"w":1440,"h":1260,"title":"Setup + team access","expand":"fill"},
  "SignIn.dc.html":{"x":1520,"y":1720,"w":1440,"h":880,"title":"Sign in (session expired)","expand":"fill"},
  "Mobile.dc.html":{"x":3040,"y":1720,"w":390,"h":844,"title":"Phone · Home"},
  "Foundations.dc.html":{"x":0,"y":3100,"w":1440,"h":2380,"title":"Foundations","expand":"fill"},
  "States.dc.html":{"x":1520,"y":3100,"w":1440,"h":1080,"title":"States: first run, loading, offline","expand":"fill"}},
 "order":["Main.dc.html","Wallet.dc.html","Alerts.dc.html","Setup.dc.html","SignIn.dc.html","Mobile.dc.html","Foundations.dc.html","States.dc.html"],
 "notes":{
  "t1":{"x":0,"y":-300,"text":"Sentinel — Robinhood-inspired redesign","kind":"title1","maxW":4480},
  "n1":{"x":3530,"y":1720,"w":420,"text":"All numbers, addresses and alerts on these boards are SAMPLE values for layout only. The live app shows only API data; nothing here maps to a new backend field.","fill":"orange"}},
 "designSystems":[]}
(root/"canvas.json").write_text(json.dumps(canvas, indent=1))
print("ok", {n: len(c) for n,c in files.items()})
