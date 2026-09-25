"""Reproduce: draw a tight crop around 12/16 task-count and check what matches."""
from playwright.sync_api import sync_playwright
import json

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 1100})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto('http://127.0.0.1:8765/')
    page.wait_for_timeout(2000)
    page.evaluate("document.querySelector('.sprint-card').scrollIntoView({block:'center'})")
    page.wait_for_timeout(500)

    rects = page.evaluate("""() => {
        const card = document.querySelector('.sprint-card');
        const tc = document.querySelector('[data-pixelprovenance-path*="task-count"]');
        const sel = document.querySelector('.selection-layer') || document.querySelector('[class*="selection"]');
        const host = document.querySelector('.sample-app');
        return {
            card: card.getBoundingClientRect(),
            taskCount: tc.getBoundingClientRect(),
            selectionLayer: sel && sel.getBoundingClientRect(),
            host: host && host.getBoundingClientRect(),
        };
    }""")
    print('rects:', json.dumps({k: (v if not isinstance(v, dict) else {kk: round(vv, 1) for kk, vv in v.items()}) for k, v in rects.items()}, indent=2))

    # Use the demo's prepareInPageCapture directly via the dev's exposed window:
    # Actually simpler: drive the selection layer mouse events.
    tc = rects['taskCount']
    x1 = tc['x'] - 6
    y1 = tc['y'] - 6
    x2 = tc['x'] + tc['width'] + 12
    y2 = tc['y'] + tc['height'] + 12
    print(f'Drawing crop from ({x1:.0f},{y1:.0f}) to ({x2:.0f},{y2:.0f})')
    page.mouse.move(x1, y1)
    page.mouse.down()
    page.mouse.move(x2, y2, steps=8)
    page.mouse.up()
    page.wait_for_timeout(800)

    # Get the pending crop, then click on the thumbnail to analyse (the demo
    # has a clickable crop thumbnail for users without drag-and-drop).
    pending = page.evaluate("""() => {
        const sel = document.querySelector('.selection-rect');
        const span = sel && sel.querySelector('span');
        return { rect: sel && sel.getBoundingClientRect(), label: span && span.innerText };
    }""")
    print('pending:', json.dumps(pending, indent=2, default=str))

    # Click the crop thumbnail (the demo says "click the thumbnail to analyse").
    # Find the button containing 'Drag to analyse' or 'Drag this crop'.
    thumb_info = page.evaluate("""() => {
        const candidates = [...document.querySelectorAll('button')];
        const t = candidates.find(b => b.textContent && b.textContent.includes('Drag to analyse'));
        return t && t.getBoundingClientRect();
    }""")
    if thumb_info:
        page.mouse.click(thumb_info['x'] + thumb_info['width']/2, thumb_info['y'] + thumb_info['height']/2)
        page.wait_for_timeout(2500)

    # Read final state.
    final = page.evaluate("""() => {
        const sel = document.querySelector('.selection-rect');
        const span = sel && sel.querySelector('span');
        const focused = document.querySelector('.source-focused');
        const matches = [...document.querySelectorAll('.ranking > div')].map(d => d.textContent);
        const sourceFocusPill = document.querySelector('.selection-rect[data-source-focus=\"true\"] > span');
        return {
            selectionRect: sel && sel.getBoundingClientRect(),
            selectionLabel: span && span.innerText,
            focusedPath: focused && focused.getAttribute('data-pixelprovenance-path'),
            sourceFocusPill: sourceFocusPill && sourceFocusPill.innerText,
            matches,
        };
    }""")
    print('final:', json.dumps(final, indent=2, default=str))
    print('errors:', errors)
    page.screenshot(path='/tmp/pp-repro.png', full_page=False)
    browser.close()