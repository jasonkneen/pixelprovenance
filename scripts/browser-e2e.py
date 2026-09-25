"""Real-browser end-to-end check (Chromium via Python Playwright).

Covers what jsdom cannot: carriers composited by a real browser, CLI decoding of
real 1x/2x screenshots, the drop-in crop flow, and the cluso-inspector plugin.

    npm run build:lib && python3 scripts/browser-e2e.py

Needs Collecting playwright
  Downloading playwright-1.63.0-py3-none-macosx_11_0_arm64.whl.metadata (3.3 kB)
Collecting pyee<14,>=13 (from playwright)
  Downloading pyee-13.0.1-py3-none-any.whl.metadata (3.0 kB)
Collecting greenlet<4.0.0,>=3.1.1 (from playwright)
  Downloading greenlet-3.5.6-cp313-cp313-macosx_11_0_universal2.whl.metadata (3.8 kB)
Collecting typing-extensions (from pyee<14,>=13->playwright)
  Downloading typing_extensions-4.16.0-py3-none-any.whl.metadata (3.3 kB)
Downloading playwright-1.63.0-py3-none-macosx_11_0_arm64.whl (42.9 MB)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 42.9/42.9 MB 45.2 MB/s  0:00:00
Downloading greenlet-3.5.6-cp313-cp313-macosx_11_0_universal2.whl (294 kB)
Downloading pyee-13.0.1-py3-none-any.whl (15 kB)
Downloading typing_extensions-4.16.0-py3-none-any.whl (45 kB)
Installing collected packages: typing-extensions, greenlet, pyee, playwright

Successfully installed greenlet-3.5.6 playwright-1.63.0 pyee-13.0.1 typing-extensions-4.16.0. The cluso part
uses ../cluso-inspector/cluso-inspector.js (or ) and is skipped
when it is missing.
"""
import json, os, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

PP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLUSO_PATH = os.environ.get('CLUSO_INSPECTOR', os.path.join(os.path.dirname(PP), 'cluso-inspector', 'cluso-inspector.js'))
CLUSO = open(CLUSO_PATH).read() if os.path.exists(CLUSO_PATH) else None
PLUGIN = open(f'{PP}/dist/pixelprovenance-cluso.js').read()
OUT = tempfile.mkdtemp()
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS' if cond else 'FAIL'), name, '' if cond else extra)

PAGE = """<!doctype html><html><head><style>
 body{font:15px system-ui;background:#f7f6f2;color:#222}
 .card{position:relative;width:520px;padding:24px;margin:20px;background:#fff;border:1px solid #ddd}
 .chip{display:inline-block;width:180px;height:90px;background:#eef1ff}
 ul{list-style:none;padding:0} li{height:70px;margin:6px 0;background:#fafafa;border:1px solid #eee}
 .abs{position:absolute;right:8px;top:8px}
</style></head><body data-pp-page="shop">
<section class="card" data-pp="card" data-pp-source="src/Card.tsx:12:5"><h2>Card title</h2>
  <span class="chip" data-pp="chip" data-pp-source="src/Chip.tsx:4:3"></span>
  <img data-pp="avatar" width="48" height="48" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <span class="abs" id="abs">x</span>
  <ul data-pp="list"><li data-pp="row">one</li><li data-pp="row">two</li><li data-pp="row" data-pp-key="k3">three</li></ul>
</section></body></html>"""

def decode(png_path, registry, scale):
    reg = os.path.join(OUT, 'reg.json'); json.dump(registry, open(reg, 'w'))
    r = subprocess.run(['npx', 'tsx', 'decoder/decode.ts', png_path, '--registry', reg, '--scale', str(scale), '--json'], cwd=PP, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else [], r.stderr

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for dpr in ((1, 2) if CLUSO else ()):
        page = browser.new_page(device_scale_factor=dpr, viewport={'width': 900, 'height': 900})
        page.set_content(PAGE)
        before = page.evaluate("document.querySelector('.card').outerHTML")
        abs_before = page.evaluate("JSON.stringify(document.getElementById('abs').getBoundingClientRect())")
        page.add_script_tag(content=PLUGIN)      # plugin first: exercises the queue
        page.add_script_tag(content=CLUSO)
        page.evaluate("window.__sent=[]; ClusoInspector.init({persist:false, immediate:false, transport:(p)=>{__sent.push(p)}})")
        page.wait_for_timeout(300)
        tag = f'[{dpr}x] '
        check(tag+'plugin registered through queue', page.evaluate("ClusoInspector.plugins").count('pixelprovenance') == 1)
        check(tag+'camera button and Settings row both on', page.evaluate("!ClusoInspector.instance.ui.bar.querySelector('[data-plugin=pixelprovenance]')") and page.evaluate("ClusoInspector.instance.ui.bCam.classList.contains('on')") and page.evaluate("ClusoInspector.instance.ui.plugset.querySelector('[data-plugin=pixelprovenance] input').checked"))
        check(tag+'carrier toggle lives in settings and is on', page.evaluate("ClusoInspector.instance.ui.plugset.querySelector('[data-plugin=pixelprovenance] input').checked"))
        check(tag+'host markup untouched', page.evaluate("document.querySelector('.card').outerHTML") == before)
        check(tag+'absolute child keeps its containing block', page.evaluate("JSON.stringify(document.getElementById('abs').getBoundingClientRect())") == abs_before)
        paths = page.evaluate("[...document.querySelectorAll('[data-pp-signal-layer] [data-pixelprovenance-path]')].map(t=>t.getAttribute('data-pixelprovenance-path'))")
        check(tag+'carriers for every tag incl. <img> and indexed rows', sorted(paths) == sorted(['shop/card','shop/card/chip','shop/card/avatar','shop/card/list','shop/card/list/row[0]','shop/card/list/row[1]','shop/card/list/row[k3]']), paths)

        # describe hook
        page.evaluate("ClusoInspector.instance.add({selector:'.chip', text:'chip', send:false})")
        t = page.evaluate("ClusoInspector.instance.toJSON().comments[0].targets[0]")
        check(tag+'target carries pp path + authored source', t.get('pixelprovenance', {}).get('path') == 'shop/card/chip' and t.get('source', {}).get('file') == 'src/Chip.tsx', t.get('source'))
        page.evaluate("ClusoInspector.instance.send()")
        sent = page.evaluate("__sent[0]")
        check(tag+'markdown names the pp path', 'pixelprovenance: shop/card/chip (src/Chip.tsx:4:3)' in sent['markdown'])
        registry = sent['pixelprovenance']['registry']
        check(tag+'payload ships the codebook', len(registry) == 7 and all(r['patternVersion'] == 2 for r in registry))

        # region comment → DOM subject
        page.evaluate("""() => { const r = document.querySelector('.chip').getBoundingClientRect();
          return ClusoInspector.instance._create({type:'region', region:{x:r.left+10,y:r.top+10,w:60,h:40,pageX:r.left+10+scrollX,pageY:r.top+10+scrollY}, targets:[]}, 'region', false) }""")
        sub = page.evaluate("ClusoInspector.instance.comments[1].pixelprovenance")
        check(tag+'region comment names the chip', sub and sub['subject'] and sub['subject']['path'] == 'shop/card/chip', sub)

        # late tag gets a carrier
        page.evaluate("const d=document.createElement('div'); d.setAttribute('data-pp','late'); d.style.cssText='width:200px;height:100px'; document.body.append(d)")
        page.wait_for_timeout(400)
        check(tag+'late-added tag gets a carrier', page.evaluate("!!document.querySelector('[data-pixelprovenance-path=\"shop/late\"]')"))

        # REAL screenshots decoded by the CLI
        page.evaluate("ClusoInspector.instance.disable(); ClusoInspector.instance.enable()")  # keep carriers (plugin re-syncs)
        page.evaluate("document.getElementById('cluso-inspector-host').style.visibility='hidden'")
        for name, sel, expect in [('chip', '.chip', 'shop/card/chip'), ('row two', 'li:nth-child(2)', 'shop/card/list/row[1]'), ('row key', 'li:nth-child(3)', 'shop/card/list/row[k3]')]:
            box = page.evaluate(f"(()=>{{const r=document.querySelector('{sel}').getBoundingClientRect();return {{x:r.left+5,y:r.top+5,width:Math.min(r.width,200)-10,height:r.height-10}}}})()")
            png = os.path.join(OUT, f'{dpr}-{name}.png'); page.screenshot(path=png, clip=box)
            res, err = decode(png, registry, dpr)
            top = res[0] if res else {}
            check(tag+f'real screenshot decodes {name}', top.get('path') == expect, f"got {[ (r['path'], round(r['score'],3)) for r in res[:3]]} {err[-200:]}")
        # whole-card screenshot: card must be among matches
        box = page.evaluate("(()=>{const r=document.querySelector('.card').getBoundingClientRect();return {x:r.left+2,y:r.top+2,width:300,height:72}})()")
        png = os.path.join(OUT, f'{dpr}-title.png'); page.screenshot(path=png, clip=box)
        res, err = decode(png, registry, dpr)
        check(tag+'real screenshot of card heading decodes card', res and res[0]['path'] == 'shop/card', [(r['path'], round(r['score'],3)) for r in res[:3]])
        page.close()

    # Drop-in toolbar: real crop through the UI
    for dpr in (1, 2):
        page = browser.new_page(device_scale_factor=dpr, viewport={'width': 900, 'height': 900})
        page.goto(f'file://{PP}/examples/dropin.html')
        page.evaluate("window.__pkgs=[]; addEventListener('pixelprovenance:package', e => __pkgs.push(e.detail))")
        page.evaluate("PixelProvenance.mount({pageId:'pricing', enabled:true, verifyPixels:true})")
        page.wait_for_timeout(200)
        r = page.evaluate("(()=>{const b=document.querySelector('[data-pp=cta]').getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height}})()")
        page.click('[data-pp-action=crop]')
        page.mouse.move(r['x'] - 4, r['y'] - 4); page.mouse.down(); page.mouse.move(r['x'] + r['w'] + 4, r['y'] + r['h'] + 4, steps=5); page.mouse.up()
        page.wait_for_function("__pkgs.length > 0", timeout=20000)
        pkg = page.evaluate("__pkgs[0]")
        tag = f'[dropin {dpr}x] '
        check(tag+'crop names the button from layout', pkg['method'] == 'dom' and pkg['path'] == 'pricing/plan-card/cta', {k: pkg.get(k) for k in ('method','path','candidates')})
        check(tag+'crop carries authored source', pkg.get('source') == {'file': 'src/Pricing.tsx', 'line': 88, 'column': 9})
        dims = page.evaluate("""(src) => new Promise(res => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = src })""", pkg['image'])
        exp = [round((r['w'] + 8) * dpr), round((r['h'] + 8) * dpr)]
        check(tag+f'crop image is device-resolution ({exp})', abs(dims[0] - exp[0]) <= 2 * dpr and abs(dims[1] - exp[1]) <= 2 * dpr, dims)
        check(tag+'pixel cross-check reported', 'pixel' in pkg, pkg.get('pixel'))
        print('   pixel verification:', pkg.get('pixel'))
        page.close()
    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed; screenshots in {OUT}")
