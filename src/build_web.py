import re, subprocess, sys

lines = open('Launcher.html', encoding='utf-8').read().split('\n')  # 0-indexed list

# ---- 1) JS surgery: replace desktop download/self-update engine (formatting..startRecheck)
#         with tiny no-op stubs for the few functions still called by kept UI code.
stubs = (
"// ---- desktop engine removed for web build; stubs keep the web UI wired -----\n"
"function gateButtons(){}\n"
"function applyState(){}\n"
"function checkStatus(){}\n"
"function tick(){}\n"
"function startRecheck(){}\n"
"function maybeAutoUpdate(){}\n"
"function repairFiles(){}\n"
"function startDownload(){}\n"
"function launchGame(){}\n"
"function runUpdate(){}\n"
"function cancelDownload(){}\n"
)

# ---- locate the engine + handleError regions by MARKER, not hard-coded line numbers.
def _find(pred, desc):
    for i, ln in enumerate(lines):
        if pred(ln): return i
    sys.exit('build_web: could not locate ' + desc)
eng_start = _find(lambda l: l.startswith('// ---- formatting'), 'engine block start (// ---- formatting)')
eng_end   = _find(lambda l: l.startswith('function startRecheck('), 'engine block end (startRecheck)')
he_fn     = _find(lambda l: l.startswith('function handleError('), 'handleError')
he_end    = next((j for j in range(he_fn, len(lines)) if lines[j] == '}'), -1)
if he_end < 0: sys.exit('build_web: could not find end of handleError')

# Apply JS edits bottom-to-top so earlier line numbers stay valid.
# handleError (blank + fn) is only called by the removed engine -> drop it.
del lines[he_fn-1 : he_end+1]     # blank + handleError fn
# engine block (formatting .. startRecheck) -> stubs
lines[eng_start : eng_end+1] = [stubs]

s = '\n'.join(lines)

# =====================================================================
#  DRAGON-NIGHT-MAGIC website theme + new markup (all injected here;
#  Launcher.html is NEVER edited). The launcher's own DOM is inherited,
#  so every element id + the gnd-news-data island stay intact and all
#  features (login, store buy, admin, bans, news, email codes) keep
#  working — this only changes the LOOK and adds a Home hero + footer.
# =====================================================================
RELEASE_URL = ("https://github.com/GrigoriNight/GrigoriNightDragon-Launcher-Tauri/"
               "releases/download/latest-build/GrigoriNightDragon-Setup.exe")

THEME_CSS = """<style id="gnd-web">
:root{--gnd-bg:#09090b;--gnd-red:#e11d2a;--gnd-red2:#ff3b4e;--gnd-violet:#7c3aed;--gnd-vi2:#a78bfa}
#gnd-launcher{background:radial-gradient(1200px 620px at 82% -12%,rgba(124,58,237,.18),transparent 60%),radial-gradient(900px 520px at 8% -4%,rgba(225,29,42,.16),transparent 55%),var(--gnd-bg)!important;font-family:ui-sans-serif,system-ui,Arial,sans-serif}
/* turn the launcher's fixed-viewport flex layout into a scrolling document */
#gnd-launcher .flex-1.flex.overflow-hidden{display:block!important;overflow:visible!important}
#gnd-launcher .ovf{overflow:visible!important;height:auto!important;background:transparent!important}
#gnd-launcher #view-play{min-height:auto}
#gnd-launcher #view-play .relative.z-10{height:auto!important;overflow:visible!important;min-height:80vh;justify-content:center;gap:2rem}
#gnd-launcher .ovf>*{max-width:1150px;margin-left:auto;margin-right:auto}
/* sticky glowing nav */
#gnd-launcher .gnd-nav{position:sticky;top:0;z-index:40;background:rgba(7,7,9,.82)!important;backdrop-filter:blur(12px);border-bottom:1px solid rgba(124,58,237,.28)!important;box-shadow:0 10px 34px rgba(0,0,0,.55)}
#gnd-launcher .gnd-nav [id^=tab-]{color:#cbd5e1;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem}
#gnd-launcher .gnd-nav [id^=tab-]:hover{color:#fff;text-shadow:0 0 12px rgba(225,29,42,.85)}
/* hero title: red -> violet gradient with dragon glow */
#gnd-launcher #view-play h1{font-size:clamp(2.6rem,7vw,5.4rem);line-height:1.02;letter-spacing:.01em;background:linear-gradient(92deg,#fff 0%,#ffd7db 18%,var(--gnd-red2) 55%,var(--gnd-vi2) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 26px rgba(225,29,42,.45))}
#gnd-launcher #view-play h1 .text-red-500{color:transparent}
/* buttons */
#gnd-launcher .gnd-btn{display:inline-flex;align-items:center;gap:.6rem;padding:1rem 2.1rem;border-radius:.9rem;font-weight:800;text-transform:uppercase;letter-spacing:.14em;font-size:.82rem;transition:.18s;cursor:pointer;border:none}
#gnd-launcher .gnd-btn-primary{color:#fff;background:linear-gradient(92deg,var(--gnd-red),#ff6a3d);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 12px 40px rgba(225,29,42,.45),0 0 28px rgba(225,29,42,.35)}
#gnd-launcher .gnd-btn-primary:hover{filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 0 0 1px rgba(255,255,255,.12),0 18px 55px rgba(225,29,42,.6),0 0 44px rgba(225,29,42,.55)}
#gnd-launcher .gnd-btn-ghost{color:#e9d5ff;background:rgba(124,58,237,.08);border:1px solid rgba(167,139,250,.5);box-shadow:inset 0 0 22px rgba(124,58,237,.22)}
#gnd-launcher .gnd-btn-ghost:hover{background:rgba(124,58,237,.18);border-color:var(--gnd-vi2);transform:translateY(-2px)}
/* cards: launcher store cards (.cd) + new feature cards */
#gnd-launcher .cd,#gnd-launcher .gnd-feat{background:linear-gradient(180deg,rgba(124,58,237,.09),rgba(9,9,11,.6))!important;border:1px solid rgba(167,139,250,.22)!important;border-radius:1rem!important;transition:.18s}
#gnd-launcher .cd:hover,#gnd-launcher .gnd-feat:hover{border-color:var(--gnd-red)!important;box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 26px rgba(225,29,42,.28);transform:translateY(-3px)}
#gnd-launcher .gnd-feat{padding:1.6rem}
#gnd-launcher .gnd-feat .ic{font-size:1.9rem;filter:drop-shadow(0 0 14px rgba(225,29,42,.6))}
#gnd-launcher .gnd-feat h3{margin-top:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;font-size:.95rem}
#gnd-launcher .gnd-feat p{margin-top:.4rem;color:#9aa3b2;font-size:.85rem;line-height:1.5}
/* section headings inside news/store/support */
#gnd-launcher .ovf h1{background:linear-gradient(92deg,#fff,#ffb3ba,var(--gnd-vi2));-webkit-background-clip:text;background-clip:text;color:transparent}
/* give any red gradient (store BUY etc.) a subtle glow */
#gnd-launcher [class*=from-red-]{box-shadow:0 8px 26px rgba(225,29,42,.32)}
/* themed modals */
.mdc,#gnd-launcher .mdc{background:#0b0b12!important;border:1px solid rgba(167,139,250,.28)!important;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 40px rgba(124,58,237,.15)!important}
/* dark dragon scrollbars */
#gnd-launcher ::-webkit-scrollbar{width:10px;height:10px}
#gnd-launcher ::-webkit-scrollbar-thumb{background:linear-gradient(var(--gnd-red),var(--gnd-violet));border-radius:8px}
#gnd-launcher ::-webkit-scrollbar-track{background:#0b0b12}
/* slim themed status strip */
#gnd-launcher .h-10.border-t{background:rgba(7,7,9,.9)!important;border-top:1px solid rgba(124,58,237,.2)!important}
/* footer */
#gnd-launcher .gnd-footer{border-top:1px solid rgba(124,58,237,.28);background:linear-gradient(180deg,rgba(9,9,11,.35),#050507);padding:3rem 2rem 2.4rem}
#gnd-launcher .gnd-footer .wrap{max-width:1150px;margin:0 auto;display:flex;flex-wrap:wrap;gap:1.4rem;align-items:center;justify-content:space-between}
#gnd-launcher .gnd-footer .brand{display:flex;align-items:center;gap:.7rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
#gnd-launcher .gnd-footer .brand .dot{color:var(--gnd-red);filter:drop-shadow(0 0 10px rgba(225,29,42,.85))}
#gnd-launcher .gnd-footer nav{display:flex;gap:1.3rem;flex-wrap:wrap}
#gnd-launcher .gnd-footer nav button{color:#c7cad3;font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;background:none;border:none;cursor:pointer}
#gnd-launcher .gnd-footer nav button:hover{color:#fff;text-shadow:0 0 12px rgba(124,58,237,.9)}
#gnd-launcher .gnd-footer .cr{color:#6b7280;font-size:.72rem;width:100%;text-align:center;margin-top:1.4rem}
</style>"""

HERO_HTML = ("""    <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:.4rem">
      <a href=\"""" + RELEASE_URL + """\" target="_blank" rel="noopener" class="gnd-btn gnd-btn-primary">&#11015; Download for PC</a>
      <button onclick="showTab('news')" class="gnd-btn gnd-btn-ghost">&#9654; Read the News</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1.1rem;margin-top:2.6rem;max-width:980px;width:100%">
      <div class="gnd-feat"><div class="ic">&#9876;&#65039;</div><h3>Endless Combat</h3><p>Evolving bosses, guild wars, and legendary loot await in the night.</p></div>
      <div class="gnd-feat"><div class="ic">&#128302;</div><h3>Arcane Magic</h3><p>Master night-forged spells and bend the dark to your will.</p></div>
      <div class="gnd-feat"><div class="ic">&#128050;</div><h3>Hunt Dragons</h3><p>Track legendary dragons across a living MMORPG world.</p></div>
    </div>""")

FOOTER_HTML = """<footer class="gnd-footer"><div class="wrap">
  <div class="brand"><span class="dot">&#128009;</span> GrigoriNightDragon</div>
  <nav>
    <button onclick="showTab('play')">Home</button>
    <button onclick="showTab('news')">News</button>
    <button onclick="showTab('store')">Store</button>
    <button onclick="showTab('support')">Support</button>
    <button onclick="openAccount()">Sign In</button>
  </nav>
  <div class="cr">&copy; 2026 GrigoriNightDragon &mdash; a dark-fantasy MMORPG of dragons, magic &amp; night.</div>
</div></footer>"""

# ---- 2) strip the full-document wrapper so it injects inside GoDaddy's <body>,
#         and go FULL-WIDTH with natural page scroll (was a boxed 1000px panel).
s = s.replace('<script src="bridge.js"></script>', '')   # desktop-only bridge; would 404 on web
s = s.replace('<!DOCTYPE html>', '')
s = re.sub(r'<html[^>]*>', '', s, count=1)
s = s.replace('</html>', '')
s = s.replace('<head>', '').replace('</head>', '')       # keeps CDN scripts + <style> inside
s = re.sub(r'<meta[^>]*>', '', s)
s = re.sub(r'<title>.*?</title>', '', s, flags=re.S)

# full-width wrapper + inject the dragon-night-magic theme right after it opens
s = re.sub(r'<body[^>]*>',
  '<div id="gnd-launcher" class="bg-black text-white" '
  'style="position:relative;width:100%;min-height:100vh;overflow-x:hidden">' + THEME_CSS,
  s, count=1)
# footer + close the wrapper
s = s.replace('</body>', FOOTER_HTML + '</div>')
# inner column: flow instead of fixed 100vh viewport
s = s.replace('<div class="h-screen flex flex-col">',
              '<div class="flex flex-col" style="min-height:100vh">', 1)

# nav: add a styling hook + rename the "Play" tab to "Home"
s = s.replace(
  '<div class="h-20 flex items-center justify-between px-8 border-b border-white/10 bg-black/60 backdrop-blur-md">',
  '<div class="h-20 flex items-center justify-between px-8 border-b border-white/10 bg-black/60 backdrop-blur-md gnd-nav">', 1)
s = s.replace(
  '<button id="tab-play"    onclick="showTab(\'play\')">Play</button>',
  '<button id="tab-play"    onclick="showTab(\'play\')">Home</button>', 1)

# Home hero: replace the desktop progress/install card (content-anchored, NOT line
# numbers) with the download CTA + feature cards. Keeps h1, tagline, maintBanner.
s = re.sub(
  r'<div class="bg-black/60 border border-white/10 rounded-2xl p-6 backdrop-blur-xl max-w-3xl">'
  r'.*?Sign in \(top-right\) to install and play\.</div>\s*</div>',
  HERO_HTML, s, count=1, flags=re.S)

# Remove the launcher self-update overlay (content-anchored). SAFE: every reference to
# updateFace/ufBar/etc. lives inside the engine block that was replaced by stubs above,
# so no kept code touches it. (The old numeric `del lines[156:171]` had drifted stale
# and would have destroyed the status bar.)
s = re.sub(r'<!-- LAUNCHER UPDATE FACE.*?id="updateRefreshBtn".*?</button>\s*</div>',
           '', s, count=1, flags=re.S)

# ---- 3) split main <script>, minify JS with terser, re-escape </script>, min HTML.
m = re.search(r'<script(?![^>]*\bsrc=)[^>]*>', s)
open_start, body_start = m.start(), m.end()
close_pos = s.rindex('</script>')
prefix, js_body, suffix = s[:open_start], s[body_start:close_pos], s[close_pos+len('</script>'):]

open('.jsbody.js', 'w', encoding='utf-8').write(js_body)
r = subprocess.run(['npx','--yes','terser','.jsbody.js','-c','-m'], capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit('terser failed (JS syntax error after trim)')
js_min = r.stdout.replace('</script>', '<\\/script>')

open('.prefix.html', 'w', encoding='utf-8').write(prefix)
subprocess.run(['npx','--yes','html-minifier-terser','--collapse-whitespace','--remove-comments',
                '--remove-redundant-attributes','--minify-css','-o','.prefix.min.html','.prefix.html'],
               capture_output=True, text=True)
prefix_min = open('.prefix.min.html', encoding='utf-8').read() or prefix

out = prefix_min + '<script>' + js_min + '</script>' + suffix.strip()
open('Launcher.godaddy.html', 'w', encoding='utf-8').write(out)
print('js body:', len(js_body), '->', len(js_min))
print('prefix :', len(prefix), '->', len(prefix_min))
print('TOTAL  :', len(out), 'chars')

# Optional one-step publish to the public gnd-news repo (build + ship in one go).
# Needs $GITHUB_TOKEN in the environment; push_web.py never reads a token from disk.
if '--publish' in sys.argv:
    subprocess.run([sys.executable, 'push_web.py'])
