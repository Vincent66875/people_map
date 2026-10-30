# Headless Chromium check of the bundled app (.check/). Run: python3 scripts/ui_check.py
# Serves .check on localhost, drives the page, asserts DOM/geometry/keyboard, saves screenshots.
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', '.check')
OUT = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
os.makedirs(OUT, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=ROOT)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

GEOMETRY_JS = """() => {
  const svg = document.querySelector('[data-testid=people-graph]');
  const circles = [...svg.querySelectorAll('[data-node] circle:not(.jtm-ring)')].map(c => ({id: c.parentNode.dataset.node, x:+c.getAttribute('cx'), y:+c.getAttribute('cy'), r:+c.getAttribute('r')}));
  const labels = [...svg.querySelectorAll('[data-label]')].map(g => { const b = g.querySelector('rect').getBBox(); const t = g.querySelector('text').getBBox(); return {id: g.dataset.label, b, t, lines: g.querySelectorAll('tspan').length}; });
  const badges = [...svg.querySelectorAll('[data-badge] circle')].map(c => ({x:+c.getAttribute('cx'), y:+c.getAttribute('cy'), r:+c.getAttribute('r')}));
  const hit = (b, c, m) => { const cx = Math.max(b.x, Math.min(c.x, b.x+b.width)); const cy = Math.max(b.y, Math.min(c.y, b.y+b.height)); return Math.hypot(c.x-cx, c.y-cy) < c.r + m; };
  const overlapLR = []; labels.forEach(l => circles.forEach(c => { if (hit(l.b, c, 0)) overlapLR.push(l.id + ' on ' + c.id); }));
  const textOverflow = labels.filter(l => l.t.width > l.b.width + 0.5).map(l => l.id + ' ' + l.t.width.toFixed(1) + '>' + l.b.width.toFixed(1));
  const ll = []; for (let i=0;i<labels.length;i++) for (let j=i+1;j<labels.length;j++) { const a=labels[i].b,b=labels[j].b; if (a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height) ll.push(labels[i].id+' x '+labels[j].id); }
  const badgeOnNode = []; badges.forEach((b,i) => circles.forEach(c => { if (Math.hypot(b.x-c.x,b.y-c.y) < b.r + c.r) badgeOnNode.push(i+' on '+c.id); }));
  const texts = [...svg.querySelectorAll('[data-node] .jtm-node-name, [data-node] .jtm-node-score')].filter(t => t.textContent).map(t => ({id: t.parentNode.dataset.node, b: t.getBBox()}));
  const rr = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const labelOnText = []; labels.forEach(l => texts.forEach(t => { if (rr(l.b, t.b)) labelOnText.push(l.id + ' on ' + t.id + ' text'); }));
  const badgeOnText = []; badges.forEach((b,i) => texts.forEach(t => { if (hit(t.b, b, 0)) badgeOnText.push(i + ' on ' + t.id + ' text'); }));
  const edgeOnText = [];
  [...svg.querySelectorAll('[data-edge]')].forEach(path => { const L = path.getTotalLength(); for (let d = 0; d <= L; d += 3) { const pt = path.getPointAtLength(d); texts.forEach(t => { const [w8, b8] = path.dataset.edge.split('>'); if (t.id === w8 || t.id === b8) return; if (pt.x > t.b.x && pt.x < t.b.x + t.b.width && pt.y > t.b.y && pt.y < t.b.y + t.b.height && !edgeOnText.includes(path.dataset.edge + ' / ' + t.id)) edgeOnText.push(path.dataset.edge + ' / ' + t.id); }); } });
  const nn = []; for (let i=0;i<circles.length;i++) for (let j=i+1;j<circles.length;j++) if (Math.hypot(circles[i].x-circles[j].x, circles[i].y-circles[j].y) < circles[i].r+circles[j].r) nn.push(circles[i].id+'/'+circles[j].id);
  return { edgeOnText, labelOnText, badgeOnText, overlapLR, textOverflow, ll, badgeOnNode, nn, maxLines: Math.max(...labels.map(l => l.lines)), cols: [...svg.querySelectorAll('.jtm-col-title')].map(t => t.textContent) };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args=['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-features=OptimizationHints,AutofillServerCommunication,Translate'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    q = lambda s: page.locator(s).count()
    drawer = lambda: page.locator('[data-testid=drawer]')
    title = lambda: page.locator('#jtm-drawer-title').inner_text()
    def at_node(nid):
        b = page.locator(f'[data-node="{nid}"] circle:not(.jtm-ring)').bounding_box()
        return page.evaluate(f"() => document.elementFromPoint({b['x'] + b['width'] / 2}, {b['y'] + b['height'] / 2})?.closest('[data-node]')?.dataset.node ?? null")
    def geom_bad():
        g = page.evaluate(GEOMETRY_JS)
        return {k: v for k, v in g.items() if k in ('edgeOnText', 'overlapLR', 'll', 'badgeOnNode', 'textOverflow', 'labelOnText', 'badgeOnText', 'nn') and v}, g
    def no_hscroll():
        return page.evaluate("() => { const g = document.querySelector('.jtm-graph'); return g.scrollWidth <= g.clientWidth + 1; }")

    # ======================= base map =======================
    page.goto(BASE)
    page.wait_for_selector('[data-testid=people-graph]')
    check('map: 14 nodes, 10 arrows, 10 badges, 10 labels', (q('[data-node]'), q('[data-edge]'), q('[data-badge]'), q('[data-label]')) == (14, 10, 10, 10))
    check('map: 5 green / 5 amber badges', (q('.jtm-badge--green'), q('.jtm-badge--amber')) == (5, 5))
    check('map: 3 red arrows', q('[data-edge].jtm-edge--red') == 3, q('[data-edge].jtm-edge--red'))
    sr = page.locator('[data-testid=sr-edges] li')
    check('map: SR list has every ticket pair (11)', sr.count() == 11, sr.count())
    check('map: SR sentence wording', "Ken waits on Mia: Mia's 'Design tokens' [DES-2] (In Progress, due in 3 days) blocks Ken's 'Token migration' [WEB-2]. Cover: only Mia has worked on DES-2." in sr.all_text_contents())
    bad, g = geom_bad()
    check('map: column order', g['cols'] == ['Backend', 'Frontend', 'Design', 'Mobile', 'Product'], g['cols'])
    check('map: no overlaps (rendered geometry)', not bad and g['maxLines'] <= 2, bad)
    check('map: whole graph visible at 1600px, no panel', no_hscroll())
    check('map: no drawer at start', drawer().count() == 0)
    page.screenshot(path=f'{OUT}/fix-map.png', full_page=True)

    # ======================= issue 1: docked panel keeps the map visible =======================
    page.get_by_role('button', name='People & coverage').click()
    check('#1 wide: panel is docked (aside, non-modal), no modal open', page.locator('aside[data-testid=drawer][aria-modal=false]').count() == 1 and q('dialog[open]') == 0)
    check('#1 wide: map still clickable beside the panel', at_node('u-sam') == 'u-sam' and at_node('u-paula') == 'u-paula')
    check('#1 wide: no horizontal scroll with panel open at 1600px', no_hscroll())
    rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].map(li => li.querySelector('.jtm-name').textContent + ':' + li.querySelector('.jtm-score').textContent)")
    check('ranking: order + scores', rows == ['Sam:22', 'Tara:20', 'Vic:20', 'Mia:18', 'Ivy:12', 'Lea:10', 'Paula:2', 'Xan:2'], rows)
    check('ranking: Mark-out buttons hidden outside simulation', not page.locator('[data-testid=ranking] .jtm-absence-control').first.is_visible())
    page.locator('[data-person=u-mia] .jtm-name').click()
    check('#2 title: person name in panel header', title() == 'Mia · Design', title())
    check('#2 single header: no inner panel header/× in drawer', q('[data-testid=drawer] .jtm-panel > header') == 0 and q('[data-testid=drawer] .jtm-close') == 1)
    check('#1 select: knowledge line + fade visible while panel open', q('[data-knowledge="u-noah"]') == 1 and 'jtm-faded' in page.get_attribute('[data-node=u-sam]', 'class') and at_node('u-mia') == 'u-mia')
    check('back: ← Back returns to ranking', q('.jtm-back') == 1)
    page.screenshot(path=f'{OUT}/fix-docked-person.png', full_page=True)
    page.locator('[data-node=u-ken]').click()
    check('select other node: panel switches person, no extra Back step', title() == 'Ken · Frontend' and page.get_attribute('[data-node=u-ken]', 'aria-pressed') == 'true', title())
    page.locator('.jtm-back').click()
    check('#3 back out of person: selection cleared', title() == 'People & coverage' and q('[data-node].jtm-faded') == 0 and q('[data-node][aria-pressed=true]') == 0)

    # ======================= closing: X, Esc, click outside =======================
    page.locator('[data-testid=drawer] .jtm-close').click()
    check('close: × closes panel', drawer().count() == 0)
    focused = page.evaluate("() => document.activeElement.textContent")
    check('close: focus returns to the button that opened it', focused == 'People & coverage', focused)
    page.locator('[data-node=u-mia]').click()
    check('node click opens person panel', title() == 'Mia · Design')
    page.keyboard.press('Escape')
    check('close: Esc closes panel and clears selection (#3)', drawer().count() == 0 and q('[data-node].jtm-faded') == 0)
    page.locator('[data-node=u-mia]').click()
    box = page.locator('[data-testid=people-graph]').bounding_box()
    page.mouse.click(box['x'] + 20, box['y'] + box['height'] - 15)
    check('close: click on empty map space closes panel and clears selection', drawer().count() == 0 and q('[data-node][aria-pressed=true]') == 0)

    # ======================= panels =======================
    page.get_by_role('button', name='Data & coverage').click()
    prov = page.locator('[data-testid=provenance]').inner_text().strip()
    check('data: provenance', prov == 'Built from 40 Jira issues · 90% assigned · 13 recorded dependency links.', prov)
    page.locator('[data-testid=data-quality] summary').click()
    page.locator('[data-testid=data-quality]').get_by_role('button', name='Dan (deactivated)').click()
    check('data: number opens its tickets (pushed, with Back)', set(page.locator('[data-testid=ticket-list] li code').all_text_contents()) == {'API-7', 'API-9'} and q('.jtm-back') == 1)
    page.locator('.jtm-back').click()
    check('data: Back returns', q('[data-testid=data-quality]') == 1)

    page.locator('[data-badge="u-wen>u-mia"]').click()
    check('badge: opens who-has-worked-on DES-3 (title in header)', title() == 'Who has worked on DES-3 Icon set?' and 'Noah' in page.locator('[data-testid=worked-on]').inner_text(), title())
    page.get_by_role('button', name='Find work').click()
    page.fill('[data-testid=search-input]', 'label:checkout-2026'); page.keyboard.press('Enter')
    names = page.locator('[data-testid=worked-on] .jtm-worked li strong').all_text_contents()
    check('search: area label, 5 people closest first', names == ['Lea', 'Sam', 'Ivy', 'Vic', 'Omar'], names)
    page.locator('.jtm-back').click()
    page.fill('[data-testid=search-input]', 'nonsense'); page.keyboard.press('Enter')
    check('search: no match message', 'No ticket or area matches' in page.locator('[data-testid=worked-on]').inner_text())
    page.keyboard.press('Escape')

    # ======================= keyboard =======================
    page.locator('body').click(position={'x': 5, 'y': 5})
    focused, presses = None, 0
    while presses < 20:
        page.keyboard.press('Tab'); presses += 1
        focused = page.evaluate("() => document.activeElement.dataset.node || null")
        if focused: break
    check('kbd: Tab reaches the graph', bool(focused), f'{focused} after {presses}')
    page.keyboard.press('ArrowDown')
    nxt = page.evaluate("() => document.activeElement.dataset.node")
    check('kbd: arrows move between people', nxt and nxt != focused)
    check('kbd: roving tabindex', page.evaluate("() => [...document.querySelectorAll('[data-node]')].filter(n => n.tabIndex === 0).length") == 1)
    page.locator('[data-node=u-mia]').focus(); page.keyboard.press('Enter')
    check('kbd: Enter selects and opens panel; heading focused', title() == 'Mia · Design' and page.evaluate("() => document.activeElement.id") == 'jtm-drawer-title')
    page.keyboard.press('Escape')
    check('kbd: Esc closes', drawer().count() == 0)

    # ======================= simulation =======================
    page.get_by_role('button', name='Simulate absence').click()
    check('sim: ranking opens, Mark-out visible', page.locator('[data-person=u-sam]').get_by_role('button', name='Mark out').is_visible())
    page.locator('[data-person=u-sam]').get_by_role('button', name='Mark out').click()
    red = sorted(page.evaluate("() => [...document.querySelectorAll('.jtm-ring--waiting')].map(c => c.parentNode.dataset.node)"))
    check('#1 sim: rings visible on the map while ranking stays open', red == ['u-lea', 'u-omar', 'u-vic', 'u-xan'] and drawer().count() == 1 and at_node('u-lea') == 'u-lea', red)
    deltas = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].filter(li => li.querySelector('[data-testid=delta]')).map(li => [li.querySelector('.jtm-name').textContent, li.querySelector('[data-testid=delta]').textContent]))")
    check('sim: deltas', deltas == {'Tara': '▼ -4', 'Vic': '▼ -4', 'Lea': '▼ -2', 'Paula': '▲ +2', 'Xan': '▼ -2'}, deltas)
    bad, _ = geom_bad()
    check('sim: geometry clean with live node sizes', not bad, bad)
    page.screenshot(path=f'{OUT}/fix-docked-simulation.png', full_page=True)
    page.get_by_role('button', name='View impact').click()
    ab = page.locator('[data-testid=absence]').inner_text()
    check('sim: impact panel (chains, context, Clear all)', all(x in ab for x in ['API-2', 'Omar → Lea → Sam', 'Vic: sub-task API-2 via API-6 (now)', 'Clear all']), ab)
    page.get_by_role('button', name='Clear all').click()
    check('sim: Clear all → nobody out, panel closed', q('.jtm-node--out') == 0 and drawer().count() == 0)
    page.get_by_role('button', name='Exit simulation').click()

    # ======================= zoom =======================
    page.locator('[data-zoom=theme]').click()
    check('zoom theme: epic labels', 'Design system 2.0 ×2' in page.locator('[data-label="u-ken>u-mia"]').text_content())
    page.locator('[data-zoom=team]').click()
    page.get_by_role('button', name='Map key').click()
    check('zoom team: team sentences in Map key', 'Mobile waits on Design, through Mia only' in drawer().inner_text())
    bad, _ = geom_bad()
    check('zoom team: geometry clean', not bad, bad)
    page.keyboard.press('Escape')
    page.locator('[data-zoom=ticket]').click()

    import re
    page.locator('[data-node=u-mia]').click()
    txt = page.evaluate("() => document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ') + ' ' + document.querySelector('[data-testid=sr-edges]').textContent")
    hits = sorted(set(m.lower() for m in re.findall(r'\b(knows|expert|bus factor|person risk|most important|workload|capacity|hours|backup|should ask|recommend)\b', txt, re.I)))
    check('wording: no banned terms (incl. aria)', not hits, hits)

    # ======================= narrow frame: modal overlay =======================
    page.set_viewport_size({'width': 900, 'height': 900})
    page.goto(BASE)
    page.wait_for_selector('[data-testid=people-graph]')
    sw = page.locator('[data-testid=people-graph]').bounding_box()['width']
    check('#4 narrow: map scales down but not below 85%', 1020 <= sw <= 1025, sw)
    page.get_by_role('button', name='People & coverage').click()
    check('narrow: panel is a modal overlay', q('dialog[open]') == 1 and page.locator('aside[data-testid=drawer]').count() == 0)
    page.screenshot(path=f'{OUT}/fix-narrow-overlay.png', full_page=False)
    page.mouse.click(5, 5)
    check('narrow: click outside (backdrop) closes', q('dialog[open]') == 0)
    page.get_by_role('button', name='People & coverage').click()
    page.keyboard.press('Escape')
    check('narrow: Esc closes', q('dialog[open]') == 0)
    page.locator('[data-node=u-mia]').click()
    check('narrow: node opens person overlay with name title', q('dialog[open]') == 1 and title() == 'Mia · Design')
    page.locator('dialog .jtm-close').click()
    check('narrow: × closes and clears selection (#3)', q('dialog[open]') == 0 and q('[data-node][aria-pressed=true]') == 0)

    # ======================= small fixture + other zooms =======================
    page.set_viewport_size({'width': 1600, 'height': 1000})
    page.goto(BASE + '?data=small')
    page.wait_for_selector('[data-testid=people-graph]')
    check('small: 5 nodes, 4 arrows, 4 badges', (q('[data-node]'), q('[data-edge]'), q('[data-badge]')) == (5, 4, 4))
    bad, _ = geom_bad()
    check('small: geometry clean', not bad, bad)
    page.get_by_role('button', name='Simulate absence').click()
    page.locator('[data-person=u-ben]').get_by_role('button', name='Mark out').click()
    deltas = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].map(li => [li.querySelector('.jtm-name').textContent, li.querySelector('.jtm-score').textContent + (li.querySelector('[data-testid=delta]')?.textContent ?? '')]))")
    check('small Ben out: deltas', deltas == {'Ana': '14▲ +6', 'Ben': '10', 'Cy': '8▲ +2', 'Pam': '2', 'Dee': '0▼ -4'}, deltas)
    for fx in ('large', 'small'):
        for z in ('theme', 'team'):
            page.goto(f'{BASE}?data={fx}&zoom={z}')
            page.wait_for_selector('[data-testid=people-graph]')
            bad, g = geom_bad()
            check(f'{fx} @{z}: geometry clean', not bad and g['maxLines'] <= 2, bad)

    check('no console errors or warnings', not errors, errors)
    browser.close()
srv.shutdown()

w = max(len(n) for n, _, _ in results)
fails = 0
for n, ok, d in results:
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {n.ljust(w)}  {'' if ok else d}")
print(f'\n{len(results) - fails}/{len(results)} passed')
sys.exit(1 if fails else 0)
