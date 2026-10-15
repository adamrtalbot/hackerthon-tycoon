# /// script
# dependencies = ["playwright"]
# ///
"""Screenshot every panel at laptop and phone sizes into sim/shots/ and report console errors.

Usage: uv run sim/ui.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
OUT = HERE / 'shots'
OUT.mkdir(exist_ok=True)
url = (HERE.parent / 'index.html').resolve().as_uri()
bot = (HERE / 'bot.js').read_text()

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp in [('laptop', {'width': 1366, 'height': 800}), ('phone', {'width': 390, 'height': 844})]:
        ph = name == 'phone'
        pg = b.new_page(viewport=vp, device_scale_factor=2 if ph else 1, is_mobile=ph, has_touch=ph)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        shot = lambda tag, full=True: pg.screenshot(path=OUT / f'{name}-{tag}.png', full_page=full)
        pg.goto(url)
        pg.wait_for_timeout(500)
        shot('intro', False)
        pg.evaluate(bot)
        pg.evaluate("hideModal();runBot('good',2)")
        pg.evaluate("for(let i=0;i<200;i++)update(.05);fireE(EVENTS[EVENTS.length-1]);S.tab='slack';S.paused=true;"
                    "const o=S.objs.find(o=>o.kind==='pipe'&&!o.released)||S.objs.find(o=>o.kind==='pipe');if(o)S.sel={t:'o',id:o.id};"
                    "updateHUD();renderPanel(true);renderInspect(true);renderCI()")
        pg.wait_for_timeout(400)
        shot('slack')
        for t in ['pipes', 'team']:
            pg.click(f'[data-act=tab][data-arg={t}]')
            pg.wait_for_timeout(400)
            shot(t)
        if ph:
            pg.evaluate('window.scrollTo(0,900)')
            pg.wait_for_timeout(300)
            shot('scrolled', False)
        pg.evaluate("window.scrollTo(0,0);S.sel={t:'ledger'};renderInspect(true)")
        pg.wait_for_timeout(300)
        shot('ledger')
        pg.evaluate("S.t=DAY_LEN;endDay()")
        pg.wait_for_timeout(300)
        shot('eod', False)
        pg.evaluate("hideModal();lose('rep')")
        pg.wait_for_timeout(300)
        shot('over', False)
        print(name, 'errors:', errs or 'none')
    b.close()
print('screenshots in', OUT)
