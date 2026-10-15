# /// script
# dependencies = ["playwright"]
# ///
"""Play the game headlessly with a bot and print daily snapshots.

Usage: uv run sim/sim.py [policy] [days] [runs]
  policy: good | build | rush | idle (default good)
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
policy = sys.argv[1] if len(sys.argv) > 1 else 'good'
days = int(sys.argv[2]) if len(sys.argv) > 2 else 6
runs = int(sys.argv[3]) if len(sys.argv) > 3 else 3
url = (HERE.parent / 'index.html').resolve().as_uri()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(url)
    pg.wait_for_timeout(300)
    pg.evaluate("const _l=lose;lose=function(r){S.overReason=r;_l(r)}")
    pg.evaluate((HERE / 'bot.js').read_text())
    for i in range(runs):
        r = pg.evaluate(f"runBot('{policy}',{days})")
        print(f'--- {policy} run {i} reason={r.get("reason")} score={r["score"]}')
        for line in r['out']:
            print('  ', line)
    b.close()
