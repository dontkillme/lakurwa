// La Kurwa - HTML user interface: HUD, panels (menu/recipes, staff, storage, shop, build), dialogs
// All texts come from the language files (LK.t, see i18n.js and game/lang/).
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (k, p) => LK.t(k, p);

LK.ui = {
  panel: null, selected: null, buildMode: false, cutaway: true, showNames: true,
  build: { tool: 'furn', furn: null, room: 'B', rot: 0 },

  init() {
    document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => this.toggle(b.dataset.panel));
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => this.setSpeed(+b.dataset.speed));
    $('btnGame').onclick = () => this.toggle('game');
    // Stats button in the owner's status box (bottom-left): the owner's own window
    $('pStatus').addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-stats]');
      if (!b) return;
      b.blur();
      this.statsFor = b.dataset.stats === '2' ? LK.state.player2 : LK.state.player;
      this.toggle('stats');
    });
    $('btnBuild').onclick = () => this.toggleBuild();
    $('panel').addEventListener('click', e => e.stopPropagation());
    $('closePanel').onclick = () => this.close();
    // HUD / build bar / dev buttons never keep the keyboard focus: Space must pause, not "click" the last button
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('#hud button, #buildBar button, #devBadge button');
      if (b) b.blur();
    });
    this.hudT = 0;
  },
  // after a language switch: redraw everything that is built from texts
  refreshTexts() {
    this.pstHTML = null; this.trayHTML = null; this.hudT = 0;
    if ($('selInfo')) $('selInfo').dataset.cid = '';
    if (this.panel) this.renderPanel();
    if (this.buildMode) this.renderBuildBar();
  },
  setSpeed(s) {
    LK.state.speed = s;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
  },
  // one window at a time: opening a window ends build mode (except its own Map file window)
  toggle(name) {
    if (this.panel === name) return this.close();
    if (this.buildMode && name !== 'map') this.toggleBuild();
    if (this.pickPost) this.endPickPost();                     // choosing a post ends too
    if (this.itemMenu) this.closeItemMenu();
    this.panel = name;
    if (name === 'game') this.gameView = 'main';
    $('panel').classList.remove('hidden');
    this.renderPanel();
  },
  close() { this.panel = null; $('panel').classList.add('hidden'); },
  renderPanel() {
    const fn = { menu: this.menuPanel, staff: this.staffPanel, storage: this.storagePanel, shop: this.shopPanel, help: this.helpPanel, map: this.mapPanel, game: this.gamePanel, stats: this.statsPanel, saves: this.savesPanel, bench: this.benchPanel, devitems: this.devItemsPanel }[this.panel];
    if (!fn) return;
    $('panelTitle').textContent = T(this.panel === 'game' && this.gameView === 'options' ? 'panel.options' : this.panel === 'saves' ? 'panel.saves.' + this.savesMode : 'panel.' + this.panel);
    $('panelBody').innerHTML = '';
    fn.call(this, $('panelBody'));
  },
  // translated names used everywhere in the UI
  taskName: t => LK.tn('task', t, t),
  skillName: s => LK.tn('skill', s, s),
  tasteName: t => LK.tn('taste', t, t),

  // ---------------- HUD ----------------
  updateHUD(dt) {
    const S = LK.state;
    if (this.itemMenu) {                                     // the item went away or the owner walked off: close its menu
      const m = this.itemMenu, p = m.p;
      if (!S.world.objects.includes(m.o) || !p.active || S.world.isBar(p.tx, p.ty) ||
          Math.max(Math.abs(m.o.x - p.tx), Math.abs(m.o.y - p.ty)) > 2) this.closeItemMenu();
    }
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.25;
    $('hMoney').textContent = Math.round(S.money) + ' M';
    $('hMoney').className = S.money < 0 ? 'neg' : '';
    const stars = Math.round(S.rep / 20 * 2) / 2;
    $('hRep').textContent = '★'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '') + ' (' + Math.round(S.rep) + ')';
    const sc = LK.stopChance(), pc = v => Math.round(v * 100);
    $('hRep').parentNode.title = T('hud.repTitle', { total: pc(sc.total), rep: pc(sc.rep), decor: pc(sc.decor), n: sc.decorN, size: pc(sc.size), tiles: sc.tiles });
    $('hTime').textContent = LK.clockText() + (LK.darkness() > 0.3 ? ' 🌙' : ' ☀');
    const inBar = S.chars.filter(c => c.kind === 'client' && S.world.isBar(c.tx, c.ty)).length;
    $('hGuests').textContent = T('hud.guests', { guests: inBar, orders: S.orders.length });
    const O = LK.orderState();
    $('hRent').textContent = T(O.squad ? 'hud.rentNow' : 'hud.rentDay', { day: O.nextDay, rent: LK.rentDue() }) +
      (O.warnings ? T('hud.rentWarn', { w: O.warnings, max: LK.RENT.maxWarnings }) : '');
    $('hRent').parentNode.className = 'stat' + (O.warnings ? ' warnstat' : '');
    $('hRent').parentNode.title = T('hud.rentTitle', { order: T('order.name'), orderPl: LK.ORDER_NAME_PL, perTile: LK.RENT.perTile, tiles: LK.barSize(), perTent: LK.RENT.perTent, tents: LK.rentTentCount(),
      every: LK.RENT.everyDays, max: LK.RENT.maxWarnings, clear: LK.RENT.clearAfter });
    // player status
    const ps = [S.player, S.player2].filter(Boolean);
    const pst = ps.map(p => '<div class="pst"><div class="psth"><b style="color:' + (p.p2 ? '#f6a' : '#6cf') + '">' + esc(p.name) + '</b>' +
      '<button class="stBtn" data-stats="' + (p.p2 ? 2 : 1) + '">' + esc(T('hud.stats')) + '</button></div>' +
      this.mini(T('status.hp'), p.hp / p.maxHp, '#e44') + this.mini(T('status.stamina'), p.stam / p.maxStam, '#4ae') +
      this.mini(T('status.load', { load: Math.round(p.load), cap: p.carryCap }), p.load / p.carryCap, p.load > p.carryCap ? '#f80' : '#aa8') +
      (p.carry ? '<div class="carry">' + esc(T('status.carrying', { item: p.carry.recipe.name, guest: p.carry.client.name })) + '</div>' : '') +
      (p.dragging ? '<div class="carry">' + esc(T('status.dragging', { name: p.dragging.name })) + '</div>' : '') +
      (p.ko > 0 ? '<div class="carry bad">' + esc(T('status.ko', { s: Math.ceil(p.ko) })) + '</div>' : '') + '</div>').join('');
    if (pst !== this.pstHTML) { this.pstHTML = pst; $('pStatus').innerHTML = pst; }   // only touch the DOM when it changed
    this.updateSelected();
    this.updateTray();
    if (this.panel === 'shop') { if ((this.panelT = (this.panelT || 0) + 1) % 8 === 0) this.renderPanel(); }
    if (this.panel === 'bench') this.refreshBench();
    if (this.panel === 'storage') { if ((this.panelT = (this.panelT || 0) + 1) % 8 === 0) this.refreshStorage(); }
    if (this.panel === 'staff' || this.panel === 'stats') { if ((this.panelT = (this.panelT || 0) + 1) % 8 === 0) this.refreshStaffBars(); }
  },
  // tickets of orders the owner(s) took; they disappear when anyone delivers them
  updateTray() {
    const S = LK.state, el = $('orderTray');
    const tickets = S.orders.filter(o => o.byPlayer);
    const top = $('hud').getBoundingClientRect().bottom;
    el.style.top = (top + 4) + 'px';
    $('panel').style.top = (top + 2) + 'px';                  // the top bar wraps with bigger text: windows start below it
    const bb = $('buildBar'); bb.style.top = (top + 2) + 'px'; bb.style.maxHeight = 'calc(100vh - ' + Math.round(top + 160) + 'px)';   // never over the top bar's buttons (phones)
    $('panel').style.maxHeight = 'calc(100vh - ' + Math.round(top + (LK.intro ? 230 : 120)) + 'px)';   // the introduction's caption needs room
    const status = o => {
      const who = o.worker ? ' – ' + o.worker.name.split(' ')[0] : '';
      const key = { bar: 'tray.bar', kitchen: 'tray.kitchen', 'cooking-wait': 'tray.cookingWait', cooking: 'tray.cooking', prep: 'tray.prep', carry: 'tray.carry' }[o.state];
      return key ? T(key) + (key === 'tray.bar' || key === 'tray.kitchen' ? '' : who) : o.state;
    };
    const html = tickets.map(o => {
      const c = o.client, k = c.ai.waitT != null ? LK.clamp(1 - c.ai.waitT / c.patience, 0, 1) : 1;
      const icon = o.kind === 'drink' ? LK.iconHTML((LK.INGREDIENTS[Object.keys(o.recipe.parts)[0]] || {}).icon || 'beer', 26) : LK.iconHTML('bowl', 26);
      const mine = o.worker && o.worker.kind === 'player';
      return '<div class="tk ' + o.kind + (mine ? ' mine' : '') + '" data-oid="' + o.id + '" title="' + esc(T('tray.tip', { guest: c.name })) + '">' + icon +
        '<div><b>' + esc(o.recipe.name) + '</b><small>' + esc(c.name.split(' ')[0]) + ' · ' + esc(status(o)) + '</small>' +
        '<i><b style="width:' + Math.round(k * 100) + '%;background:' + (k > 0.5 ? '#6c6' : k > 0.25 ? '#dc4' : '#e44') + '"></b></i></div></div>';
    }).join('');
    if (html !== this.trayHTML) {
      this.trayHTML = html; el.innerHTML = html;
      el.querySelectorAll('[data-oid]').forEach(t => t.onclick = () => { const o = S.orders.find(q => q.id == t.dataset.oid); if (o) this.selected = o.client; });
    }
    // alerts sit right under the tickets
    const al = $('alerts');
    if (al) al.style.top = ((tickets.length ? el.getBoundingClientRect().bottom : top) + 6) + 'px';
  },

  // ---------------- ALERTS (toasts top left) ----------------
  // one alert per key (a newer one replaces the text); gone after ALERT_TIME s or on click (click = open the storage)
  alerts: [],
  ALERT_TIME: 10000,
  alert(key, text, sub) {
    const box = $('alerts');
    let a = this.alerts.find(q => q.key === key);
    if (!a) {
      a = { key, el: document.createElement('div') };
      a.el.className = 'alert';
      a.el.onclick = () => this.clickAlert(a);
      if (box && box.appendChild) box.appendChild(a.el);
      this.alerts.push(a);
    }
    a.text = text;
    a.el.innerHTML = '<span class="ai">⚠</span><div>' + esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    a.el.title = T('alert.tip');
    clearTimeout(a.timer);
    a.timer = setTimeout(() => this.dismissAlert(a), this.ALERT_TIME);
    return a;
  },
  dismissAlert(a) {
    clearTimeout(a.timer);
    if (a.el && a.el.remove) a.el.remove();
    this.alerts = this.alerts.filter(q => q !== a);
  },
  clickAlert(a) {
    this.dismissAlert(a);
    this.storageTab = 'stock';
    if (this.panel !== 'storage') this.toggle('storage'); else this.renderPanel();
  },
  mini(label, k, col) {
    return '<div class="mini"><span>' + esc(label) + '</span><i><b style="width:' + Math.round(LK.clamp(k, 0, 1) * 100) + '%;background:' + col + '"></b></i></div>';
  },
  updateSelected() {
    const c = this.selected, el = $('selInfo');
    if (!c || c.kind === 'gone') { el.classList.add('hidden'); this.selected = null; return; }
    el.classList.remove('hidden');
    let h = '<b>' + esc(c.name) + '</b> <small>' + esc(T(LK.knownThief(c) ? 'who.thief' : 'who.' + c.kind)) + (c.task && c.kind === 'employee' ? ' / ' + esc(this.taskName(c.task)) : '') + '</small><br>';
    h += T('sel.stats', { hp: Math.round(Math.max(0, c.hp)), max: c.maxHp, str: c.str, sta: c.sta, int: c.int }) + '<br>';
    if (c.kind === 'client') {
      h += esc(T('sel.mood', { mood: this.moodText(c.mood), v: Math.round(c.mood) })) + '<br>';
      const st = c.ko > 0 ? (c.tied ? 'tied' : 'ko') : c.ai.state;
      h += esc(T('sel.state', { state: LK.tn('aistate', st, st) }) + (c.order ? T('sel.wants', { item: c.order.recipe.name }) : '')) + '<br>';
      h += esc(T('sel.likes', { list: Object.entries(c.prefs).filter(([, v]) => v > 0.5).map(([k]) => this.tasteName(k)).join(', ') })) + '<br>';
      h += esc(T(c.longStay ? 'sel.long' : 'sel.quick') + (c.drunk >= 3 ? T('sel.drunk') : ''));
      if (LK.tenantActive(c)) h += '<br>' + esc(T('sel.tenant', { day: c.tenant.tent.rent.until }));
      if (LK.canCallOrder(c)) h += '<br><button id="selArrest">' + esc(T('sel.callOrder', { reward: LK.THIEF.reward })) + '</button>';
    } else if (c.kind === 'employee' || c.kind === 'player') {
      h += LK.SKILLS.map(s => esc(this.skillName(s)) + ' ' + Math.floor(c.skills[s])).join(' · ');
      if (c.kind === 'employee') {
        h += '<br>' + esc(T('sel.task')) + ' <select id="selTask">' + LK.TASKS.map(t => '<option value="' + t + '"' + (t === c.task ? ' selected' : '') + '>' + esc(this.taskName(t)) + '</option>').join('') + '</select>';
        h += ' ' + this.postButtons(c);
      }
    }
    if (el.dataset.cid != c.id || !el.contains(document.activeElement)) {
      el.innerHTML = h; el.dataset.cid = c.id;
      const sel = $('selTask');
      if (sel) sel.onchange = () => { LK.dropJob(c); c.task = sel.value; c.wage = LK.wageFor(c); LK.log(T('log.taskChanged', { name: c.name, task: this.taskName(c.task) })); el.dataset.cid = ''; };
      this.bindPostButtons(el);
      const arr = $('selArrest');
      if (arr) arr.onclick = () => { LK.callArrest(c, LK.state.player); el.dataset.cid = ''; };
    }
  },
  moodText(m) { return T(m > 75 ? 'mood.happy' : m > 55 ? 'mood.fine' : m > 35 ? 'mood.meh' : m > 20 ? 'mood.annoyed' : 'mood.furious'); },

  // ---------------- MENU / RECIPES ----------------
  // tabs Drinks / Dishes, (i) help, one card per recipe: icon + numbers | name, menu switch, price check,
  // taste, ingredients table; delete in the top-right corner
  menuTab: 'drink', menuInfo: false,
  menuPanel(el) {
    const S = LK.state, tab = this.menuTab;
    const on = k => S.recipes.filter(r => r.kind === k && r.enabled).length, all = k => S.recipes.filter(r => r.kind === k).length;
    let h = '<div class="spaceTop"><b>' + esc(T('menuP.summary', { drinks: on('drink'), dishes: on('dish') })) + '</b>' +
      '<button id="menuInfo" class="info' + (this.menuInfo ? ' on' : '') + '" title="' + esc(T('menuP.info')) + '">i</button></div>' +
      (this.menuInfo ? '<div class="infoTip">' + T('menuP.hint') + '<br>' + T('menuP.hintPrice') + '</div>' : '') +
      '<div class="tabs">' + [['drink', 'menuP.tab.drink'], ['dish', 'menuP.tab.dish'], ['tent', 'menuP.tab.tent']].map(([k, key]) =>
        '<button data-mtab="' + k + '"' + (tab === k ? ' class="on"' : '') + '>' + esc(T(key, { n: k === 'tent' ? LK.rentTents(false).length : all(k) })) + '</button>').join('') + '</div>' +
      (tab === 'tent' ? '<div id="apartments"></div>' : '<div class="row"><button id="addRecipe">' + esc(T(tab === 'drink' ? 'menuP.newDrink' : 'menuP.newDish')) + '</button>' +
        (LK.hasStaffFor(tab) ? ' <button id="inventRecipes" title="' + esc(T('menuP.inventTip.' + tab)) + '">' + esc(T('menuP.invent.' + tab)) + '</button>' : '') +
        '</div><div id="recipes"></div>');
    el.innerHTML = h;
    el.querySelectorAll('[data-mtab]').forEach(b => b.onclick = () => { this.menuTab = b.dataset.mtab; this.renderPanel(); });
    el.querySelector('#menuInfo').onclick = () => { this.menuInfo = !this.menuInfo; this.renderPanel(); };
    if (tab === 'tent') return this.apartmentsTab(el.querySelector('#apartments'));
    el.querySelector('#addRecipe').onclick = () => {
      S.recipes.push(tab === 'drink' ? { name: T('menuP.newDrinkName'), kind: 'drink', price: 15, parts: { water: 0.5 }, enabled: false }
        : { name: T('menuP.newDishName'), kind: 'dish', price: 15, parts: { potatoes: 0.5 }, enabled: false });
      this.renderPanel();
    };
    const inv = el.querySelector('#inventRecipes');
    if (inv) inv.onclick = () => {
      const res = LK.inventRecipes(tab);
      if (!res.ok && res.why === 'nobody') LK.log(T('log.inventNobody.' + tab), 'warn');
      this.renderPanel();
    };
    const box = el.querySelector('#recipes');
    const list = LK.state.recipes.filter(r => r.kind === tab);
    if (!list.length) box.innerHTML = '<p class="dim">' + esc(T('menuP.none')) + '</p>';
    list.forEach(r => box.appendChild(this.recipeCard(r)));
  },
  // Apartments: the rent price (with the same price check as recipes) and a table of the rental tents
  apartmentsTab(box) {
    const S = LK.state, price = LK.tentPrice(), lvl = LK.tentLevel(price), buy = Math.round(LK.tentAcceptance(price) * 100);
    const tents = LK.rentTents(false), rented = tents.filter(o => o.rent).length;
    let h = '<div class="card aptPrice"><div class="ch"><b>' + esc(T('apt.price')) + '</b> <input type="number" id="tentPrice" min="1" value="' + price + '"> ' + esc(T('apt.perDay')) +
      ' <span class="pcheck ' + lvl + '" title="' + esc(T('apt.priceTip', { fair: LK.TENT.fair })) + '">' + esc(T('menuP.lvl.' + lvl, { buy })) + '</span>' +
      ' <button id="tentPriceReset">' + esc(T('opt.default')) + ' (' + LK.TENT.defaultPrice + ' M)</button></div>' +
      '<small>' + esc(T('apt.summary', { n: tents.length, rented, income: tents.reduce((a, o) => a + (o.rentIncome || 0), 0) })) + '</small></div>';
    if (!tents.length) h += '<p class="dim">' + esc(T('apt.none', { price: (LK.FURNITURE.rentTent || {}).price || 500 })) + '</p>';
    else {
      h += '<table class="stab"><thead><tr><th></th><th>' + esc(T('apt.col.tent')) + '</th><th>' + esc(T('apt.col.status')) + '</th><th class="am">' + esc(T('apt.col.state')) +
        '</th><th class="am">' + esc(T('apt.col.income')) + '</th></tr></thead><tbody>';
      tents.forEach((o, i) => {
        const r = o.rent, c = r && r.tenant;
        let st;
        if (!o.built) st = T('apt.blueprint');
        else if (c) st = T('apt.rented', { name: c.name, day: r.until, left: r.until - S.day + 1 }) + ' · ' + T(c.inTent ? 'apt.inside' : 'apt.away');
        else st = o.hp < LK.TENT.minHp ? T('apt.tooBroken') : T('apt.free');
        h += '<tr' + (c ? '' : ' class="dimrow"') + '><td class="ic"><canvas class="fth" width="34" height="30" data-fthumb="' + o.type + '"></canvas></td>' +
          '<td class="nm">' + esc(T('apt.tentN', { n: i + 1 })) + ' <small>(' + o.x + ', ' + o.y + ')</small></td><td>' + esc(st) + '</td>' +
          '<td class="am' + (o.hp < 50 ? ' bad' : '') + '">' + Math.round(o.hp) + ' %' + (o.dirty ? ' 💩' : '') + '</td><td class="am">' + (o.rentIncome || 0) + ' M</td></tr>';
      });
      h += '</tbody></table>';
    }
    box.innerHTML = h;
    box.querySelectorAll('canvas[data-fthumb]').forEach(cv => LK.furnThumb(cv, cv.dataset.fthumb));
    box.querySelector('#tentPrice').onchange = e => { S.tentPrice = Math.max(1, Math.round(+e.target.value || 1)); this.renderPanel(); };
    box.querySelector('#tentPriceReset').onclick = () => { S.tentPrice = LK.TENT.defaultPrice; this.renderPanel(); };
  },
  recipeCard(r) {
    const S = LK.state, d = document.createElement('div');
    const cost = LK.recipeCost(r), fair = LK.fairPrice(r), left = LK.servingsLeft(r), lvl = LK.priceLevel(r);
    const icon = r.kind === 'drink' ? (LK.INGREDIENTS[Object.keys(r.parts)[0]] || {}).icon || 'beer' : 'bowl';
    const num = (label, v, cls) => '<div>' + esc(label) + ' <b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>';
    const taste = Object.entries(LK.recipeProfile(r)).sort((a, b) => b[1] - a[1]).map(([t, f]) => '<span class="chip">' + esc(this.tasteName(t)) + ' ' + Math.round(f * 100) + '%</span>').join('');
    d.className = 'card recipe2' + (r.enabled ? '' : ' off');
    d.innerHTML = '<div class="por"><div class="ricon">' + LK.iconHTML(icon, 56) + '</div><div class="pstats">' +
        num(T('menuP.n.cost'), LK.fmt(cost) + ' M') + num(T('menuP.n.fair'), Math.round(fair) + ' M') +
        num(T('menuP.n.profit'), LK.fmt(r.price - cost) + ' M', r.price - cost < 0 ? 'bad' : 'good') +
        num(T('menuP.n.left'), left, left < 1 ? 'bad' : left < 5 ? 'warnc' : '') +
        num(T('menuP.n.sold'), r.soldToday || 0) + '</div></div>' +
      '<div class="cbody"><div class="ch"><input class="rname" value="' + esc(r.name) + '"> ' +
        '<label class="sw"><input type="checkbox" class="ren"' + (r.enabled ? ' checked' : '') + '> ' + esc(T('menuP.onMenu')) + '</label>' +
        (left < 1 ? ' <b class="bad">' + esc(T('menuP.out')) + '</b>' : '') +
        (r.auto ? ' <span class="chip auto" title="' + esc(T('menuP.byStaffTip')) + '">' + esc(T('menuP.byStaff', { name: r.auto.by })) + '</span>' : '') + '</div>' +
        '<div class="ch">' + esc(T('menuP.price')) + ' <input type="number" class="rprice" min="1" value="' + r.price + '"> M ' +
        '<span class="pcheck ' + lvl + '" title="' + esc(T('menuP.priceTip', { fair: Math.round(fair), pct: Math.round(r.price / fair * 100), buy: Math.round(LK.priceAcceptance(r) * 100) })) + '">' + esc(T('menuP.lvl.' + lvl, { buy: Math.round(LK.priceAcceptance(r) * 100) })) + '</span> ' +
        '<span class="chips">' + taste + '</span></div>' +
        '<table class="stab ings"><thead><tr><th></th><th>' + esc(T('menuP.col.ing')) + '</th><th class="am">' + esc(T('menuP.col.portion')) + '</th><th class="am">' + esc(T('menuP.col.stock')) +
        '</th><th>' + esc(T('storageP.col.unit')) + '</th><th></th></tr></thead><tbody>' +
        Object.entries(r.parts).map(([k, v]) => {
          const ing = LK.INGREDIENTS[k], st = S.stock[k] || 0;
          return '<tr' + (st < v ? ' class="short"' : '') + '><td class="ic">' + LK.iconHTML(ing.icon, 20) + '</td><td class="nm">' + esc(LK.ingName(k)) + ' <small>' + esc(this.tasteName(ing.type)) + '</small></td>' +
            '<td class="am"><input type="number" min="0.1" max="2" step="0.1" value="' + v + '" data-k="' + k + '"></td><td class="am">' + LK.fmt(st) + '</td>' +
            '<td class="un">' + esc(LK.tn('unit', ing.unit, ing.unit)) + '</td><td class="rm"><button data-rm="' + k + '" title="' + esc(T('menuP.remove')) + '">−</button></td></tr>';
        }).join('') +
        '<tr><td></td><td colspan="5"><select class="addp"><option value="">' + esc(T('menuP.addIng')) + '</option>' + Object.entries(LK.INGREDIENTS)
          .filter(([k, x]) => (x.kind === 'drink') === (r.kind === 'drink') && !(k in r.parts)).map(([k, x]) => '<option value="' + k + '">' + esc(LK.ingName(k)) + ' (' + esc(this.tasteName(x.type)) + ')</option>').join('') +
        '</select></td></tr></tbody></table></div>' +
      '<div class="act"><button class="rdel" title="' + esc(T('menuP.delete')) + '">✕</button></div>';
    const mine = () => { if (r.auto) { delete r.auto; this.renderPanel(); } };   // edited by the player: his recipe now (never replaced)
    d.querySelector('.rname').onchange = e => { r.name = e.target.value || T('menuP.unnamed'); mine(); };
    d.querySelector('.ren').onchange = e => { r.enabled = e.target.checked; this.renderPanel(); };
    d.querySelector('.rdel').onclick = () => { const R = LK.state.recipes; if (R.includes(r)) R.splice(R.indexOf(r), 1); this.renderPanel(); };
    d.querySelector('.rprice').onchange = e => { r.price = Math.max(1, Math.round(+e.target.value || 1)); delete r.auto; this.renderPanel(); };
    d.querySelectorAll('.ings input[data-k]').forEach(inp => inp.onchange = () => {
      r.parts[inp.dataset.k] = LK.clamp(Math.round((+inp.value || 0.1) * 10) / 10, 0.1, 2); delete r.auto; this.renderPanel();
    });
    d.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      if (Object.keys(r.parts).length <= 1) return LK.log(T('log.needIngredient'), 'warn');
      delete r.parts[b.dataset.rm]; delete r.auto; this.renderPanel();
    });
    d.querySelector('.addp').onchange = e => { if (e.target.value) { r.parts[e.target.value] = 0.5; delete r.auto; this.renderPanel(); } };
    return d;
  },

  // summary line + (i) button; the help text shows below it only while (i) is on (same in every window)
  info: {},
  infoBar(key, summaryHTML, title, tipHTML) {
    const on = !!this.info[key];
    return '<div class="spaceTop"><b>' + summaryHTML + '</b><button class="info' + (on ? ' on' : '') + '" data-info="' + key + '" title="' + esc(title) + '">i</button></div>' +
      (on ? '<div class="infoTip">' + tipHTML + '</div>' : '');
  },
  bindInfo(el) {
    el.querySelectorAll('[data-info]').forEach(b => b.onclick = () => { this.info[b.dataset.info] = !this.info[b.dataset.info]; this.renderPanel(); });
  },

  // ---------------- STAFF ----------------
  skillBars(c) {
    return '<div class="skills">' + LK.SKILLS.map(s => '<div class="sk"><span>' + esc(this.skillName(s)) + '</span><i><b data-sk="' + s + '" style="width:' + Math.floor(c.skills[s]) + '%"></b></i><em data-skv="' + s + '">' + Math.floor(c.skills[s]) + '</em></div>').join('') + '</div>';
  },
  // wage text + tooltip explaining it (minimum + the task's skill)
  wageHTML(c, task) {
    task = task || c.task;
    const sk = (LK.TASK_SKILLS[task] || []).slice().sort((a, b) => (c.skills[b] || 0) - (c.skills[a] || 0))[0];
    const tip = sk ? T('staffP.wageTip', { min: LK.WAGE.min, per: LK.WAGE.perSkill, skill: this.skillName(sk), v: LK.wageSkill(c, task) }) : T('staffP.wageTipIdle', { min: LK.WAGE.min });
    return '<span class="wagev" title="' + esc(tip) + '">' + esc(T('staffP.wage', { wage: LK.wageFor(c, task) })) + '</span>';
  },
  // one person: portrait with HP / STR / STA / INT below it, then name, task, wage, weapon and the skills (2 columns);
  // act = the button in the top-right corner (Fire / Hire)
  personCard(c, o) {
    const S = LK.state, weapons = Object.keys(LK.GOODS).filter(k => LK.GOODS[k].weapon);
    const head = o.applicant
      ? T('staffP.wants', { name: '<b>' + esc(c.name) + '</b>', task: '<b>' + esc(this.taskName(c.task)) + '</b>' }) + ' · ' + this.wageHTML(c)
      : '<b>' + esc(c.name) + '</b>' + (c.kind === 'player' ? ' <span class="tag">' + esc(T('staffP.owner')) + '</span>'
        : ' <select data-task="' + c.id + '">' + LK.TASKS.map(t => '<option value="' + t + '"' + (t === c.task ? ' selected' : '') + '>' + esc(this.taskName(t)) + '</option>').join('') + '</select> ' + this.postButtons(c) + this.restockBox(c) + '· ' + this.wageHTML(c)) +
        ' · ' + esc(T('staffP.weapon')) + ' <select data-weapon="' + c.id + '"><option value="">' + esc(T('staffP.fists')) + '</option>' + weapons.filter(k => (S.goods[k] || 0) > 0 || c.weapon === k)
          .map(k => '<option value="' + k + '"' + (c.weapon === k ? ' selected' : '') + '>' + esc(LK.goodName(k)) + '</option>').join('') + '</select>';
    return '<div class="card emp"' + (o.applicant ? '' : ' data-cid="' + c.id + '"') + '>' +
      '<div class="por"><canvas class="portrait" width="72" height="96" data-por="' + (o.applicant ? 'a' + o.index : c.id) + '"></canvas>' +
      '<div class="pstats"><div>' + esc(T('status.hp')) + ' <b class="hpv">' + Math.round(Math.max(0, c.hp)) + '/' + c.maxHp + '</b></div>' +
      '<div>' + esc(T('stat.str')) + ' <b>' + c.str + '</b></div><div>' + esc(T('stat.sta')) + ' <b>' + c.sta + '</b></div><div>' + esc(T('stat.int')) + ' <b>' + c.int + '</b></div>' +
      (o.extra || '') + '</div></div>' +
      '<div class="cbody"><div class="ch">' + head + '</div>' + this.skillBars(c) + '</div>' +
      (o.act ? '<div class="act">' + o.act + '</div>' : '') + '</div>';
  },
  // bartenders: may go to the merchant to restock (off by default)
  restockBox(c) {
    if (c.kind !== 'employee' || c.task !== 'bartender') return '';
    return '<label class="sw" title="' + esc(T('staffP.canRestockTip')) + '"><input type="checkbox" data-restock="' + c.id + '"' + (c.canRestock ? ' checked' : '') + '> ' + esc(T('staffP.canRestock')) + '</label> ';
  },
  // security: choose where he stands guard (📍) / back to the entrance (✕)
  postButtons(c) {
    if (c.kind !== 'employee' || c.task !== 'security') return '';
    return '<button data-post="' + c.id + '" title="' + esc(T('post.tip')) + '">' + esc(T(c.guardPost ? 'post.change' : 'post.set')) + '</button>' +
      (c.guardPost ? '<button data-postclear="' + c.id + '" title="' + esc(T('post.clearTip')) + '">✕</button>' : '') + ' ';
  },
  bindPostButtons(el) {
    const find = id => LK.state.chars.find(q => q.id == id);
    el.querySelectorAll('[data-post]').forEach(b => b.onclick = () => this.startPickPost(find(b.dataset.post)));
    el.querySelectorAll('[data-postclear]').forEach(b => b.onclick = () => {
      const c = find(b.dataset.postclear); c.guardPost = null; c.path = [];
      LK.log(T('log.postClear', { name: c.name })); this.renderPanel(); if ($('selInfo')) $('selInfo').dataset.cid = '';
    });
  },
  // pick mode: the next left click on the map sets the post; right click / Esc cancels
  startPickPost(c) {
    if (!c) return;
    this.pickPost = c;
    this.close();
    if (this.buildMode) this.toggleBuild();
    let el = $('pickBanner');
    if (!el) { el = document.createElement('div'); el.id = 'pickBanner'; document.body.appendChild(el); }
    el.textContent = T('post.pick', { name: c.name });
    el.classList.remove('hidden');
  },
  // a new / loaded game: no mode of the old game survives (post picking, build mode, item menu, selection, touch)
  resetModes() {
    this.endPickPost();
    if (this.itemMenu) this.closeItemMenu();
    if (this.buildMode) this.toggleBuild();
    this.selected = null; this.statsFor = null;
    if (LK.input) { LK.input.drag = false; LK.input.pan = null; LK.input.joy = null; LK.input.runToggle = false; }
    if (LK.touch && LK.touch.release) LK.touch.release();
  },
  endPickPost() {
    this.pickPost = null;
    const el = $('pickBanner'); if (el) el.classList.add('hidden');
  },
  setPost(x, y) {
    const c = this.pickPost, w = LK.state.world;
    if (!c) return false;
    if (!w.inb(x, y) || !w.walkable(x, y) || w.pathTo(c.tx, c.ty, x, y) === null) { LK.log(T('log.postBad'), 'warn'); return false; }
    c.guardPost = { x, y }; c.path = []; LK.dropJob(c);
    LK.log(T('log.postSet', { name: c.name }), 'good');
    this.endPickPost();
    this.selected = c; if ($('selInfo')) $('selInfo').dataset.cid = '';
    return true;
  },
  drawPortraits(el, find) {
    el.querySelectorAll('canvas[data-por]').forEach(cv => { const c = find(cv.dataset.por); if (c) LK.drawPortrait(cv, c); });
  },
  refreshStaffBars() {
    document.querySelectorAll('#panelBody [data-cid]').forEach(card => {
      const c = LK.state.chars.find(q => q.id == card.dataset.cid);
      if (!c) return;
      LK.SKILLS.forEach(s => {
        const b = card.querySelector('[data-sk="' + s + '"]'), v = card.querySelector('[data-skv="' + s + '"]');
        if (b) b.style.width = Math.floor(c.skills[s]) + '%';
        if (v) v.textContent = Math.floor(c.skills[s]);
      });
      const hp = card.querySelector('.hpv'); if (hp) hp.textContent = Math.round(Math.max(0, c.hp)) + '/' + c.maxHp + (c.ko > 0 ? ' (KO)' : '');
      const wv = card.querySelector('.wagev'); if (wv && c.kind === 'employee') wv.textContent = T('staffP.wage', { wage: LK.wageFor(c) });
      const ld = card.querySelector('.ldv'); if (ld) ld.textContent = Math.round(c.load) + '/' + c.carryCap + ' kg';
    });
  },
  // task / weapon selects of person cards (staff panel and stats panel)
  bindPersonCards(el) {
    this.bindPostButtons(el);                                 // handlers read LK.state when clicked (a new game may have started)
    el.querySelectorAll('[data-restock]').forEach(b => b.onchange = () => { const c = LK.state.chars.find(q => q.id == b.dataset.restock); if (c) c.canRestock = b.checked; });
    el.querySelectorAll('[data-task]').forEach(s => s.onchange = () => {
      const c = LK.state.chars.find(q => q.id == s.dataset.task);
      if (!c) return;
      LK.dropJob(c); c.task = s.value; c.wage = LK.wageFor(c);
      this.renderPanel();
    });
    el.querySelectorAll('[data-weapon]').forEach(s => s.onchange = () => {
      const S = LK.state, c = S.chars.find(q => q.id == s.dataset.weapon);
      if (!c) return;
      if (c.weapon) S.goods[c.weapon] = (S.goods[c.weapon] || 0) + 1;
      c.weapon = s.value || null;
      if (c.weapon) S.goods[c.weapon]--;
      this.renderPanel();
    });
  },
  staffPanel(el) {
    const S = LK.state;
    const staff = S.chars.filter(c => c.kind === 'employee');
    const wages = staff.reduce((a, c) => a + LK.wageFor(c), 0);
    const tab = this.staffTab;
    let h = this.infoBar('staff', esc(T('staffP.summary', { n: staff.length, wages })), T('staffP.info'), T('staffP.hint', { min: LK.WAGE.min, per: LK.WAGE.perSkill }));
    h += '<div class="tabs">' + [['mine', staff.length], ['hire', S.applicants.length]].map(([k, n]) =>
      '<button data-stab="' + k + '"' + (tab === k ? ' class="on"' : '') + '>' + esc(T('staffP.tab.' + k, { n })) + '</button>').join('') + '</div>';
    if (tab === 'mine') {
      h += staff.map(c => this.personCard(c, { act: '<button data-fire="' + c.id + '">' + esc(T('staffP.fire')) + '</button>' })).join('') ||
        '<p class="dim">' + esc(T('staffP.noStaff')) + ' <button data-stab="hire">' + esc(T('staffP.goHire')) + '</button></p>';
    } else {
      h += '<p class="hint">' + esc(T('staffP.looking')) + '</p>';
      h += S.applicants.map((a, i) => this.personCard(a, { applicant: true, index: i, act: '<button data-hire="' + a.id + '">' + esc(T('staffP.hire')) + '</button>' })).join('') ||
        '<p>' + esc(T('staffP.nobody')) + '</p>';
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { this.staffTab = b.dataset.stab; this.renderPanel(); });
    this.bindInfo(el);
    this.refreshStaffBars();
    this.drawPortraits(el, k => k[0] === 'a' ? S.applicants[+k.slice(1)] : S.chars.find(q => q.id == k));
    this.bindPersonCards(el);
    el.querySelectorAll('[data-fire]').forEach(b => b.onclick = () => { LK.fire(LK.state.chars.find(q => q.id == b.dataset.fire)); this.renderPanel(); });
    el.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => {   // by id: the list changes every morning
      const a = LK.state.applicants.find(q => q.id == b.dataset.hire);
      if (a) LK.hire(a); else LK.log(T('log.applicantGone'), 'warn');
      this.renderPanel();
    });
  },
  staffTab: 'mine',                                          // Staff window tab: 'mine' (my employees) | 'hire'
  // the owner's own window (Stats button in the bottom-left corner)
  statsPanel(el) {
    const S = LK.state, p = this.statsFor && S.chars.includes(this.statsFor) ? this.statsFor : S.player;
    const extra = '<div>' + esc(T('status.stamina')) + ' <b>' + Math.round(p.stam) + '/' + p.maxStam + '</b></div>' +
      '<div>' + esc(T('stat.load')) + ' <b class="ldv">' + Math.round(p.load) + '/' + p.carryCap + ' kg</b></div>';
    el.innerHTML = this.infoBar('stats', esc(p.name), T('statsP.info'), T('statsP.hint')) + this.personCard(p, { extra });
    this.bindInfo(el);
    this.refreshStaffBars();
    this.drawPortraits(el, () => p);
    this.bindPersonCards(el);
  },

  // ---------------- STORAGE ----------------
  // three tabs of icon | name | amount | unit tables; the help text sits behind the (i) button
  storageTab: 'stock', storageInfo: false,
  storagePanel(el) {
    const html = this.storageHTML();
    this.storageLast = html;
    el.innerHTML = html;
    el.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { this.storageTab = b.dataset.stab; this.renderPanel(); });
    const info = el.querySelector('#storageInfo');
    if (info) info.onclick = () => { this.storageInfo = !this.storageInfo; this.renderPanel(); };
    el.querySelectorAll('canvas[data-fthumb]').forEach(cv => LK.furnThumb(cv, cv.dataset.fthumb));
    // send for supplies
    const sv = this.supply, se = el.querySelector('#supEmp'), sm = el.querySelector('#supMoney'), sg = el.querySelector('#supGo');
    if (se) se.onchange = () => { sv.emp = +se.value; this.renderPanel(); };   // the trip time range depends on him
    if (sm) sm.onchange = () => { sv.money = Math.max(0, Math.round(+sm.value || 0)); };
    if (sg) sg.onclick = () => {
      const c = LK.state.chars.find(q => q.id == (se ? se.value : 0));
      const r = LK.sendForSupplies(c, +sm.value);
      if (!r.ok) LK.log(T('log.supplyNo.' + r.why), 'warn'); else { sv.money = null; sv.emp = null; }
      this.renderPanel();
    };
    el.querySelectorAll('[data-desired]').forEach(inp => inp.onchange = () => {
      const S = LK.state; S.desired = S.desired || {};
      const v = Math.max(0, Math.round(+inp.value || 0));
      if (v) S.desired[inp.dataset.desired] = v; else delete S.desired[inp.dataset.desired];
      this.renderPanel();
    });
  },
  // called every ~2 s while the panel is open: only touch the DOM when something changed
  refreshStorage() {
    const el = $('panelBody');
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && el.contains && el.contains(a)) return;     // don't redraw while typing / choosing
    if (this.storageHTML() !== this.storageLast) this.storagePanel(el);
  },
  // storage window: the "send for supplies" box (Food & drink tab)
  supply: { emp: null, money: null },
  supplyBox() {
    const S = LK.state, sv = this.supply, need = LK.supplyNeeds();
    const free = S.chars.filter(LK.canGoForSupplies), away = S.chars.filter(c => c.trip);
    const nd = need.drink.reduce((a, i) => a + i.n, 0), nf = need.food.reduce((a, i) => a + i.n, 0);
    const est = LK.supplyEstimate();
    if (sv.money == null) sv.money = Math.min(Math.floor(S.money), est);
    let h = '<div class="card supply"><div class="ch"><b>🧺 ' + esc(T('supply.title')) + '</b> <small>' + esc(T('supply.hint')) + '</small></div>';
    h += '<div class="ch">' + esc(nd || nf ? T('supply.needs', { d: nd, f: nf, est }) : T(away.length ? 'supply.allComing' : 'supply.nothing')) + '</div>';
    if (free.length && (nd || nf)) {
      h += '<div class="ch supRow"><select id="supEmp">' + free.map(c => '<option value="' + c.id + '"' + (c.id === sv.emp ? ' selected' : '') + '>' +
          esc(c.name + ' (' + this.taskName(c.task) + ', ' + T('supply.carries', { kg: c.carryCap }) + ')') + '</option>').join('') + '</select> ' +
        '<label>' + esc(T('supply.money')) + ' <input type="number" id="supMoney" min="0" step="10" value="' + sv.money + '"> M</label> ' +
        '<button id="supGo">' + esc(T('supply.go')) + '</button></div>';
      const pick = free.find(c => c.id === sv.emp) || free[0], [lo, hi] = LK.SUPPLY.minutes;
      h += '<div class="ch dim">' + esc(T('supply.time', { min: LK.fmtMinutes(lo), max: LK.fmtMinutes(LK.supplyMinutes(pick, hi)), skill: Math.round(pick.skills.vendor || 0) })) + '</div>';
    } else if (!free.length) h += '<div class="ch dim">' + esc(T('supply.noStaff')) + '</div>';
    for (const c of away) h += '<div class="ch away">' + esc(T(c.trip.state === 'back' ? 'supply.coming' : 'supply.away', { name: c.name, money: c.trip.money, back: LK.supplyBackText(c) })) + '</div>';
    return h + '</div>';
  },
  storageHTML() {
    const S = LK.state, w = S.world;
    const used = LK.storageUsed(), cap = LK.storageCapacity();
    const byType = {};
    for (const o of LK.storageFurniture()) byType[o.type] = (byType[o.type] || 0) + 1;
    const pcs = T('unit.pcs');
    // desired = 'stock:key' / 'goods:key': the auto-restock target (input next to the amount); undefined = no input (furniture)
    const des = S.desired || {};
    const row = (icon, name, n, unit, dim, extra, desired) => '<tr' + (dim ? ' class="dim"' : '') + '><td class="ic">' + icon + '</td><td class="nm">' + esc(name) +
      (extra ? ' <small>' + esc(extra) + '</small>' : '') + '</td><td class="am">' + n + '</td><td class="de">' +
      (desired ? '<input type="number" min="0" step="1" data-desired="' + desired + '" value="' + (des[desired] || 0) + '" title="' + esc(T('storageP.desiredTip')) + '">' : '') +
      '</td><td class="un">' + esc(unit) + '</td></tr>';
    const sect = title => '<tr class="sec"><th colspan="5">' + esc(title) + '</th></tr>';
    const furnIcon = k => '<canvas class="fth" width="34" height="30" data-fthumb="' + esc(k) + '"></canvas>';
    const table = rows => '<table class="stab"><thead><tr><th></th><th>' + esc(T('storageP.col.name')) + '</th><th class="am">' + esc(T('storageP.col.amount')) +
      '</th><th class="de" title="' + esc(T('storageP.desiredTip')) + '">' + (this.storageTab === 'placed' ? '' : esc(T('storageP.col.desired'))) + '</th><th>' + esc(T('storageP.col.unit')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    let h = '<div class="space"><div class="spaceTop"><b class="' + (used >= cap ? 'bad' : '') + '">' + esc(T('storageP.space', { used, cap })) + '</b>' +
      '<button id="storageInfo" class="info' + (this.storageInfo ? ' on' : '') + '" title="' + esc(T('storageP.info')) + '">i</button></div>' +
      (this.storageInfo ? '<div class="infoTip">' + T('storageP.hint') + '</div>' : '') +
      '<i><b style="width:' + Math.min(100, Math.round(used / cap * 100)) + '%;background:' + (used >= cap ? '#e44' : used > cap * 0.85 ? '#dc4' : '#6c6') + '"></b></i>' +
      '<small>' + esc(T('storageP.floor', { n: LK.STORAGE_BASE })) + Object.entries(byType).map(([k, n]) => ' + ' + n + '× ' + esc(LK.furnName(k)) + ' (' + LK.FURNITURE[k].capacity * n + ')').join('') + '</small></div>';
    h += '<div class="tabs">' + [['stock', 'storageP.tab.stock'], ['other', 'storageP.tab.other'], ['placed', 'storageP.tab.placed']].map(([k, key]) =>
      '<button data-stab="' + k + '"' + (this.storageTab === k ? ' class="on"' : '') + '>' + esc(T(key)) + '</button>').join('') + '</div>';
    const tab = this.storageTab;
    if (tab === 'stock') {
      h += this.supplyBox();
      let rows = '';
      for (const [kind, title] of [['drink', 'storageP.drinks'], ['food', 'storageP.food']]) {
        rows += sect(T(title));
        rows += Object.entries(LK.INGREDIENTS).filter(([, d]) => d.kind === kind).map(([k, d]) =>
          row(LK.iconHTML(d.icon, 22), LK.ingName(k), LK.fmt(S.stock[k] || 0), LK.tn('unit', d.unit, d.unit), (S.stock[k] || 0) < 1, this.tasteName(d.type), 'stock:' + k)).join('');
      }
      h += table(rows);
    } else if (tab === 'other') {
      const goods = Object.entries(LK.GOODS).map(([k]) => [k, S.goods[k] || 0]).filter(([k, n]) => n > 0 || (des['goods:' + k] || 0) > 0 || k === 'materials');
      let rows = sect(T('storageP.other'));
      rows += goods.map(([k, n]) => row(LK.iconHTML(LK.GOODS[k].icon, 22), LK.goodName(k), n, pcs, n < 1, '', 'goods:' + k)).join('') || '<tr class="dim"><td></td><td colspan="4">—</td></tr>';
      rows += sect(T('storageP.furn'));
      rows += Object.entries(S.furn).filter(([k, n]) => n > 0 && LK.FURNITURE[k]).map(([k, n]) => row(furnIcon(k), LK.furnName(k), n, pcs)).join('') || '<tr class="dim"><td></td><td colspan="4">—</td></tr>';
      h += table(rows);
    } else {
      // furniture standing in the world that belongs to the bar (not the wasteland's trees and rocks)
      const placed = {};
      for (const o of w.objects) {
        const d = LK.FURNITURE[o.type];
        if (!d || d.nosell) continue;
        const p = placed[o.type] || (placed[o.type] = { n: 0, blue: 0, rooms: new Set() });
        p.n++; if (!o.built) p.blue++;
        const r = w.room(o.x, o.y); p.rooms.add(r === '.' ? T('storageP.outside') : LK.tn('room', r, (LK.ROOMS[r] || {}).name || r));
      }
      const list = Object.entries(placed).sort((a, b) => LK.furnName(a[0]).localeCompare(LK.furnName(b[0])));
      h += list.length ? table(list.map(([k, p]) => row(furnIcon(k), LK.furnName(k), p.n, pcs, false,
        [...p.rooms].join(', ') + (p.blue ? ' · ' + T('storageP.blueprints', { n: p.blue }) : ''))).join('')) : '<p class="dim">' + esc(T('storageP.placedNone')) + '</p>';
    }
    // what the owners carry (not in the storage yet)
    for (const p of [S.player, S.player2].filter(Boolean)) {
      const cg = p.cargo || LK.emptyCargo();
      const items = [].concat(Object.entries(cg.stock).map(([k, n]) => LK.ingName(k) + ' ×' + n), Object.entries(cg.goods).map(([k, n]) => LK.goodName(k) + ' ×' + n), Object.entries(cg.furn).map(([k, n]) => LK.furnName(k) + ' ×' + n));
      if (items.length) h += '<h3>' + esc(T('storageP.carried', { name: p.name, kg: Math.round(p.load) })) + '</h3><div>' + items.map(esc).join(', ') + '</div>';
    }
    return h;
  },

  // ---------------- SHOP ----------------
  openShop(buyer, m) {
    m = m || LK.nearMerchant(buyer);
    if (!m) return;
    if (!m.shop) m.shop = LK.makeMerchantStock(buyer.skills.vendor);
    this.shopBuyer = buyer; this.shopMerchant = m;
    this.panel = null; this.toggle('shop');
  },
  closeShop(m) { if (this.panel === 'shop' && (!m || this.shopMerchant === m)) this.close(); },   // m: only his shop
  shopPanel(el) {
    const S = LK.state, m = LK.merchantList().includes(this.shopMerchant) ? this.shopMerchant : null, b = this.shopBuyer || S.player;
    if (!m || !m.shop) { el.innerHTML = '<p>' + esc(T('shop.gone')) + '</p>'; return; }
    if (LK.dist(b.x, b.y, m.x, m.y) > 3) { el.innerHTML = '<p>' + esc(T('shop.closer')) + '</p>'; return; }
    const carrying = LK.itemCount((b.cargo || {}).stock, (b.cargo || {}).goods, (b.cargo || {}).furn);
    let h = '<p class="hint">' + T('shop.hint', { buyer: '<b>' + esc(b.name) + '</b>', vendor: Math.floor(b.skills.vendor), disc: Math.round(LK.vendorDiscount(b) * 100),
      money: '<b>' + Math.round(S.money) + ' M</b>', load: Math.round(b.load), cap: b.carryCap,
      free: '<b class="' + (LK.storageFree() <= 0 ? 'bad' : '') + '">' + LK.storageFree() + '</b>' }) +
      (carrying ? ' ' + esc(T('shop.carrying', { n: carrying })) : '') + '</p>';
    for (const cat of ['stock', 'furn', 'goods', 'plan']) {
      if (cat === 'plan' && !m.shop.some(it => it.cat === 'plan')) continue;
      h += '<h3>' + esc(T('shop.cat.' + cat)) + '</h3><table class="shop">';
      m.shop.forEach((it, i) => {
        if (it.cat !== cat) return;
        if (cat === 'plan') {                                 // a plan: the item, what it needs, how long; one per visit
          const [pc, pk] = it.key.split(':'), r = LK.craftRecipe(pc, pk), owned = LK.hasPlan(pc, pk);
          h += '<tr' + (it.qty && !owned ? '' : ' class="dim"') + '><td>' + LK.iconHTML('i032', 18) + ' ' + esc(T('shop.plan', { name: LK.itemName(pc, pk) })) +
            ' <small>' + esc(T('shop.planNeeds', { mats: LK.matsText(r.mats) })) + '</small></td><td>' + LK.shopPrice(it, b) + ' M</td><td>' + (owned ? esc(T('shop.planOwned')) : '×' + it.qty) + '</td>' +
            '<td><button data-buy="' + i + '" data-n="1"' + (it.qty && !owned ? '' : ' disabled') + '>' + esc(T('shop.buy')) + '</button></td></tr>';
          return;
        }
        const name = cat === 'stock' ? LK.ingName(it.key) : cat === 'goods' ? LK.goodName(it.key) : LK.furnName(it.key);
        const extra = cat === 'stock' ? this.tasteName(LK.INGREDIENTS[it.key].type) :
          cat === 'goods' ? (LK.hasT('goodsDesc.' + it.key) ? T('goodsDesc.' + it.key) : LK.GOODS[it.key].desc || (LK.GOODS[it.key].weapon ? T('shop.dmg', { n: LK.GOODS[it.key].weapon }) : '')) :
          (LK.FURNITURE[it.key].capacity ? T('shop.space', { n: LK.FURNITURE[it.key].capacity }) + ', ' : '') + LK.FURNITURE[it.key].tags.map(t => LK.tn('tag', t, t)).join(', ');
        const ic = cat === 'stock' ? LK.INGREDIENTS[it.key].icon : cat === 'goods' ? LK.GOODS[it.key].icon : LK.FURNITURE[it.key].icon;
        h += '<tr' + (it.qty ? '' : ' class="dim"') + '><td>' + LK.iconHTML(ic, 18) + ' ' + esc(name) + ' <small>' + esc(extra) + '</small></td><td>' + LK.shopPrice(it, b) + ' M</td><td>×' + it.qty + '</td>' +
          '<td><button data-buy="' + i + '" data-n="1"' + (it.qty ? '' : ' disabled') + '>' + esc(T('shop.buy')) + '</button>' + (cat !== 'furn' ? ' <button data-buy="' + i + '" data-n="5"' + (it.qty >= 5 ? '' : ' disabled') + '>×5</button>' : '') + '</td></tr>';
      });
      h += '</table>';
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-buy]').forEach(btn => btn.onclick = () => { LK.buy(m.shop[+btn.dataset.buy], b, +btn.dataset.n); this.renderPanel(); });
  },

  // ---------------- WORKBENCH (E at a workbench; craft.js) ----------------
  bench: null, benchTab: 'craft',
  openBench(b) { this.bench = b; if (this.panel === 'bench') this.renderPanel(); else this.toggle('bench'); },
  itemIcon(cat, key) {
    return cat === 'furn' ? '<canvas class="fth" width="34" height="30" data-fthumb="' + key + '"></canvas>' : LK.iconHTML((LK.GOODS[key] || {}).icon, 22);
  },
  benchPanel(el) {
    const S = LK.ensureCraftState(), b = this.bench, C = LK.CRAFT, tab = this.benchTab;
    if (!b || !S.world.objects.includes(b) || !b.built) { el.innerHTML = '<p>' + esc(T('bench.gone')) + '</p>'; return; }
    const q = LK.benchQueue(b), all = LK.craftables(), owned = all.filter(i => LK.hasPlan(i.cat, i.key)), p = S.player;
    const near = LK.dist(p.x, p.y, b.x + 0.5, b.y + 0.5) < 2.6;
    const worker = S.chars.find(o => o.job && o.job.type === 'craft' && o.job.bench === b);
    const matsHTML = mats => Object.entries(mats).map(([m, n]) => { const have = S.goods[m] || 0;
      return '<span class="' + (have >= n ? 'good' : 'bad') + '" title="' + esc(T('bench.haveTip', { have })) + '">' + n + '× ' + esc(LK.goodName(m)) + '</span>'; }).join(', ');
    let h = this.infoBar('bench', esc(T('bench.summary', { n: q.length, max: C.queueMax, plans: owned.length, all: all.length })), T('bench.infoTitle'),
      T('bench.info', { max: C.queueMax, place: C.placeTime, lo: Math.round(C.recycle[0] * 100), hi: Math.round(C.recycle[1] * 100) }));
    h += '<h3>' + esc(T('bench.queue')) + '</h3>';
    if (!q.length) h += '<p class="dim">' + esc(T('bench.empty')) + '</p>';
    else h += '<table class="stab bq"><tbody>' + q.map((e, i) => { const pct = Math.floor(e.done / e.time * 100);
      return '<tr><td class="ic">' + this.itemIcon(e.cat, e.key) + '</td><td class="nm">' + esc(T(e.kind === 'craft' ? 'bench.craftEntry' : 'bench.recycleEntry', { name: LK.itemName(e.cat, e.key) })) +
        '</td><td class="am"><i class="pbar"><b data-bqp="' + i + '" style="width:' + pct + '%"></b></i> <span data-bqt="' + i + '">' + pct + ' %</span></td>' +
        '<td class="rm"><button data-unq="' + i + '" title="' + esc(T('bench.remove')) + '">✕</button></td></tr>'; }).join('') + '</tbody></table>';
    h += '<div class="row">' + esc(worker ? T('bench.workedBy', { name: worker.name }) : q.length ? T('bench.nobody') : '') +
      (q.length && near && worker !== p ? ' <button id="benchDo">' + esc(T('bench.doIt')) + '</button>' : '') + '</div>';
    h += '<div class="tabs">' + ['craft', 'recycle'].map(k => '<button data-btab="' + k + '"' + (tab === k ? ' class="on"' : '') + '>' + esc(T('bench.tab.' + k, { n: owned.length })) + '</button>').join('') + '</div>';
    const full = q.length >= C.queueMax;
    if (tab === 'craft') {
      if (!owned.length) h += '<p class="dim">' + esc(T('bench.noPlans')) + '</p>';
      else h += '<table class="stab"><thead><tr><th></th><th>' + esc(T('bench.col.item')) + '</th><th>' + esc(T('bench.col.mats')) + '</th><th class="am">' + esc(T('bench.col.time')) + '</th><th></th></tr></thead><tbody>' +
        owned.map(i => { const r = LK.craftRecipe(i.cat, i.key), ok = LK.hasMats(r.mats) && !full;
          return '<tr><td class="ic">' + this.itemIcon(i.cat, i.key) + '</td><td class="nm">' + esc(LK.itemName(i.cat, i.key)) + '</td><td>' + matsHTML(r.mats) + '</td><td class="am">' + r.time + ' s</td>' +
            '<td><button data-craft="' + i.cat + ':' + i.key + '"' + (ok ? '' : ' disabled') + '>' + esc(T('bench.craft')) + '</button></td></tr>'; }).join('') + '</tbody></table>';
      if (owned.length < all.length) h += '<p class="hint">' + esc(T('bench.morePlans', { n: all.length - owned.length })) + '</p>';
    } else {
      const list = all.filter(i => ((i.cat === 'furn' ? S.furn : S.goods)[i.key] || 0) > 0);
      if (!list.length) h += '<p class="dim">' + esc(T('bench.nothingToRecycle')) + '</p>';
      else h += '<table class="stab"><thead><tr><th></th><th>' + esc(T('bench.col.item')) + '</th><th>' + esc(T('bench.col.back', { lo: Math.round(C.recycle[0] * 100), hi: Math.round(C.recycle[1] * 100) })) + '</th><th class="am">' + esc(T('bench.col.time')) + '</th><th></th></tr></thead><tbody>' +
        list.map(i => { const r = LK.craftRecipe(i.cat, i.key), n = (i.cat === 'furn' ? S.furn : S.goods)[i.key], cr = i.cat === 'furn' ? LK.craftedCount(i.key) : 0;
          return '<tr><td class="ic">' + this.itemIcon(i.cat, i.key) + '</td><td class="nm">' + esc(LK.itemName(i.cat, i.key)) + ' ×' + n + (cr ? ' <small>🔨' + cr + '</small>' : '') + '</td><td>' + esc(LK.matsText(r.mats)) + '</td><td class="am">' + r.time + ' s</td>' +
            '<td><button data-recycle="' + i.cat + ':' + i.key + '"' + (full ? ' disabled' : '') + '>' + esc(T('bench.recycle')) + '</button></td></tr>'; }).join('') + '</tbody></table>';
    }
    el.innerHTML = h;
    this.bindInfo(el);
    el.querySelectorAll('canvas[data-fthumb]').forEach(cv => LK.furnThumb(cv, cv.dataset.fthumb));
    el.querySelectorAll('[data-btab]').forEach(x => x.onclick = () => { this.benchTab = x.dataset.btab; this.renderPanel(); });
    el.querySelectorAll('[data-unq]').forEach(x => x.onclick = () => { LK.unqueue(b, +x.dataset.unq); this.renderPanel(); });
    el.querySelectorAll('[data-craft]').forEach(x => x.onclick = () => {
      const [c, k] = x.dataset.craft.split(':'), r = LK.queueCraft(b, c, k);
      if (!r.ok) LK.log(T(r.why === 'full' ? 'log.queueFull' : 'log.noMats', { max: C.queueMax, name: LK.itemName(c, k) }), 'warn');
      this.renderPanel();
    });
    el.querySelectorAll('[data-recycle]').forEach(x => x.onclick = () => {
      const [c, k] = x.dataset.recycle.split(':'), r = LK.queueRecycle(b, c, k);
      if (!r.ok && r.why === 'full') LK.log(T('log.queueFull', { max: C.queueMax }), 'warn');
      this.renderPanel();
    });
    const doIt = el.querySelector('#benchDo');
    if (doIt) doIt.onclick = () => { if (LK.ownerCraft(p, b)) this.close(); };
    this.benchSig = q.map(e => e.kind + e.key).join(',');
  },
  // every frame while the window is open: the progress bars (a changed queue = redraw)
  refreshBench() {
    const b = this.bench, q = b && b.queue || [];
    if (q.map(e => e.kind + e.key).join(',') !== this.benchSig) return this.renderPanel();
    q.forEach((e, i) => {
      const pct = Math.floor(e.done / e.time * 100), bar = document.querySelector('[data-bqp="' + i + '"]'), txt = document.querySelector('[data-bqt="' + i + '"]');
      if (bar && bar.style) bar.style.width = pct + '%';
      if (txt && txt.textContent !== pct + ' %') txt.textContent = pct + ' %';
    });
  },

  // ---------------- DEV: add any item to the storage (F2 → Add item, key Z) ----------------
  devItemsPanel(el) {
    const S = LK.state, I = LK.INGREDIENTS, G = LK.GOODS, F = LK.FURNITURE;
    const cats = [
      ['drink', 'stock', Object.keys(I).filter(k => I[k].kind === 'drink')],
      ['food', 'stock', Object.keys(I).filter(k => I[k].kind !== 'drink')],
      ['mats', 'goods', Object.keys(G).filter(k => G[k].craftMat || k === 'materials')],
      ['goods', 'goods', Object.keys(G).filter(k => !G[k].craftMat && k !== 'materials')],
      ['furn', 'furn', Object.keys(F).filter(k => !F[k].nosell)],
      ['deco', 'furn', Object.keys(F).filter(k => F[k].nosell)]
    ];
    const have = (cat, k) => LK.fmt((cat === 'stock' ? S.stock : cat === 'goods' ? S.goods : S.furn)[k] || 0);
    const name = (cat, k) => cat === 'stock' ? LK.ingName(k) : cat === 'goods' ? LK.goodName(k) : LK.furnName(k);
    const icon = (cat, k) => cat === 'furn' ? '<canvas class="fth" width="34" height="30" data-fthumb="' + k + '"></canvas>' : LK.iconHTML((cat === 'stock' ? I : G)[k].icon, 22);
    let h = '<p class="hint">' + esc(T('devI.hint', { used: LK.storageUsed(), cap: LK.storageCapacity() })) + '</p>' +
      '<input id="devISearch" placeholder="' + esc(T('devI.search')) + '" style="width:100%;margin-bottom:6px">';
    for (const [id, cat, keys] of cats) {
      if (!keys.length) continue;
      h += '<div class="devCat" data-devcat="' + id + '"><h3>' + esc(T('devI.cat.' + id)) + ' <small>(' + keys.length + ')</small></h3><table class="stab"><tbody>' +
        keys.map(k => '<tr data-devrow="' + esc((name(cat, k) + ' ' + k).toLowerCase()) + '"><td class="ic">' + icon(cat, k) + '</td><td class="nm">' + esc(name(cat, k)) + ' <small>' + esc(k) + '</small></td>' +
          '<td class="am" title="' + esc(T('devI.inStorage')) + '"><b data-devhave="' + cat + ':' + k + '">' + have(cat, k) + '</b></td><td>' +
          [1, 5, 10].map(n => '<button data-devadd="' + cat + ':' + k + ':' + n + '">+' + n + '</button>').join(' ') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    el.innerHTML = h;
    el.querySelectorAll('canvas[data-fthumb]').forEach(cv => LK.furnThumb(cv, cv.dataset.fthumb));
    el.querySelectorAll('[data-devadd]').forEach(b => b.onclick = () => {   // update the count in place (no redraw: keeps the scroll)
      const [cat, k, n] = b.dataset.devadd.split(':');
      LK.dev.addItem(cat, k, +n);
      const c = el.querySelector('[data-devhave="' + cat + ':' + k + '"]'); if (c) c.textContent = have(cat, k);
      const hint = el.querySelector('.hint'); if (hint) hint.textContent = T('devI.hint', { used: LK.storageUsed(), cap: LK.storageCapacity() });
    });
    const search = el.querySelector('#devISearch');
    search.oninput = () => {                                   // filter rows in place (typing keeps the focus)
      const q = search.value.trim().toLowerCase();
      el.querySelectorAll('[data-devrow]').forEach(r => { r.style.display = !q || r.dataset.devrow.includes(q) ? '' : 'none'; });
      el.querySelectorAll('[data-devcat]').forEach(c => { c.style.display = [...c.querySelectorAll('[data-devrow]')].some(r => r.style.display !== 'none') ? '' : 'none'; });
    };
  },

  // ---------------- GAME MENU (save, load, options, main menu) ----------------
  gameView: 'main',
  gamePanel(el) {
    if (this.gameView === 'options') return this.optionsPanel(el);
    el.innerHTML = '<div class="gmenu">' +
      '<button id="gmSave"' + (LK.state.over ? ' disabled' : '') + '>💾 ' + esc(T('hud.save')) + '</button>' +   // a lost game can't be saved
      '<button id="gmLoad">📂 ' + esc(T('hud.load')) + '</button>' +
      '<button id="gmOptions">⚙ ' + esc(T('gm.options')) + '</button>' +
      '<button id="gmMain">🏠 ' + esc(T('hud.mainMenu')) + '</button>' +
      '<button id="gmBack">↩ ' + esc(T('gm.resume')) + '</button></div><div class="ver">v' + esc(LK.VERSION) + '</div>';
    el.querySelector('#gmSave').onclick = () => this.openSaves('save');
    el.querySelector('#gmLoad').onclick = () => this.openSaves('load');
    el.querySelector('#gmOptions').onclick = () => { this.gameView = 'options'; this.renderPanel(); };
    el.querySelector('#gmMain').onclick = () => { this.close(); LK.showSplash(true); };
    el.querySelector('#gmBack').onclick = () => this.close();
  },
  // ---------------- SAVE / LOAD: the slot windows ----------------
  savesMode: 'save',
  openSaves(mode) {
    this.savesMode = mode;
    this.panel = 'saves';
    $('panel').classList.remove('hidden');
    this.renderPanel();
  },
  savesPanel(el) {
    this.renderSlots(el, this.savesMode, () => this.close(), () => { this.panel = 'game'; this.gameView = 'main'; this.renderPanel(); });
  },
  // the slot list (also used by the main menu): save mode = 3 slots, click saves (overwrites);
  // load mode = 3 slots + the autosave, empty ones can't be clicked
  renderSlots(el, mode, onLoaded, onBack) {
    el.innerHTML = '<p class="dim">' + esc(T('save.loading')) + '</p>';
    if (!LK.saveStore.allowed()) { el.innerHTML = '<p class="bad">' + esc(T('save.noConsent')) + '</p>'; return; }
    const fmtDate = ts => new Date(ts).toLocaleString(LK.lang === 'pl' ? 'pl-PL' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    LK.listSaves().then(list => {
      const rows = list.filter(s => mode === 'load' || s.key !== LK.SAVE_AUTO);
      el.innerHTML = '<div class="slots">' + rows.map(s => {
        const m = s.meta, can = mode === 'save' || !!m;
        const info = m ? esc(T(m.old ? 'save.metaOld' : 'save.meta', { day: m.day, clock: m.clock || '', money: m.money, rep: m.rep, staff: m.staff || 0, guests: m.guests || 0 })) +
          '<small>' + esc(T('save.when', { date: fmtDate(m.savedAt) })) + (mode === 'save' ? ' · ' + esc(T('save.overwrite')) : '') + '</small>'
          : '<span class="dim">' + esc(T('save.empty')) + '</span>' + (mode === 'save' ? '<small>' + esc(T('save.saveHere')) + '</small>' : '');
        return '<button class="slot' + (m ? '' : ' empty') + (s.key === LK.SAVE_AUTO ? ' auto' : '') + '" data-slot="' + s.key + '"' + (can ? '' : ' disabled') + '>' +
          '<b>' + (s.key === LK.SAVE_AUTO ? '⏰ ' : '💾 ') + esc(LK.slotName(s.key)) + '</b><span class="sinfo">' + info + '</span></button>';
      }).join('') + '</div>' + (onBack ? '<div class="gmenu"><button id="slotBack">↩ ' + esc(T('menu.back')) + '</button></div>' : '');
      el.querySelectorAll('[data-slot]').forEach(b => b.onclick = async () => {
        const key = b.dataset.slot;
        el.querySelectorAll('[data-slot]').forEach(x => x.disabled = true);
        if (mode === 'save') { await LK.saveTo(key); this.renderSlots(el, mode, onLoaded, onBack); }
        else if (await LK.loadFrom(key)) onLoaded && onLoaded();
        else this.renderSlots(el, mode, onLoaded, onBack);
      });
      const back = el.querySelector('#slotBack'); if (back) back.onclick = onBack;
    }).catch(e => { el.innerHTML = '<p class="bad">' + esc(T('log.saveFailed', { err: e.message })) + '</p>'; });
  },

  // language + text size; changes apply at once (live preview) and are remembered
  optionsPanel(el) {
    const F = LK.FONT_SCALE, pct = v => Math.round(v * 100) + ' %';
    el.innerHTML = '<div class="opts">' +
      '<label for="optLang">' + esc(T('menu.language')) + '</label><select id="optLang">' +
      LK.languages().map(l => '<option value="' + l.code + '"' + (l.code === LK.lang ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>' +
      '<label for="optFs">' + esc(T('opt.fontSize')) + '</label><div class="fsRow"><button id="optFsMinus" title="' + esc(T('opt.smaller')) + '">A−</button>' +
      '<input type="range" id="optFs" min="' + F.min + '" max="' + F.max + '" step="' + F.step + '" value="' + LK.settings.fontScale + '">' +
      '<button id="optFsPlus" title="' + esc(T('opt.bigger')) + '">A+</button><span class="fsVal" id="optFsVal">' + pct(LK.settings.fontScale) + '</span>' +
      '<button id="optFsReset">' + esc(T('opt.default')) + '</button></div>' +
      '<label for="optTouch">' + esc(T('opt.touch')) + '</label><select id="optTouch">' +
      ['auto', 'on', 'off'].map(v => '<option value="' + v + '"' + (LK.settings.touch === v ? ' selected' : '') + '>' + esc(T('opt.touch.' + v)) + '</option>').join('') + '</select></div>' +
      '<div class="preview"><small>' + esc(T('opt.preview')) + '</small><div>' + esc(T('opt.sample')) + '</div><span class="bubbleDemo">' + esc(T('say.callService')) + '</span></div>' +
      '<div class="gmenu"><button id="optBack">↩ ' + esc(T('menu.back')) + '</button></div>';
    const range = el.querySelector('#optFs'), val = el.querySelector('#optFsVal');
    const set = v => { const s = LK.setFontScale(v, true); range.value = s; val.textContent = pct(s); this.pstHTML = null; this.trayHTML = null; };
    range.oninput = () => set(range.value);                      // live while dragging
    el.querySelector('#optFsMinus').onclick = () => set(LK.settings.fontScale - F.step);
    el.querySelector('#optFsPlus').onclick = () => set(LK.settings.fontScale + F.step);
    el.querySelector('#optFsReset').onclick = () => set(F.def);
    el.querySelector('#optLang').onchange = e => LK.setLang(e.target.value, true);   // re-renders this panel (refreshTexts)
    el.querySelector('#optTouch').onchange = e => { LK.settings.touch = e.target.value; LK.saveSettings(); if (LK.touch) LK.touch.apply(); };
    el.querySelector('#optBack').onclick = () => { this.gameView = 'main'; this.renderPanel(); };
  },

  // ---------------- HELP / ABOUT ----------------
  helpPanel(el) { el.innerHTML = this.helpHTML(); },
  // shared by the in-game help panel (F1) and the main menu
  helpHTML() { return T('help.html', { every: LK.RENT.everyDays, perTile: LK.RENT.perTile, perTent: LK.RENT.perTent }); },
  aboutHTML() { return T('about.html') + '<p class="ver">' + esc(T('about.version', { v: LK.VERSION })) + '</p>'; },

  // ---------------- MAP EXPORT / IMPORT ----------------
  mapPanel(el) {
    el.innerHTML = '<p class="hint">' + T('mapP.hint') + '</p>' +
      '<textarea id="mapText" spellcheck="false"></textarea><div class="row"><button id="mapImport">' + esc(T('mapP.import')) + '</button> <button id="mapCopy">' + esc(T('mapP.copy')) + '</button></div>';
    const ta = el.querySelector('#mapText');
    ta.value = LK.ser.mapFile(LK.state.world.toDef(), LK.mapId || 'mymap');
    el.querySelector('#mapCopy').onclick = () => { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); } };
    el.querySelector('#mapImport').onclick = () => {
      try {
        const def = LK.parseMapText(ta.value);
        if (!def.ground || !def.rooms) throw new Error('missing ground/rooms');
        LK.newGame(def); this.close(); LK.log(T('log.mapImported'), 'good');
      } catch (e) { alert(T('mapP.failed', { err: e.message })); }
    };
  },

  // ---------------- item menu (E on an outside item with more than one action) ----------------
  itemMenu: null,
  openItemMenu(p, o, acts) {
    if (this.panel) this.close();                            // one window at a time
    if (this.buildMode) this.toggleBuild();
    const el = $('itemMenu'), m = LK.touchMode ? LK.toScreen(p.x, p.y) : LK.input.mouse || [LK.view.w / 2, LK.view.h / 2];
    this.itemMenu = { p, o };
    el.innerHTML = '<b>' + esc(LK.furnName(o.type)) + '</b>' +
      acts.map((a, i) => '<button data-act="' + a + '"><kbd>' + (i + 1) + '</kbd> ' + esc(LK.actionLabel ? LK.actionLabel(o, a) : T('item.' + a)) + '</button>').join('');
    el.style.left = Math.min(m[0] + 12, LK.view.w - 220) + 'px';
    el.style.top = Math.min(m[1] + 12, LK.view.h - 40 - 34 * acts.length) + 'px';
    el.classList.remove('hidden');
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this.pickItemAction(b.dataset.act));
    this.itemMenuActs = acts;
  },
  pickItemAction(act) {
    const m = this.itemMenu;
    if (!m) return;
    this.closeItemMenu();
    LK.doItemAction(m.p, m.o, act);
  },
  closeItemMenu() {
    this.itemMenu = null; this.itemMenuActs = null;
    const el = $('itemMenu');
    el.classList.add('hidden'); el.innerHTML = '';
  },

  // ---------------- BUILD MODE ----------------
  toggleBuild() {
    this.buildMode = !this.buildMode;
    if (this.buildMode && this.panel) this.close();          // one window at a time: build mode closes the open window
    if (this.buildMode && this.pickPost) this.endPickPost();
    if (this.buildMode && this.itemMenu) this.closeItemMenu();
    $('buildBar').classList.toggle('hidden', !this.buildMode);
    $('btnBuild').classList.toggle('on', this.buildMode);
    if (this.buildMode) this.renderBuildBar();
    else this.resetBuild();
  },
  // leaving build mode: everything goes back to the default actions (click = select, E = interact)
  resetBuild() {
    Object.assign(this.build, { tool: 'furn', furn: null, room: 'B' });
    if (LK.input) LK.input.drag = false;
    if (this.panel === 'map') this.close();                 // the "Map file…" panel opened from the build bar
    const a = document.activeElement;
    if (a && a.blur && a !== document.body) a.blur();       // keys go to the game, not to a build button
  },
  renderBuildBar() {
    const S = LK.state, b = this.build, el = $('buildBar');
    const furn = Object.entries(LK.buildableFurn());           // storage + what the owner carries
    let h = '<div class="tools">' +
      ['furn', 'pick', 'room', 'erase', 'door'].map(k =>
        '<button data-tool="' + k + '"' + (b.tool === k ? ' class="on"' : '') + '>' + esc(T('build.' + k)) + '</button>').join('') +
      ' <button id="rot">' + esc(T('build.rotate')) + '</button> <button id="claimE">' + esc(T('build.claimE', { cost: LK.CLAIM_COST })) + '</button> <button id="claimS">' + esc(T('build.claimS', { cost: LK.CLAIM_COST })) + '</button> <button id="mapFile">' + esc(T('build.mapFile')) + '</button></div>';
    if (b.tool === 'furn') h += '<div class="opts">' + (furn.length ? furn.map(([k, [n, hand]]) => '<button data-furn="' + k + '"' + (b.furn === k ? ' class="on"' : '') +
      (hand ? ' title="' + esc(T('build.inHandsTip', { n: hand })) + '"' : '') + '>' + esc(LK.furnName(k)) + ' ×' + n + (hand ? ' <span class="hand">✋' + hand + '</span>' : '') +
      (LK.craftedCount && LK.craftedCount(k) ? ' <span class="hand" title="' + esc(T('build.craftedTip', { n: LK.craftedCount(k), s: LK.CRAFT.placeTime })) + '">🔨' + LK.craftedCount(k) + '</span>' : '') + '</button>').join('') : '<i>' + esc(T('build.noFurn')) + '</i>') + '</div>';
    if (b.tool === 'room') h += '<div class="opts">' + ['B', 'K', 'S'].map(k => '<button data-room="' + k + '"' + (b.room === k ? ' class="on"' : '') + '>' + esc(LK.tn('room', k, LK.ROOMS[k].name)) + '</button>').join('') + ' <small>' + esc(T('build.roomHint', { n: LK.materialsAvail() })) + '</small></div>';
    if (b.tool === 'door') h += '<div class="opts"><small>' + esc(T('build.doorHint')) + '</small></div>';
    if (b.tool === 'pick') h += '<div class="opts"><small>' + esc(T('build.pickHint')) + '</small></div>';
    el.innerHTML = h;
    el.querySelectorAll('[data-tool]').forEach(x => x.onclick = () => { b.tool = x.dataset.tool; this.renderBuildBar(); });
    el.querySelectorAll('[data-furn]').forEach(x => x.onclick = () => { b.furn = x.dataset.furn; this.renderBuildBar(); });
    el.querySelectorAll('[data-room]').forEach(x => x.onclick = () => { b.room = x.dataset.room; this.renderBuildBar(); });
    el.querySelector('#rot').onclick = () => { b.rot = (b.rot + 1) % 4; };
    el.querySelector('#claimE').onclick = () => LK.claimLand('E');
    el.querySelector('#claimS').onclick = () => LK.claimLand('S');
    el.querySelector('#mapFile').onclick = () => this.toggle('map');
  },
  buildGhost(ctx) {
    const b = this.build, h = LK.input.hover;
    if (!h || b.tool !== 'furn' || !b.furn) return;
    const [sx, sy] = LK.toScreen(h[0] + 0.5, h[1] + 0.5);
    const d = LK.FURNITURE[b.furn], bad = !!LK.placeError(b.furn, h[0], h[1]), z = LK.cam.z;
    if (bad) {                                               // not allowed here: red tile, faint ghost
      ctx.fillStyle = 'rgba(220,40,30,0.35)';
      ctx.beginPath(); ctx.moveTo(sx, sy - 32 * z); ctx.lineTo(sx + 64 * z, sy); ctx.lineTo(sx, sy + 32 * z); ctx.lineTo(sx - 64 * z, sy); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = bad ? 0.3 : 0.6;
    LK.drawFurn(ctx, d, b.rot, sx, sy, z);
    ctx.globalAlpha = 1;
  },
  // click in build mode on tile (x,y), fractional (fx,fy)
  buildClick(x, y, fx, fy, drag) {
    const S = LK.state, w = S.world, b = this.build;
    if (!w.inb(x, y)) return;
    if (b.tool === 'furn' && !drag) {
      if (!b.furn || !(LK.furnAvail(b.furn) > 0)) return LK.log(T('log.selectFurn'), 'warn');
      if (w.objAt(x, y)) return LK.log(T('log.occupied'), 'warn');
      const err = LK.placeError(b.furn, x, y);
      if (err) return LK.log(T(err, { name: LK.furnName(b.furn) }), 'warn');
      if (S.chars.some(c => c.tx === x && c.ty === y && c.kind !== 'gone') && LK.FURNITURE[b.furn].block) return LK.log(T('log.standing'), 'warn');
      // crafted pieces first (set up in a few seconds), then what he carries, then the storage
      const crafted = LK.craftedCount && LK.craftedCount(b.furn) > 0;
      if (crafted) { S.furn[b.furn]--; S.furnCrafted[b.furn]--; } else LK.useForBuild('furn', b.furn, 1);
      const placed = w.addObject(b.furn, x, y, b.rot, false);
      if (crafted && placed) placed.crafted = true;
      LK.log(T('log.blueprint', { name: LK.furnName(b.furn) }));
      if (!LK.furnAvail(b.furn)) b.furn = null;
      this.renderBuildBar();
    } else if (b.tool === 'pick' && !drag) {
      const o = w.objAt(x, y);
      if (!o) return;
      const err = LK.takeError(o);
      if (err) return LK.log(T(err), 'warn');
      LK.takeItem(o);
    } else if (b.tool === 'room' || b.tool === 'erase') {
      const code = b.tool === 'room' ? b.room : '.';
      const cur = w.room(x, y);
      if (cur === code || cur === 'X') return;
      if (code === '.' && cur === 'S' && w.roomTiles('S').length <= 1) return LK.log(T('log.needStorage'), 'bad');
      if (code !== '.') {
        if (cur === '.' && !LK.useForBuild('goods', 'materials', 1)) return LK.log(T('log.noMaterials'), 'bad');
      }
      w.setRoom(x, y, code);
      if (code === '.') {                                     // erased: doors / windows / extra walls left between two outside tiles go too
        for (const [side, nx, ny] of [['N', x, y - 1], ['S', x, y + 1], ['W', x - 1, y], ['E', x + 1, y]])
          if (w.room(nx, ny) === '.') delete w.edgeOverride[w.edgeKey(x, y, side)];
      }
      w.rebuildWalls(); w.markDirty();
      this.renderBuildBar();
    } else if (b.tool === 'door' && !drag) {
      // nearest edge of the clicked tile
      const ox = fx - x, oy = fy - y;
      const dists = [['N', oy], ['S', 1 - oy], ['W', ox], ['E', 1 - ox]].sort((a, c) => a[1] - c[1]);
      const side = dists[0][0];
      const key = w.edgeKey(x, y, side);
      const e = w.edges[key];
      const order = ['wall', 'door', 'window'];
      if (!e) {
        if (!LK.useForBuild('goods', 'materials', 2)) return LK.log(T('log.wallMaterials'), 'bad');
        w.edgeOverride[key] = 'wall';
      } else {
        const next = order[(order.indexOf(e.kind) + 1) % order.length] || 'wall';   // editor pieces (arches...) become a plain wall
        const [, , s2] = key.split(','), ax = +key.split(',')[0], ay = +key.split(',')[1];
        const outside = w.room(ax, ay) === '.' && w.room(s2 === 'W' ? ax - 1 : ax, s2 === 'N' ? ay - 1 : ay) === '.';
        if (outside && e.kind === 'window') delete w.edgeOverride[key];   // a free-standing piece outside: wall → door → window → gone
        else w.edgeOverride[key] = next;
      }
      w.rebuildWalls(); w.markDirty();
      this.renderBuildBar();
    }
  },

  // ---------------- dialogs ----------------
  rentReport(r) {
    const el = $('toast');
    el.innerHTML = '<b>🔥 ' + esc(T('order.name')) + '</b><br>' + esc(T('rent.line', { rent: r.rent, tiles: LK.barSize(), perTile: LK.RENT.perTile, tents: LK.rentTentCount(), perTent: LK.RENT.perTent })) + '<br>' +
      (r.warning ? '<span class="bad">' + esc(T('rent.notEnough', { paid: r.paid })) + (r.seized.length ? ', ' + esc(r.seized.join(', ')) : '') + '<br>' +
        esc(T('rent.warning', { w: r.warnings, max: LK.RENT.maxWarnings })) + '</span>'
        : esc(T('rent.paid')) + (r.cleared ? ' <span class="good">' + esc(T('rent.cleared')) + '</span>' : ''));
    el.classList.remove('hidden');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.add('hidden'), 10000);
  },
  dayReport(t, costs) {
    const el = $('toast');
    el.innerHTML = '<b>' + esc(T('day.title', { day: LK.state.day })) + '</b><br>' +
      esc(T('day.money', { income: Math.round(t.income), spent: Math.round(t.expense), wages: costs })) + '<br>' +
      esc(T('day.served', { served: t.served }) + (t.bonus ? T('day.bonus', { bonus: LK.fmt(t.bonus) }) : '') + (t.tips ? T('day.tips', { tips: LK.fmt(t.tips) }) : '') +
        T('day.rest', { guests: t.clients, fights: t.fights, rep: Math.round(LK.state.rep) }));
    el.classList.remove('hidden');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.add('hidden'), 9000);
  }
};

// why furniture `type` can't be placed on tile (x,y): a log key, or null when it can.
// Everything goes inside the bar (B / K / S rooms); `outdoor` furniture (rental tent, rat altar) only outside it.
LK.placeError = function (type, x, y) {
  const w = LK.state.world, d = LK.FURNITURE[type];
  const tiles = [[x, y]].concat((d.parts || []).filter(p => p.tx || p.ty).map(p => [x + (p.tx || 0), y + (p.ty || 0)]));
  if (d.outdoor) return tiles.some(([a, b]) => w.isBar(a, b)) ? 'log.outdoorOnly' : null;
  return tiles.every(([a, b]) => w.isBar(a, b)) ? null : 'log.barOnly';
};

LK.claimLand = function (dir) {
  const S = LK.state;
  const cost = LK.CLAIM_COST;
  if (S.money < cost) return LK.log(T('log.claimCost', { cost }), 'bad');
  S.money -= cost; S.today.expense += cost;
  S.world.extend(dir, 6);
  LK.log(T(dir === 'E' ? 'log.claimedE' : 'log.claimedS'), 'good');
};
LK.gameOver = function (msg) {
  LK.state.over = true;
  $('over').classList.remove('hidden');
  $('overMsg').textContent = msg + T('over.lasted', { days: LK.state.day });
};
