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

    # ---------------- large ----------------
    page.goto(BASE)
    page.wait_for_selector('[data-testid=people-graph]')
    q = lambda s: page.locator(s).count()
    check('large: 14 people nodes', q('[data-node]') == 14, q('[data-node]'))
    check('large: 10 arrows', q('[data-edge]') == 10, q('[data-edge]'))
    check('large: 10 cover badges', q('[data-badge]') == 10)
    check('large: 10 edge labels', q('[data-label]') == 10)
    check('large: 5 green / 5 amber badges', (q('.jtm-badge--green'), q('.jtm-badge--amber')) == (5, 5), (q('.jtm-badge--green'), q('.jtm-badge--amber')))
    check('large: 3 red arrows (blocked/overdue blocker)', q('[data-edge].jtm-edge--red') == 3, q('[data-edge].jtm-edge--red'))
    sr = page.locator('[data-testid=sr-edges] li')
    check('large: SR list has every ticket pair (11)', sr.count() == 11, sr.count())
    check('large: SR sentence wording', "Ken waits on Mia: Mia's 'Design tokens' [DES-2] (In Progress, due in 3 days) blocks Ken's 'Token migration' [WEB-2]. Cover: only Mia has worked on DES-2." in sr.all_text_contents())
    prov = page.locator('[data-testid=provenance]').inner_text()
    check('large: provenance line', prov.strip() == 'Built from 40 Jira issues with no manual input · 90% assigned · 13 dependency links', prov)
    g = page.evaluate(GEOMETRY_JS)
    check('large: column order', g['cols'] == ['Backend', 'Frontend', 'Design', 'Mobile', 'Product'], g['cols'])
    check('large: no label sits on a person node (rendered bbox)', not g['overlapLR'], g['overlapLR'])
    check('large: label text fits its box (rendered font)', not g['textOverflow'], g['textOverflow'])
    check('large: no label overlaps another label', not g['ll'], g['ll'])
    check('large: no badge on a node', not g['badgeOnNode'], g['badgeOnNode'])
    check('large: no label on a name/score text', not g['labelOnText'], g['labelOnText'])
    check('large: no arrow crosses another person\'s name/score text', not g['edgeOnText'], g['edgeOnText'])
    check('large: whole graph visible at 1600px (no clipped column)', page.evaluate("() => { const g = document.querySelector('.jtm-graph'); return g.scrollWidth <= g.clientWidth; }"))
    check('large: no badge on a name/score text', not g['badgeOnText'], g['badgeOnText'])
    check('large: no node overlaps another node', not g['nn'], g['nn'])
    check('large: labels at most 2 lines', g['maxLines'] <= 2, g['maxLines'])
    page.screenshot(path=f'{OUT}/stage4-large.png', full_page=True)

    # keyboard: Tab order provenance x3 -> first node
    page.locator('body').click(position={'x': 5, 'y': 5})
    focused, presses = None, 0
    while presses < 20:
        page.keyboard.press('Tab'); presses += 1
        focused = page.evaluate("() => document.activeElement.dataset.node || null")
        if focused: break
    check('kbd: Tab reaches the graph (after provenance, data quality, zoom, search)', focused and focused.startswith('u-'), f'{focused} after {presses}')
    first = focused
    page.keyboard.press('ArrowDown')
    after_down = page.evaluate("() => document.activeElement.dataset.node")
    check('kbd: ArrowDown moves focus within column', after_down and after_down != first, f'{first} -> {after_down}')
    page.keyboard.press('ArrowRight')
    after_right = page.evaluate("() => document.activeElement.dataset.node")
    check('kbd: ArrowRight moves to next team column', after_right and after_right != after_down, after_right)
    only_one_tabbable = page.evaluate("() => [...document.querySelectorAll('[data-node]')].filter(n => n.tabIndex === 0).length")
    check('kbd: roving tabindex (one node tabbable)', only_one_tabbable == 1, only_one_tabbable)
    # select Mia by keyboard
    page.locator('[data-node=u-mia]').focus()
    page.keyboard.press('Enter')
    check('kbd: Enter selects (aria-pressed)', page.get_attribute('[data-node=u-mia]', 'aria-pressed') == 'true')
    faded_nodes = page.evaluate("() => [...document.querySelectorAll('[data-node].jtm-faded')].map(n => n.dataset.node).sort()")
    check('select Mia: unrelated people fade', 'u-sam' in faded_nodes and 'u-ken' not in faded_nodes and 'u-mia' not in faded_nodes, faded_nodes)
    sel = page.locator('[data-testid=unblock]').inner_text()
    check('select Mia: unblock sentence shown', "4 tasks start once Mia's blocking work is done." in sel, sel)
    page.screenshot(path=f'{OUT}/stage4-large-selected-mia.png', full_page=True)
    page.keyboard.press('Escape')
    page.locator('[data-node=u-mia]').focus()
    page.keyboard.press('Escape')
    check('kbd: Escape clears selection', page.locator('[data-node].jtm-faded').count() == 0 and page.locator('[data-testid=person-detail]').count() == 0)

    # badge by keyboard -> who has worked on this
    page.locator('[data-badge="u-wen>u-mia"]').focus()
    page.keyboard.press('Enter')
    wo = page.locator('[data-testid=worked-on]').inner_text()
    check('badge Enter opens who-has-worked-on DES-3', 'Who has worked on DES-3 Icon set?' in wo and 'Noah' in wo, wo[:200])
    check('badge aria-label describes cover', 'Noah also worked on DES-3' in page.get_attribute('[data-badge="u-wen>u-mia"]', 'aria-label'))
    page.locator('[data-badge="u-ken>u-mia"]').click()
    wo = page.locator('[data-testid=worked-on]').inner_text()
    check('badge click opens DES-2 list (5 people max)', 'DES-2 Design tokens' in wo and page.locator('.jtm-worked li').count() == 5 and '1 more not shown' in wo)
    page.screenshot(path=f'{OUT}/stage4-large-badge.png', full_page=True)

    # provenance numbers open tickets
    page.get_by_role('button', name='40 Jira issues').click()
    check('provenance: 40 issues list', page.locator('[data-testid=ticket-list] li').count() == 40)
    page.get_by_role('button', name='90% assigned').click()
    check('provenance: assigned list 18 keys', page.locator('[data-testid=ticket-list] li').count() == 18)

    # ---------------- small ----------------
    page.goto(BASE + '?data=small')
    page.wait_for_selector('[data-testid=people-graph]')
    check('small: 5 nodes, 4 arrows, 4 badges', (q('[data-node]'), q('[data-edge]'), q('[data-badge]')) == (5, 4, 4), (q('[data-node]'), q('[data-edge]'), q('[data-badge]')))
    check('small: provenance', page.locator('[data-testid=provenance]').inner_text().strip() == 'Built from 11 Jira issues with no manual input · 71% assigned · 5 dependency links')
    g = page.evaluate(GEOMETRY_JS)
    check('small: no label/node, label/label, badge/node overlap, text fits', not (g['overlapLR'] or g['ll'] or g['badgeOnNode'] or g['textOverflow'] or g['labelOnText'] or g['badgeOnText']), g)
    page.screenshot(path=f'{OUT}/stage4-small.png', full_page=True)

    # other zoom levels: geometry still clean
    for fx in ('large', 'small'):
        for z in ('theme', 'team'):
            page.goto(f'{BASE}?data={fx}&zoom={z}')
            page.wait_for_selector('[data-testid=people-graph]')
            g = page.evaluate(GEOMETRY_JS)
            bad = {k: v for k, v in g.items() if k in ('edgeOnText', 'overlapLR', 'll', 'badgeOnNode', 'textOverflow', 'labelOnText', 'badgeOnText', 'nn') and v}
            check(f'{fx} @{z}: no overlaps, labels <= 2 lines', not bad and g['maxLines'] <= 2, bad)
            if fx == 'large' and z == 'team':
                txt = ' '.join(page.locator('[data-label] text').all_text_contents())
                check('large @team: team sentence shown', 'Mobile waits on Design,' in txt and 'through Mia only' in txt, txt)
                page.screenshot(path=f'{OUT}/stage4-large-team.png', full_page=True)

    # narrow viewport: graph scrolls, page does not break
    page.set_viewport_size({'width': 900, 'height': 900})
    page.goto(BASE)
    page.wait_for_selector('[data-testid=people-graph]')
    page.screenshot(path=f'{OUT}/stage4-large-narrow.png', full_page=True)


    # ======================= STAGE 5 =======================
    page.set_viewport_size({'width': 1800, 'height': 1100})
    page.goto(BASE)
    page.wait_for_selector('[data-testid=ranking]')
    rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].map(li => li.querySelector('.jtm-name').textContent + ':' + li.querySelector('.jtm-score').textContent)")
    check('s5 ranking: everyone > 0 in order', rows == ['Sam:22', 'Tara:20', 'Vic:20', 'Mia:18', 'Ivy:12', 'Lea:10', 'Paula:2', 'Xan:2'], rows)
    f = page.locator('[data-testid=formula]').inner_text()
    check('s5 formula visible without expanding', all(t in f for t in ['cold task +4', 'warm task +2', 'Blocked or overdue +2', 'each person left waiting +4', 'sole team link +2', 'lead change +2']), f)
    nonbutton = page.evaluate("() => [...document.querySelectorAll('[data-testid=ranking] .jtm-score')].filter(e => e.tagName !== 'BUTTON' && e.textContent !== '0').length")
    check('s5 every non-zero score is a button to its tickets', nonbutton == 0, nonbutton)
    page.locator('[data-person=u-mia] .jtm-reason', has_text='DES-2 cold').click()
    tl = page.locator('[data-testid=ticket-list]').inner_text()
    check('s5 reason fragment opens its tickets', 'DES-2' in tl and 'Design tokens' in tl, tl[:120])
    page.locator('[data-person=u-sam] .jtm-score').click()
    keys = page.locator('[data-testid=ticket-list] li code').all_text_contents()
    check('s5 score opens all tickets behind it', {'API-2', 'API-7', 'WEB-6', 'WEB-5'} <= set(keys), keys)

    page.locator('[data-person=u-tara] .jtm-name').click()
    det = page.locator('[data-testid=person-detail]')
    chains = page.locator('[data-testid=chain]').all_inner_texts()
    check('s5 detail: full chains', any('Omar → Lea → Sam → Tara' in c and 'WEB-5 → WEB-3 → API-2 → API-3' in c for c in chains), chains)
    check('s5 detail: covered task shown', 'API-3 Ledger service: Uri' in det.inner_text())
    page.locator('[data-person=u-mia] .jtm-name').click()
    t = det.inner_text()
    check('s5 detail Mia: cold task, covered, knowledge line, near', all(x in t for x in ['DES-2', 'cold', 'DES-3 Icon set: Noah', 'Noah: sub-task DES-3 via DES-4', 'Design tokens: Yui, Ken, Lea']), t[:600])
    check('s5 detail Mia: graph selection synced from ranking', page.get_attribute('[data-node=u-mia]', 'aria-pressed') == 'true')
    det.get_by_role('button', name='Who has worked on DES-2?').click()
    check('s5 detail opens search for its task', 'Who has worked on DES-2 Design tokens?' in page.locator('[data-testid=worked-on]').inner_text())
    page.locator('[data-person=u-omar]').count()
    page.locator('[data-person=u-mia] .jtm-name').click()  # deselect
    page.locator('[data-node=u-omar]').click()
    check('s5 detail Omar: stale flag listed, not scored', 'WEB-5' in page.locator('[data-testid=stale]').inner_text() and 'Coverage risk 0' in page.locator('[data-testid=person-detail]').inner_text())
    page.locator('[data-node=u-omar]').click()
    page.screenshot(path=f'{OUT}/stage5-detail.png', full_page=True)

    page.fill('[data-testid=search-input]', 'label:checkout-2026'); page.keyboard.press('Enter')
    names = page.locator('[data-testid=worked-on] .jtm-worked li strong').all_text_contents()
    check('s5 search area label: 5 people, closest first', names == ['Lea', 'Sam', 'Ivy', 'Vic', 'Omar'], names)
    check('s5 search shows "N more not shown"', '3 more not shown' in page.locator('[data-testid=worked-on]').inner_text())
    page.fill('[data-testid=search-input]', 'mob-3'); page.get_by_role('button', name='Search').click()
    names = page.locator('[data-testid=worked-on] .jtm-worked li strong').all_text_contents()
    check('s5 search ticket (case-insensitive)', names == ['Wen', 'Mia', 'Noah', 'Xan', 'Yui'], names)
    page.fill('[data-testid=search-input]', 'nonsense'); page.keyboard.press('Enter')
    check('s5 search no match message', 'No ticket or area matches' in page.locator('[data-testid=worked-on]').inner_text())
    page.screenshot(path=f'{OUT}/stage5-search.png', full_page=True)

    page.locator('[data-testid=data-quality] summary').click()
    dq = page.locator('[data-testid=data-quality]').inner_text()
    check('s5 data quality panel opens with numbers', all(x in dq for x in ['40 issues', '90%', 'MOB-6 unassigned', 'API-7 assignee excluded', 'Dan (deactivated)', 'Automation for Jira (bot or app)', '20%', 'project key: Omar, Yui']), dq)
    page.locator('[data-testid=data-quality]').get_by_role('button', name='Dan (deactivated)').click()
    check('s5 DQ numbers open tickets', set(page.locator('[data-testid=ticket-list] li code').all_text_contents()) == {'API-7', 'API-9'})
    page.screenshot(path=f'{OUT}/stage5-dq.png', full_page=True)

    # ======================= STAGE 6 =======================
    page.goto(BASE)
    page.wait_for_selector('[data-testid=ranking]')
    page.locator('[data-person=u-sam]').get_by_role('button', name='Mark out').click()
    check('s6 out: Sam node greyed', 'jtm-node--out' in page.get_attribute('[data-node=u-sam]', 'class'))
    check('s6 out: arrows into Sam broken + red (3)', q('[data-edge].jtm-edge--broken.jtm-edge--red') == 3, q('[data-edge].jtm-edge--broken'))
    red = sorted(page.evaluate("() => [...document.querySelectorAll('.jtm-ring--waiting')].map(c => c.parentNode.dataset.node)"))
    green = sorted(page.evaluate("() => [...document.querySelectorAll('.jtm-ring--context')].map(c => c.parentNode.dataset.node)"))
    check('s6 out: red rings on people left waiting', red == ['u-lea', 'u-omar', 'u-vic', 'u-xan'], red)
    check('s6 out: green ring on people with context', green == ['u-vic'], green)
    deltas = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].filter(li => li.querySelector('[data-testid=delta]')).map(li => [li.querySelector('.jtm-name').textContent, li.querySelector('[data-testid=delta]').textContent]))")
    check('s6 out: ranking re-scores with deltas', deltas == {'Tara': '▼ -4', 'Vic': '▼ -4', 'Lea': '▼ -2', 'Paula': '▲ +2', 'Xan': '▼ -2'}, deltas)
    ab = page.locator('[data-testid=absence]').inner_text()
    check('s6 absence panel: stalls + chains + context', all(x in ab for x in ['API-2', 'Omar → Lea → Sam', 'Vic: sub-task API-2 via API-6 (now)']), ab)
    check('s6 out: node score text shows delta', 'coverage risk 16 (-4)' in page.locator('[data-node=u-tara]').text_content())
    g = page.evaluate(GEOMETRY_JS)
    bad = {k: v for k, v in g.items() if k in ('edgeOnText', 'overlapLR', 'll', 'badgeOnNode', 'textOverflow', 'labelOnText', 'badgeOnText', 'nn') and v}
    check('s6 out: geometry still clean with live node sizes', not bad, bad)
    page.screenshot(path=f'{OUT}/stage6-sam-out.png', full_page=True)

    page.locator('[data-node=u-mia]').click()
    page.get_by_test_id('toggle-out').click()
    check('s6 two out: Mia toggled from detail', 'jtm-node--out' in page.get_attribute('[data-node=u-mia]', 'class'))
    red2 = sorted(page.evaluate("() => [...document.querySelectorAll('.jtm-ring--waiting')].map(c => c.parentNode.dataset.node)"))
    check('s6 two out: rings compose', red2 == ['u-ken', 'u-lea', 'u-omar', 'u-vic', 'u-wen', 'u-xan', 'u-yui'], red2)
    page.get_by_role('button', name='Mark Sam back in').click()
    check('s6 chip brings Sam back', 'jtm-node--out' not in page.get_attribute('[data-node=u-sam]', 'class'))
    page.get_by_role('button', name='Close Marked out').click()
    check('s6 clear: nobody out, no rings, no deltas', q('.jtm-node--out') == 0 and q('.jtm-ring') == 0 and q('[data-testid=delta]') == 0)

    # knowledge lines on select (Mia still selected)
    kl = page.evaluate("() => [...document.querySelectorAll('[data-knowledge]')].map(p => p.dataset.knowledge)")
    check('s6 select: knowledge lines only for Mia\'s work', kl == ['u-noah'], kl)
    check('s6 select: person with context not faded', 'jtm-faded' not in page.get_attribute('[data-node=u-noah]', 'class'))
    page.screenshot(path=f'{OUT}/stage6-mia-selected.png', full_page=True)
    page.locator('[data-node=u-mia]').click()
    check('s6 deselect: knowledge lines gone', q('[data-knowledge]') == 0)

    # zoom levels
    page.locator('[data-zoom=theme]').click()
    lab = page.locator('[data-label="u-ken>u-mia"]').text_content()
    check('s6 zoom theme: epic labels', 'Design system 2.0 ×2' in lab and page.get_attribute('[data-zoom=theme]', 'aria-checked') == 'true', lab)
    page.locator('[data-zoom=team]').click()
    ts = page.locator('[data-testid=team-sentences]').inner_text()
    check('s6 zoom team: team sentences', 'Mobile waits on Design, through Mia only' in ts and 'Frontend waits on Backend, through Sam only' in ts, ts)
    g = page.evaluate(GEOMETRY_JS)
    bad = {k: v for k, v in g.items() if k in ('edgeOnText', 'overlapLR', 'll', 'badgeOnNode', 'textOverflow', 'labelOnText', 'badgeOnText', 'nn') and v}
    check('s6 zoom team: geometry clean', not bad, bad)
    page.locator('[data-person=u-ivy]').get_by_role('button', name='Mark out').click()
    ts = page.locator('[data-testid=team-sentences]').inner_text()
    check('s6 zoom team + Ivy out: sentence updates live', 'Frontend waits on Design, through Mia only' in ts, ts)
    page.screenshot(path=f'{OUT}/stage6-team-ivy-out.png', full_page=True)
    page.locator('[data-zoom=ticket]').click()
    check('s6 zoom back to ticket', 'Design tokens ×2' in page.locator('[data-label="u-ken>u-mia"]').text_content())

    # keyboard through stage 5/6 controls
    page.locator('[data-zoom=ticket]').focus(); page.keyboard.press('Tab')
    check('kbd: zoom → next radio reachable', page.evaluate("() => document.activeElement.dataset.zoom") == 'theme')
    page.locator('[data-testid=search-input]').focus(); page.keyboard.type('DES-3'); page.keyboard.press('Enter')
    check('kbd: search by keyboard', 'Who has worked on DES-3' in page.locator('[data-testid=worked-on]').inner_text())

    # wording rules on the whole rendered page
    import re
    txt = page.evaluate("() => document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ') + ' ' + document.querySelector('[data-testid=sr-edges]').textContent")
    hits = sorted(set(m.lower() for m in re.findall(r'\b(knows|expert|bus factor|person risk|most important|workload|capacity|hours|backup|should ask|recommend)\b', txt, re.I)))
    check('wording: no banned terms anywhere on the page (incl. aria)', not hits, hits)

    # small fixture: absence
    page.goto(BASE + '?data=small')
    page.wait_for_selector('[data-testid=ranking]')
    page.locator('[data-person=u-ben]').get_by_role('button', name='Mark out').click()
    deltas = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-testid=ranking] .jtm-rows > li')].map(li => [li.querySelector('.jtm-name').textContent, li.querySelector('.jtm-score').textContent + (li.querySelector('[data-testid=delta]')?.textContent ?? '')]))")
    check('small Ben out: Ana 14 ▲ +6, Cy 8 ▲ +2, Dee 0 ▼ -4', deltas == {'Ana': '14▲ +6', 'Ben': '10', 'Cy': '8▲ +2', 'Pam': '2', 'Dee': '0▼ -4'}, deltas)

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
