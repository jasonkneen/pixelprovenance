"""Quick: at DPR=2, what does pixel decode say for a tight crop around 12/16?"""
from playwright.sync_api import sync_playwright
import json

def test(dpr):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(device_scale_factor=dpr, viewport={'width': 1280, 'height': 1100})
        page = ctx.new_page()
        page.goto('http://127.0.0.1:8765/')
        page.wait_for_timeout(2000)
        page.evaluate("document.querySelector('.sprint-card').scrollIntoView({block:'center'})")
        page.wait_for_timeout(500)
        rects = page.evaluate("""() => {
            const tc = document.querySelector('[data-pixelprovenance-path*="task-count"]');
            return tc.getBoundingClientRect();
        }""")
        # Tight crop around 12/16.
        x1 = rects['x'] - 4
        y1 = rects['y'] - 4
        x2 = rects['x'] + rects['width'] + 8
        y2 = rects['y'] + rects['height'] + 8
        page.mouse.move(x1, y1)
        page.mouse.down()
        page.mouse.move(x2, y2, steps=6)
        page.mouse.up()
        page.wait_for_timeout(400)
        thumb = page.evaluate("""() => {
            const t = [...document.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes('Drag to analyse'));
            return t && t.getBoundingClientRect();
        }""")
        if thumb:
            page.mouse.click(thumb['x'] + thumb['width']/2, thumb['y'] + thumb['height']/2)
            page.wait_for_timeout(2500)
        result = page.evaluate("""() => {
            const ranking = [...document.querySelectorAll('.ranking > div')].map(d => d.textContent.replace(/\\s+/g, ' ').trim());
            return { ranking };
        }""")
        browser.close()
        return result['ranking'][:4]

for dpr in [1, 2]:
    print(f'DPR={dpr}:', test(dpr))