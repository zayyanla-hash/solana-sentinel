import json
src=open("gen.py").read()
exec(src[:src.index("# ---------------- Main (Home) ----------------")])
from pathlib import Path

INK=TXT
# --- marks (viewBox 64x64) ---
def helm(fg=INK, slit=NEON, bg=None):
    return (f'<path d="M14 18 C14 9 22 5 32 5 C42 5 50 9 50 18 V42 C50 51 42 56 32 59 C22 56 14 51 14 42 Z" fill="{fg}"></path>'
            f'<rect x="18" y="25" width="28" height="5" rx="2.5" fill="{slit}"></rect>'
            f'<rect x="30.5" y="30" width="3" height="22" rx="1.5" fill="{bg or BG}"></rect>'
            + "".join(f'<circle cx="{x}" cy="{y}" r="1.6" fill="{bg or BG}"></circle>' for x,y in [(38,38),(42,38),(38,43),(42,43),(38,48)]))
def knight(fg=INK, eye=NEON, bg=None):
    return (f'<path d="M19 58 H47 V52 H19 Z" fill="{fg}"></path>'
            f'<path d="M22 49 C22 41 27 37 29 33 L19 31 C16 30 15 27 17 25 L29 11 L31 5 L35 10 C44 13 49 22 48 34 L46 49 Z" fill="{fg}"></path>'
            f'<circle cx="30" cy="18" r="2.6" fill="{eye}"></circle>'
            f'<path d="M36 14 L42 20" stroke="{bg or BG}" stroke-width="2" stroke-linecap="round"></path>')
def shield(fg=INK, eye=NEON, bg=None):
    return (f'<path d="M32 4 L53 11 V29 C53 44 44 54 32 60 C20 54 11 44 11 29 V11 Z" fill="{fg}"></path>'
            f'<path d="M18 30 C22 23 27 20 32 20 C37 20 42 23 46 30 C42 37 37 40 32 40 C27 40 22 37 18 30 Z" fill="{bg or BG}"></path>'
            f'<circle cx="32" cy="30" r="5" fill="{eye}"></circle>')
def tower(fg=INK, slit=NEON, bg=None):
    return (f'<path d="M16 6 H23 V12 H28.5 V6 H35.5 V12 H41 V6 H48 V20 L44 24 V58 H20 V24 L16 20 Z" fill="{fg}"></path>'
            f'<rect x="29" y="26" width="6" height="14" rx="3" fill="{slit}"></rect>'
            f'<path d="M27 58 V50 C27 47 29 45 32 45 C35 45 37 47 37 50 V58 Z" fill="{bg or BG}"></path>')
def svg(inner, size, label=None):
    a = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" {a}>{inner}</svg>'

def option(letter, name, fn, why, rec=False):
    badge = f'<span class="pill" style="background: {NEON}; color: {BG}">Recommended</span>' if rec else ""
    sizes = "".join(f'<div style="display: flex; flex-direction: column; align-items: center; gap: 6px"><div style="width: 64px; height: 64px; display: flex; align-items: center; justify-content: center">{svg(fn(),s)}</div><span class="mono muted" style="font-size: 11px">{s}px</span></div>' for s in (48,32,20,16))
    return f'''<article style="border: 1px solid {"#CCFF00" if rec else LINE}; border-radius: 20px; padding: 28px; display: flex; flex-direction: column; gap: 20px; min-width: 0">
<div style="display: flex; align-items: center; justify-content: space-between"><span class="eyebrow">Option {letter}</span>{badge}</div>
<div style="height: 220px; border-radius: 14px; background: {S1}; display: flex; align-items: center; justify-content: center">{svg(fn(bg=S1),150,f"{name} mark")}</div>
<div style="display: flex; flex-direction: column; gap: 6px"><h2 class="h2" style="font-size: 20px">{name}</h2><p class="muted" style="margin: 0; font-size: 14px; line-height: 1.5">{why}</p></div>
<div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 16px; border-top: 1px solid {LINE}">{sizes}</div>
</article>'''

def lockup(fn, size, word):
    return f'<div style="display: flex; align-items: center; gap: {size*0.32:.0f}px">{svg(fn(), size, "Sentinel logo")}<span class="serif" style="font-size: {word}px; font-weight: 600; letter-spacing: -0.01em; color: {TXT}">Sentinel</span></div>'

def appicon(fn, size, bgc, fg, accent, radius):
    return f'<div style="width: {size}px; height: {size}px; border-radius: {radius}px; background: {bgc}; display: flex; align-items: center; justify-content: center; flex-shrink: 0">{svg(fn(fg=fg, slit=accent, bg=bgc) if fn in (helm,tower) else fn(fg=fg, eye=accent, bg=bgc), int(size*0.66))}</div>'

body = f'''<main style="max-width: 1360px; margin: 0 auto; padding: 56px 32px 80px; box-sizing: border-box; display: flex; flex-direction: column; gap: 40px">
<div><span class="eyebrow">Brand mark</span><h1 class="serif" style="margin: 8px 0 8px; font-size: 56px; font-weight: 500; letter-spacing: -0.02em; line-height: 1">A guard that watches, never trades.</h1><p class="muted" style="margin: 0; font-size: 16px; max-width: 760px">Four directions. Each is one solid ink shape with a single neon detail, the same rule the product uses: neon marks the one thing that matters.</p></div>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px">
{option("A","Great helm",helm,"A knight’s closed helm seen head-on. The neon visor slit is the “watching” moment. Strong at 16px because the slit is the only detail that has to survive.",True)}
{option("B","Knight piece",knight,"The chess knight: strategy and patience. Instantly read as “knight”, but busier at small sizes and closer to generic chess branding.")}
{option("C","Watchful shield",shield,"Protection plus observation. Evolves the current eye mark into a shield. Calm and trustworthy, less distinctive than the helm.")}
{option("D","Watchtower",tower,"A literal sentinel post with a lit window. Architectural and steady; reads more “security product” than “person on guard”.")}
</div>
<section style="display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 20px">
<div style="border: 1px solid {LINE}; border-radius: 20px; padding: 40px; display: flex; flex-direction: column; gap: 36px">
<span class="eyebrow">Option A · lockups</span>
{lockup(helm,72,64)}
<div style="display: flex; gap: 48px; align-items: center; flex-wrap: wrap">{lockup(helm,36,28)}{lockup(helm,24,19)}</div>
<div style="border-radius: 14px; background: #F4F1EA; padding: 28px 32px; display: flex; align-items: center; gap: 22px"><svg width="56" height="56" viewBox="0 0 64 64" role="img" aria-label="Sentinel logo on light">{helm(fg=BG, slit="#5C7A00", bg="#F4F1EA")}</svg><span class="serif" style="font-size: 48px; font-weight: 600; color: {BG}">Sentinel</span></div>
<p class="muted" style="margin: 0; font-size: 13px">On light grounds the slit darkens to olive #5C7A00 — neon on cream fails contrast.</p>
</div>
<div style="border: 1px solid {LINE}; border-radius: 20px; padding: 40px; display: flex; flex-direction: column; gap: 28px">
<span class="eyebrow">App icon · favicon</span>
<div style="display: flex; gap: 20px; align-items: flex-end; flex-wrap: wrap">
{appicon(helm,120,BG,INK,NEON,28)}{appicon(helm,120,NEON,BG,BG,28)}
</div>
<div style="display: flex; gap: 16px; align-items: center">
{appicon(helm,64,BG,INK,NEON,14)}{appicon(helm,40,BG,INK,NEON,9)}{appicon(helm,32,BG,INK,NEON,7)}{appicon(helm,16,BG,INK,NEON,3)}
</div>
<div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px" class="muted">
<span>Dark tile is the default favicon and home-screen icon.</span>
<span>Neon tile is for marketing only — never inside the product, where neon is reserved for the primary action.</span>
<span>Clear space: half the mark’s width on every side. Minimum size 16px.</span>
</div>
</div>
</section>
</main>'''
logo = head("Sentinel — Logo") + wrap(body) + tail(1440,1500)
out=Path("design/project"); (out/"Logo.dc.html").write_text(logo)
c=json.load(open("artifact-files/8187996b-9b24-4e45-981c-f5aea79b444b/project/canvas.json"))
c["boards"]["Logo.dc.html"]={"x":3040,"y":3100,"w":1440,"h":1500,"title":"Logo: knight / sentinel marks","expand":"fill"}
c["order"].append("Logo.dc.html")
json.dump(c,open(out/"canvas.json","w"),indent=2)
print(len(logo))
