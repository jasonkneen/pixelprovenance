"""End-to-end probe for the demo with a JPEG image inside the tagged card.

The carrier lives on the card parent (DevTag), not on the <img>. We capture
the card via html-to-image (the same call the drop-in uses) at DPR 1 and 2,
decode via the project CLI, and verify the carrier survives — even though
the in-page content is a real JPEG.

Run:
    npm run build:lib
    python3 scripts/jpeg-around-carrier.py
"""
import json, os, subprocess, tempfile, sys
from playwright.sync_api import sync_playwright

PP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = f'{PP}/demo-dist'
if not os.path.exists(f'{DIST}/index.html'):
    print('Run `npm run build:demo` first to produce the built demo.', file=sys.stderr)
    sys.exit(2)

REGISTRY = json.load(open(f'{PP}/registry/demo.registry.json'))
SPRINT_PATH = 'MORROW_DASHBOARD/sprint-overview'

OUT = tempfile.mkdtemp(prefix='pp-jpeg-around-')
reg_path = os.path.join(OUT, 'reg.json')
filtered = [c for c in REGISTRY if c['path'] == SPRINT_PATH]
json.dump(filtered, open(reg_path, 'w'))


def decode(png_path, scale):
    r = subprocess.run(
        ['npx', 'tsx', 'decoder/decode.ts', png_path, '--registry', reg_path,
         '--scale', str(scale), '--json'],
        cwd=PP, capture_output=True, text=True,
    )
    if r.returncode not in (0, 1):
        raise RuntimeError(f'decode failed: {r.stderr}')
    return json.loads(r.stdout) if r.stdout.strip() else []


def capture(dpr, page):
    """Capture the sprint card via html-to-image. Returns (png_path, card_rect_css)."""
    # Locate the sprint card after carriers mount. DevTag puts the carrier
    # on a child <span data-pixelprovenance-signal=""> inside the tagged div.
    page.wait_for_function(
        "Boolean(document.querySelector('.sprint-card [data-pixelprovenance-signal]'))",
        timeout=10000,
    )
    rect = page.evaluate(
        """() => {
            const card = document.querySelector('.sprint-card');
            const r = card.getBoundingClientRect();
            return { x: r.left + window.scrollX, y: r.top + window.scrollY,
                     w: r.width, h: r.height };
        }"""
    )
    # Capture the whole body via html-to-image (drop-in's captureRoot path),
    # then slice out the sprint card. The carrier layer is in body coordinates.
    data_url = page.evaluate(
        """async () => {
            const m = await import('https://esm.sh/html-to-image@1.11.13');
            return await m.toPng(document.body, {
                pixelRatio: window.devicePixelRatio,
                cacheBust: true,
            });
        }"""
    )
    import re, base64
    m = re.match(r'^data:image/png;base64,(.+)$', data_url)
    if not m:
        raise RuntimeError(f'unexpected data URL: {data_url[:60]}')
    raw = base64.b64decode(m.group(1))
    body_path = f'/tmp/pp-jpeg-around-dpr{dpr}-body.png'
    open(body_path, 'wb').write(raw)
    # Crop the sprint card out of the body PNG using a tiny Chromium pass.
    crop_path = f'/tmp/pp-jpeg-around-dpr{dpr}-card.png'
    crop_script = (
        f"const {{PNG}} = require('pngjs');\n"
        f"const fs = require('fs');\n"
        f"const src = PNG.sync.read(fs.readFileSync('{body_path}'));\n"
        f"const r = {json.dumps(rect)};\n"
        f"const dpr = {dpr};\n"
        f"const x0 = Math.round(r.x * dpr), y0 = Math.round(r.y * dpr);\n"
        f"const w = Math.round(r.w * dpr), h = Math.round(r.h * dpr);\n"
        f"const out = new PNG({{ width: w, height: h }});\n"
        f"for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {{\n"
        f"  const s = ((y + y0) * src.width + (x + x0)) * 4;\n"
        f"  const d = (y * w + x) * 4;\n"
        f"  for (let c = 0; c < 4; c++) out.data[d + c] = src.data[s + c];\n"
        f"}}\n"
        f"fs.writeFileSync('{crop_path}', PNG.sync.write(out));\n"
    )
    subprocess.run(['node', '-e', crop_script], check=True, cwd=PP)
    return crop_path, rect


results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for dpr in (1, 2):
        ctx = browser.new_context(device_scale_factor=dpr, viewport={'width': 1280, 'height': 1100})
        page = ctx.new_page()
        page.goto('http://127.0.0.1:8765/')
        png_path, rect = capture(dpr, page)
        ctx.close()
        decoded = decode(png_path, dpr)
        best = decoded[0] if decoded else None
        results.append({
            'dpr': dpr,
            'png': png_path,
            'card_rect_css': rect,
            'best_match': best,
        })
    browser.close()

print(json.dumps(results, indent=2))
passed = all(r['best_match'] is not None for r in results)
print(('\nPASS' if passed else '\nFAIL') + ' — carrier ' +
      ('survives' if passed else 'did NOT survive') + ' JPEG image inside the tagged card')
sys.exit(0 if passed else 1)