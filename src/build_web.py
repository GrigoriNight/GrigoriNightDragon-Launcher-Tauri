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

# ---- locate the two lower edit regions by MARKER, not hard-coded line numbers:
#      store/admin code added above them shifts these anchors (and by different
#      amounts, since pollLive sits between the engine block and handleError).
#      The two TOP regions (overlay, Play card) are untouched by those edits and
#      stay numeric.
def _find(pred, desc):
    for i, ln in enumerate(lines):
        if pred(ln): return i
    sys.exit('build_web: could not locate ' + desc)
eng_start = _find(lambda l: l.startswith('// ---- formatting'), 'engine block start (// ---- formatting)')
eng_end   = _find(lambda l: l.startswith('function startRecheck('), 'engine block end (startRecheck)')
he_fn     = _find(lambda l: l.startswith('function handleError('), 'handleError')
he_end    = next((j for j in range(he_fn, len(lines)) if lines[j] == '}'), -1)
if he_end < 0: sys.exit('build_web: could not find end of handleError')

# Apply edits bottom-to-top so earlier line numbers stay valid.
# handleError (blank + fn) is only called by the removed engine -> drop it.
del lines[he_fn-1 : he_end+1]     # blank + handleError fn
# engine block (formatting .. startRecheck) -> stubs
lines[eng_start : eng_end+1] = [stubs]
# updateFace self-update overlay -> gone
del lines[156:171]                # blank + overlay (0-idx 156..170)
# Play action card (orig 75..93: progress bar + install/play/update/repair/cancel) -> CTA
cta = (
'    <div class="max-w-3xl">\n'
'      <a href="https://github.com/GrigoriNight/GrigoriNightDragon-Launcher-Tauri/releases/download/latest-build/GrigoriNightDragon-Setup.exe" target="_blank" rel="noopener" '
'class="inline-block bg-gradient-to-r from-red-700 to-orange-500 '
'px-8 py-4 rounded-xl font-bold uppercase tracking-widest hover:brightness-110">Download the Launcher</a>\n'
'      <p class="text-xs text-gray-400 mt-3">Get the desktop launcher to install and play the game.</p>\n'
'    </div>'
)
lines[75:94] = [cta]              # 0-idx 75..93

s = '\n'.join(lines)

# ---- 2) strip full-document wrapper so it injects inside GoDaddy's <body>,
#         and box the app to a fixed height instead of full-screen.
s = s.replace('<script src="bridge.js"></script>', '')   # desktop-only bridge; would 404 on web
s = s.replace('<!DOCTYPE html>', '')
s = re.sub(r'<html[^>]*>', '', s, count=1)
s = s.replace('</html>', '')
s = s.replace('<head>', '').replace('</head>', '')
s = re.sub(r'<meta[^>]*>', '', s)
s = re.sub(r'<title>.*?</title>', '', s, flags=re.S)
s = re.sub(r'<body[^>]*>',
  '<div id="gnd-launcher" class="bg-black text-white" '
  'style="position:relative;height:min(1000px,100vh);max-width:100%;overflow:hidden;border-radius:12px">',
  s, count=1)
s = s.replace('</body>', '</div>')
s = s.replace('<div class="h-screen flex flex-col">',
              '<div class="flex flex-col" style="height:100%">', 1)

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
