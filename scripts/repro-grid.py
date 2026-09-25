"""Test pixel decode for various crop sizes around 12/16 task-count."""
from playwright.sync_api import sync_playwright
import json

def test(dpr, crop_pad):
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
        x1 = rects['x'] - crop_pad
        y1 = rects['y'] - crop_pad
        x2 = rects['x'] + rects['width'] + crop_pad
        y2 = rects['y'] + rects['height'] + crop_pad
        page.mouse.move(x1, y1)
        page.mouse.down()
        page.mouse.move(x2, y2, steps=8)
        page.mouse.up()
        page.wait_for_timeout(500)
        # Click "Drag to analyse" thumbnail.
        thumb = page.evaluate("""() => {
            const t = [...document.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes('Drag to analyse'));
            return t && t.getBoundingClientRect();
        }""")
        if thumb:
            page.mouse.click(thumb['x'] + thumb['width']/2, thumb['y'] + thumb['height']/2)
            page.wait_for_timeout(2500)
        # Read matches.
        result = page.evaluate("""() => {
            const matches = [...document.querySelectorAll('.ranking > div')].map(d => d.textContent.replace(/\\s+/g, ' ').trim());
            return { matches };
        }""")
        browser.close()
        return result['matches']

for dpr in [1, 2]:
    for pad in [4, 12, 24, 48, 80]:
        print(f'DPR={dpr} pad={pad}px:', test(dpr, pad))