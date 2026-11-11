/* Extreme Value Theory Tail Risk Explorer — UI, charts, and the live Guide.
   All statistics live in evt.js. Vanilla JS + SVG, no dependencies. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const TYPES = ['Trade error', 'NAV/pricing error', 'Reconciliation break', 'Vendor/settlement failure', 'Unauthorized trading', 'Other'];
  const STEP_P = [50, 40, 30, 25, 20, 15, 12.5, 10, 7.5, 5];   // % of losses left in the tail
  const NS = STEP_P.length, DEFAULT_STEP = 3;
  const DEFAULTS = { years: 10, floor: 25, T: 200, conf: 99.9 };

  let uid = 1;
  const freshLosses = () => DEFAULT_LOSSES.map(r => ({ id: uid++, d: r[0], t: r[1], a: r[2] }));
  let state = Object.assign({ losses: freshLosses() }, DEFAULTS);
  let curK = null, model = null, valid = true, playing = null;
  let sortMode = 'date', showWhole = true, metric = 'xi';

  // ---------- formatting ----------
  function fm(v){
    if (v == null || isNaN(v)) return '—';
    if (!isFinite(v)) return '∞';
    const a = Math.abs(v), s = v < 0 ? '−$' : '$';
    if (a >= 1e12) return s + '1T+';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a < 1e10 ? 2 : 1) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a < 1e8 ? 1 : 0) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  const fmHi = v => !isFinite(v) ? 'no upper limit' : v >= 1e12 ? 'over $1T' : fm(v);
  const fmAxis = v => v >= 1e9 ? '$' + (v / 1e9) + 'B' : v >= 1e6 ? '$' + (v / 1e6) + 'M' : v >= 1e3 ? '$' + (v / 1e3) + 'K' : '$' + v;
  const fn = (v, d = 2) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const fint = v => Math.round(v).toLocaleString('en-US');
  const fk = v => isFinite(v) ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(3))) : '';
  const fr = v => String(+(+v).toFixed(4));
  function fyrs(v){ // a return period in years, in words
    if (!isFinite(v) || v > 1e9) return 'more than a billion years';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + ' million years';
    if (v >= 100) return fint(Math.round(v / (v >= 1000 ? 10 : 1)) * (v >= 1000 ? 10 : 1)) + ' years';
    if (v >= 10) return Math.round(v) + ' years';
    return v.toFixed(1) + ' years';
  }
  const pctTail = k => model ? (k / model.n * 100) : 0;
  const fpct = p => (Math.abs(p - Math.round(p)) < 0.05 ? Math.round(p) : p.toFixed(1)) + '%';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tName = T => `1-in-${fint(T)}`;
  const confTxt = () => fr(state.conf) + '%';

  function parseMoney(str){ // → $K
    let s = String(str).trim().replace(/[$,\s]/g, '').toLowerCase();
    if (!s) return NaN;
    let mult = 1;
    if (/[kmb]$/.test(s)){ const c = s.slice(-1); s = s.slice(0, -1); mult = c === 'k' ? 1 : c === 'm' ? 1000 : 1e6; }
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    return parseFloat(s) * mult;
  }
  function parseNum(str){
    const s = String(str).trim().replace(/[,%\s]/g, '');
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // ---------- thresholds ----------
  function kBounds(n){
    const kMax = Math.max(8, Math.floor(n * 0.5));
    const kMin = Math.min(kMax, Math.max(8, Math.round(n * 0.05)));
    return { kMin, kMax };
  }
  function stepKs(n){
    const { kMin, kMax } = kBounds(n);
    return STEP_P.map(p => Math.max(kMin, Math.min(kMax, Math.round(p / 100 * n))));
  }
  const fitFlag = a => { const hw = 1.96 * a.seXi; return hw <= 0.3 ? ['g', 'Stable'] : hw <= 0.5 ? ['y', 'Sensitive'] : ['r', 'Unstable']; };
  function tailBadge(xi){
    if (xi >= 1) return ['r', 'Infinite mean'];
    if (xi >= 0.5) return ['r', 'Very heavy tail'];
    if (xi > 0.05) return ['y', 'Heavy tail'];
    if (xi > -0.05) return ['g', 'Exponential tail'];
    return ['g', 'Bounded tail'];
  }

  // ---------- validation ----------
  function renderMsgs(el, list){ el.innerHTML = list.map(([t, m]) => `<div class="msg ${t}">${m}</div>`).join(''); }
  function validateAll(){
    const dm = [], mm = []; let ok = true;
    const mark = (id, bad) => $(id).classList.toggle('bad', !!bad);
    const Y = state.years, F = state.floor, T = state.T, C = state.conf;
    const yBad = !isFinite(Y) || Y < 1 || Y > 100; mark('inYears', yBad);
    if (yBad){ dm.push(['err', 'Years of data must be a number from 1 to 100.']); ok = false; }
    else if (Y < 5) dm.push(['warn', `Only ${fr(Y)} years of data. A 1-in-${fint(T)} estimate from so short a history leans heavily on the model.`]);
    const fBad = !isFinite(F) || F < 0; mark('inFloor', fBad);
    if (fBad){ dm.push(['err', 'The reporting floor must be a number, 0 or more.']); ok = false; }
    let badRows = 0;
    document.querySelectorAll('#lossBody tr').forEach(tr => {
      const L = state.losses.find(l => l.id === +tr.dataset.id); if (!L) return;
      const b = !isFinite(L.a) || L.a <= 0; tr.querySelector('.amt').classList.toggle('bad', b);
      if (b) badRows++;
    });
    if (state.losses.some(l => !isFinite(l.a) || l.a <= 0)){ dm.push(['err', `${badRows || 'Some'} loss amount${badRows === 1 ? '' : 's'} in the log ${badRows === 1 ? 'is' : 'are'} missing or not above 0.`]); ok = false; }
    if (!fBad){
      const nIn = state.losses.filter(l => isFinite(l.a) && l.a > 0 && l.a >= F).length;
      if (nIn < 30){ dm.push(['err', `Only ${nIn} losses sit at or above the ${fm(F * 1000)} floor. The tail fit needs at least 30.`]); ok = false; }
      if (state.losses.length > 2000){ dm.push(['err', 'The log is limited to 2,000 losses.']); ok = false; }
    }
    const tBad = !isFinite(T) || T < 2 || T > 10000; mark('inT', tBad);
    if (tBad){ mm.push(['err', 'The return period must be from 2 to 10,000 years.']); ok = false; }
    const cBad = !isFinite(C) || C < 90 || C > 99.99; mark('inConf', cBad);
    if (cBad){ mm.push(['err', 'The confidence level must be from 90% to 99.99%.']); ok = false; }
    renderMsgs($('dataMsgs'), dm); renderMsgs($('measMsgs'), mm);
    valid = ok; return ok;
  }

  // ---------- compute ----------
  const cache = new Map(); let cacheSig = '', gridCache = null;
  function compute(){
    const t0 = performance.now();
    const keep = state.losses.filter(l => l.a >= state.floor);
    const x = keep.map(l => l.a * 1000).sort((a, b) => a - b);
    const n = x.length, Y = state.years, T = state.T, alpha = state.conf / 100;
    const { kMin, kMax } = kBounds(n), ks = stepKs(n);
    if (curK == null) curK = ks[DEFAULT_STEP];
    curK = Math.max(kMin, Math.min(kMax, curK));
    let sum0 = 0; for (const v of x) sum0 += v;
    const sig = [n, sum0, x[0], x[n - 1], Y, T, alpha].join('|');
    if (sig !== cacheSig){ cache.clear(); cacheSig = sig; }
    const full = k => { if (!cache.has(k)) cache.set(k, EVT.analyze(x, k, Y, T, alpha, { profile: true })); return cache.get(k); };
    const steps = ks.map(full);
    const cur = full(curK);
    if (!cur || steps.some(v => !v)) return { fail: true, n };
    if (!gridCache || gridCache.sig !== sig){
      const g = []; for (let k = kMax; k >= kMin; k--) g.push(cache.get(k) || EVT.analyze(x, k, Y, T, alpha));
      gridCache = { sig, g };
    }
    const grid = gridCache.g;
    const whole = EVT.wholeFits(x, Y, T, alpha);
    const worst = keep.reduce((b, l) => l.a > b.a ? l : b, keep[0]);
    let sum = 0; x.forEach(v => sum += v);
    const med = n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2;
    return { x, n, Y, T, alpha, kMin, kMax, ks, steps, cur, grid, whole, worst, sum, med, ms: performance.now() - t0 };
  }
  function stepIndex(){ // exact step, or -1 if a fine-tuned k sits between steps
    return model.ks.indexOf(curK);
  }
  function nearestStep(){
    let b = 0, bd = Infinity; model.ks.forEach((k, i) => { const d = Math.abs(k - curK); if (d < bd){ bd = d; b = i; } }); return b;
  }

  // ---------- data card ----------
  function renderDataSum(){
    const m = model, nAll = state.losses.length, below = nAll - m.n;
    $('dataSum').innerHTML = `<b>${m.n}</b> losses ≥ ${fm(state.floor * 1000)} over <b>${fr(m.Y)}</b> years · ${fn(m.n / m.Y, 1)} a year · average ${fm(m.sum / m.n)} · median ${fm(m.med)}<br>` +
      `largest <b style="color:var(--gold)">${fm(m.worst.a * 1000)}</b> (${esc(m.worst.t)}${m.worst.d ? ', ' + esc(m.worst.d) : ''}) · total ${fm(m.sum / m.Y)} a year` +
      (below ? `<br><span class="muted">${below} logged loss${below === 1 ? '' : 'es'} below the floor ${below === 1 ? 'is' : 'are'} left out.</span>` : '');
    $('logCount').textContent = `${nAll} rows`;
  }
  function buildLossLog(){
    const rows = state.losses.slice();
    if (sortMode === 'size') rows.sort((a, b) => (b.a || 0) - (a.a || 0));
    else rows.sort((a, b) => String(a.d).localeCompare(String(b.d)));
    const big = model && model.x ? model.x[model.n - Math.min(model.n, 6)] / 1000 : Infinity;
    $('lossBody').innerHTML = rows.map(l => `<tr data-id="${l.id}" class="${l.a >= big ? 'big' : ''} ${l.a < state.floor ? 'below' : ''}">
      <td><input class="num dt" value="${esc(l.d)}" aria-label="Date" placeholder="YYYY-MM-DD"></td>
      <td><select class="num ty" aria-label="Event type">${TYPES.map(t => `<option${t === l.t ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input class="num amt" value="${fk(l.a)}" aria-label="Loss in $K" inputmode="decimal"></td>
      <td><button class="x-btn" aria-label="Delete this loss" title="Delete">×</button></td></tr>`).join('');
  }
  $('lossBody').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const L = state.losses.find(l => l.id === +tr.dataset.id); if (!L) return;
    if (e.target.classList.contains('amt')) L.a = parseMoney(e.target.value);
    else if (e.target.classList.contains('dt')) L.d = e.target.value.trim();
    else if (e.target.classList.contains('ty')) L.t = e.target.value;
    schedule();
  });
  $('lossBody').addEventListener('change', e => { if (e.target.classList.contains('ty')){ const tr = e.target.closest('tr'); const L = state.losses.find(l => l.id === +tr.dataset.id); if (L){ L.t = e.target.value; schedule(); } } });
  $('lossBody').addEventListener('click', e => {
    if (!e.target.classList.contains('x-btn')) return;
    const tr = e.target.closest('tr'); state.losses = state.losses.filter(l => l.id !== +tr.dataset.id);
    tr.remove(); recompute();
  });
  $('addLoss').addEventListener('click', () => {
    const L = { id: uid++, d: new Date().toISOString().slice(0, 10), t: 'Trade error', a: NaN };
    state.losses.push(L);
    const tb = $('lossBody'), tmp = document.createElement('tbody');
    tmp.innerHTML = `<tr data-id="${L.id}"><td><input class="num dt" value="${L.d}" aria-label="Date"></td><td><select class="num ty" aria-label="Event type">${TYPES.map(t => `<option${t === L.t ? ' selected' : ''}>${t}</option>`).join('')}</select></td><td><input class="num amt" value="" aria-label="Loss in $K" inputmode="decimal" placeholder="$K"></td><td><button class="x-btn" aria-label="Delete this loss">×</button></td></tr>`;
    const tr = tmp.firstElementChild; tb.insertBefore(tr, tb.firstChild);
    tr.querySelector('.amt').focus(); validateAll(); $('logCount').textContent = `${state.losses.length} rows`;
  });
  document.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
    sortMode = b.dataset.sort; document.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b)); buildLossLog(); validateAll();
  }));

  // paste parser
  function parsePaste(text, unit){
    const out = [], skipped = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      let line = raw.trim(); if (!line) return;
      let d = '';
      const dm = line.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (dm){ d = dm[1]; line = line.slice(dm[0].length); }
      const am = line.match(/(\$?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*([kKmMbB])?\s*$/);
      if (!am){ skipped.push(i + 1); return; }
      const numStr = am[1].replace(/[$,\s]/g, ''), suf = (am[2] || '').toLowerCase();
      let v = parseFloat(numStr);
      if (!isFinite(v)){ skipped.push(i + 1); return; }
      v = suf === 'k' ? v : suf === 'm' ? v * 1000 : suf === 'b' ? v * 1e6 : unit === 'usd' ? v / 1000 : v;
      let t = line.slice(0, am.index).replace(/^[\s,;\t|]+|[\s,;\t|]+$/g, '');
      const tt = TYPES.find(x => x.toLowerCase() === t.toLowerCase()) || (t ? 'Other' : 'Other');
      out.push({ id: uid++, d, t: tt, a: v });
    });
    return { out, skipped };
  }
  $('pasteBtn').addEventListener('click', () => {
    const { out, skipped } = parsePaste($('pasteArea').value, $('pasteUnit').value);
    const msgs = [];
    if (out.length < 30){ msgs.push(['err', `Found ${out.length} loss${out.length === 1 ? '' : 'es'}. Paste at least 30 to fit a tail.`]); renderMsgs($('dataMsgs'), msgs); return; }
    if (out.length > 2000){ renderMsgs($('dataMsgs'), [['err', `Found ${fint(out.length)} losses. The limit is 2,000.`]]); return; }
    stopPlay(); const oldL = state.losses, oldY = state.years, oldK = curK; state.losses = out; curK = null;
    // infer the span of years when dates are present
    const yrs = out.map(l => parseInt(String(l.d).slice(0, 4), 10)).filter(v => v > 1900 && v < 2200);
    if (yrs.length === out.length){ state.years = Math.max(...yrs) - Math.min(...yrs) + 1; $('inYears').value = fr(state.years); }
    if (!recompute(true)){
      const msg = $('dataMsgs').innerHTML;
      state.losses = oldL; state.years = oldY; curK = oldK; $('inYears').value = fr(oldY); recompute(true);
      $('dataMsgs').innerHTML = msg.replace('Add more distinct losses.', 'Add more distinct losses. Your previous log is still loaded.');
      return;
    }
    const extra = [['warn', `Loaded ${out.length} losses${skipped.length ? `; skipped line${skipped.length === 1 ? '' : 's'} ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''} with no amount` : ''}. ${yrs.length === out.length ? `Years of data set to ${state.years} from the dates.` : 'Check that Years of data matches your history.'}`]];
    $('dataMsgs').insertAdjacentHTML('beforeend', extra.map(([t, m]) => `<div class="msg ${t}">${m}</div>`).join(''));
  });

  // ---------- KPIs ----------
  function renderKpis(){
    const m = model, a = m.cur, w = m.whole;
    const si = stepIndex();
    $('stepLabel').textContent = `Top ${fpct(pctTail(curK))} · ${curK} points` + (si < 0 ? ' · fine-tuned' : '');
    $('stepRange').value = si < 0 ? nearestStep() : si;
    $('fineRange').min = 0; $('fineRange').max = m.kMax - m.kMin; $('fineRange').value = m.kMax - curK;
    $('fineVal').textContent = `u = ${fm(a.u)}`;
    // 1 xi
    const [bc, bt] = tailBadge(a.xi);
    $('k1').textContent = fn(a.xi, 2);
    $('k1s').textContent = `95% range ${fn(a.xiLo, 2)} to ${fn(a.xiHi, 2)}`;
    $('k1c').innerHTML = `<span class="badge ${bc}">${bt}</span>`;
    // 2 VaR
    $('k2l').textContent = `2 · ${confTxt()} annual VaR`;
    $('k2').textContent = fm(a.VaR);
    $('k2s').textContent = a.q.profile ? `95% range ${fm(a.VaRlo)} – ${fmHi(a.VaRhi)}` : 'below the threshold: see Guide 7';
    // 3 ES
    $('k3l').textContent = `3 · ${confTxt()} Expected Shortfall`;
    const inf = !isFinite(a.ES);
    $('k3').textContent = inf ? 'Infinite' : fm(a.ES); $('k3').classList.toggle('inf', inf);
    $('k3s').innerHTML = inf ? `<span class="badge r">mean undefined, ξ ≥ 1</span>` : `average of years worse than VaR · ${fn(a.ES / a.VaR, 1)}× VaR`;
    // 4 tail points
    $('k4').textContent = a.k;
    $('k4s').textContent = `top ${fpct(pctTail(a.k))} · losses above ${fm(a.u)}`;
    $('k4c').innerHTML = a.k < 15 ? `<span class="badge r">Very few points</span>` : a.k < 30 ? `<span class="badge y">Few points: wide ranges</span>` : `<span class="badge n">${fn(a.k / m.Y, 1)} tail losses a year</span>`;
    // 5 return level
    $('k5l').textContent = `The ${tName(m.T)}-year loss`;
    $('k5').textContent = fm(a.rl.x);
    $('k5s').textContent = a.rl.profile ? `GPD tail fit · 95% range ${fm(a.rl.lo)} – ${fmHi(a.rl.hi)}` : 'this return period sits below the threshold';
    const rows = [['GPD tail fit', a.rl.x, 'a'], ['Lognormal, all data', w.logn.rl, 'l'], ['Normal, all data', w.normal.rl, 'n']];
    const top = Math.max(...rows.map(r => r[1]));
    $('k5rows').innerHTML = rows.map(([l, v, c]) => `<div class="mrow"><span class="lbl">${l}</span><span class="mbar"><i class="${c}" style="width:${Math.max(1, v / top * 100)}%"></i></span><span class="val">${fm(v)}</span></div>`).join('');
    const ratio = a.rl.x / w.logn.rl;
    $('k5w').innerHTML = `Your worst loss, <b>${fm(m.worst.a * 1000)}</b>, comes about once every <b>${fyrs(a.rpWorst)}</b> under the GPD, ${fyrs(w.logn.rpWorst)} under the lognormal, and ${fyrs(w.normal.rpWorst)} under the normal.` +
      (ratio > 1.15 ? ` <span class="pill">Lognormal understates by ${fn(ratio, 1)}×</span>` : '');
  }

  function renderStability(){
    const m = model, a = m.cur, [fc, ft] = fitFlag(a);
    const fl = $('stabFlag'); fl.className = `flag mono ${fc === 'g' ? 'ok' : fc === 'y' ? 'maybe' : 'hot'}`; fl.textContent = ft;
    const xs = m.steps.map(s => s.xi), rls = m.steps.map(s => s.rl.x);
    const lo = Math.min(...rls), hi = Math.max(...rls);
    const nInf = m.steps.filter(s => s.xi >= 1).length;
    $('stabTxt').innerHTML = `At this threshold the 95% range on ξ is ±${fn(1.96 * a.seXi, 2)}. ` +
      `Across the ten thresholds, ξ runs from ${fn(Math.min(...xs), 2)} to ${fn(Math.max(...xs), 2)} and the ${tName(m.T)}-year loss from ${fm(lo)} to ${fm(hi)}, a ${fn(hi / lo, 1)}× spread from one judgment call. ` +
      (nInf ? `At ${nInf} threshold${nInf === 1 ? '' : 's'} ξ is 1 or more, so Expected Shortfall is infinite there. ` : '') +
      `Stable means a ξ range of ±0.3 or less; Sensitive, ±0.5 or less. See Guide, section 8.`;
  }

  function renderSteps(){
    const m = model, a = m.cur, w = m.whole, lam = m.n / m.Y, al = m.alpha;
    const xiS = fn(a.xi, 3), sg = fm(a.sigma);
    const items = [];
    items.push(`<li><span class="what">Sort the losses and pick a threshold. Only the losses above it are used.</span>
<pre>n = ${m.n} losses over ${fr(m.Y)} years  →  λ = ${fn(lam, 1)} losses a year
keep the top k = ${a.k} (${fpct(pctTail(a.k))})  →  threshold u = ${fm(a.u)}
excesses y = loss − u, for the ${a.k} losses above u
tail rate λᵤ = k / years = ${a.k} / ${fr(m.Y)} = <span class="res">${fn(a.lamU, 2)} a year</span></pre></li>`);
    items.push(`<li><span class="what">Fit a Generalized Pareto distribution to the excesses by maximum likelihood.</span>
<pre>maximize  −k·ln σ − (1 + 1/ξ)·Σ ln(1 + ξ·yᵢ/σ)
ξ = <span class="res">${xiS}</span>   (95% range ${fn(a.xiLo, 2)} to ${fn(a.xiHi, 2)}, se = (1+ξ)/√k = ${fn(a.seXi, 3)})
σ = <span class="res">${sg}</span></pre></li>`);
    const pr = 1 / m.T / a.lamU;
    items.push(`<li><span class="what">Find the loss exceeded once in ${fint(m.T)} years: solve λᵤ · P(Y > x − u) = 1/${fint(m.T)}.</span>
<pre>x_T = u + (σ/ξ)·[(T·λᵤ)^ξ − 1]
    = ${fm(a.u)} + (${sg}/${fn(a.xi, 3)})·[(${fint(m.T)}×${fn(a.lamU, 2)})^${fn(a.xi, 3)} − 1]
    = <span class="res">${fm(a.rl.x)}</span>   (95% profile range ${fm(a.rl.lo)} – ${fmHi(a.rl.hi)})${pr >= 1 ? '\nnote: 1/T is above the tail rate, so this sits below u and the tail model does not apply' : ''}</pre></li>`);
    items.push(`<li><span class="what">Annual VaR: the single-loss quantile, plus a correction for all the ordinary losses.</span>
<pre>q   = u + (σ/ξ)·[(λᵤ/(1−α))^ξ − 1] = ${fm(a.u)} + (${sg}/${fn(a.xi, 3)})·[(${fn(a.lamU, 2)}/${fr(1 - al)})^${fn(a.xi, 3)} − 1] = ${fm(a.q.x)}
fix = (λ − 1)·μ = (${fn(lam, 1)} − 1) × ${a.xi < 1 ? fm(a.sevMean) : '∞'} = ${a.xi < 1 ? fm(a.corr) : 'dropped, since ξ ≥ 1'}
VaR = ${fm(a.q.x)} + ${fm(a.corr)} = <span class="res">${fm(a.VaR)}</span></pre></li>`);
    items.push(`<li><span class="what">Expected Shortfall: the average of the years worse than VaR.</span>
<pre>${a.xi < 1 ? `ES = (q + σ − ξ·u)/(1 − ξ) + fix
   = (${fm(a.q.x)} + ${sg} − ${fn(a.xi, 3)}×${fm(a.u)})/(1 − ${fn(a.xi, 3)}) + ${fm(a.corr)}
   = <span class="res">${fm(a.ES)}</span>` : `ξ = ${xiS} ≥ 1, so the GPD has no mean.
ES = <span class="res">infinite</span>: the average loss beyond VaR doesn't settle down.`}</pre></li>`);
    items.push(`<li><span class="what">Compare: fit a lognormal and a normal to all ${m.n} losses and ask the same question.</span>
<pre>lognormal: mean of ln(loss) = ${fn(w.logn.mu, 3)}, sd = ${fn(w.logn.sd, 3)}  →  ${tName(m.T)} = <span class="res">${fm(w.logn.rl)}</span>
normal:    mean = ${fm(w.normal.mu)}, sd = ${fm(w.normal.sd)}  →  ${tName(m.T)} = <span class="res">${fm(w.normal.rl)}</span>
GPD ÷ lognormal = ${fn(a.rl.x / w.logn.rl, 1)}×</pre></li>`);
    $('steps').innerHTML = items.join('');
  }

  // ---------- charts ----------
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, txt) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt != null) e.textContent = txt; return e; };
  const COL = { acc: '#6fd3a0', gold: '#f2c46d', blue: '#7fb2ff', logn: '#c9a3ff', red: '#f2818a', text: '#e6ebf2', grid: '#1c2638', axis: '#2a3850', faint: '#5b6678' };

  const cw = svg => Math.max(330, Math.min(640, Math.round(svg.parentElement.clientWidth || 640)));
  function renderTail(){
    const m = model, a = m.cur, w = m.whole, svg = $('tailChart'); svg.innerHTML = '';
    const W = cw(svg), narrow = W < 520, H = narrow ? 300 : 360, L = 52, R = 16, T = 14, B = 42;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const xmin = Math.pow(10, Math.floor(Math.log10(m.x[0]) + 1e-9));
    const want = Math.max(m.x[m.n - 1] * 3, Math.min(a.rl.x, 1e10) * 1.6, Math.min(a.q.x, 1e10) * 1.3);
    const xmax = Math.pow(10, Math.ceil(Math.log10(want) * 2) / 2);
    const lx0 = Math.log10(xmin), lx1 = Math.log10(xmax);
    const YMIN = 1e-4, YMAX = Math.pow(10, Math.ceil(Math.log10(m.n / m.Y) + 0.05));
    const ly0 = Math.log10(YMIN), ly1 = Math.log10(YMAX);
    const X = v => L + (Math.log10(v) - lx0) / (lx1 - lx0) * (W - L - R);
    const Y = r => T + (ly1 - Math.log10(Math.max(YMIN, Math.min(YMAX, r)))) / (ly1 - ly0) * (H - T - B);
    for (let d = ly0; d <= ly1; d++){
      const v = Math.pow(10, d);
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: COL.grid }));
      const lab = v >= 1 ? String(v) : v >= 0.01 ? String(v) : '1e' + d;
      svg.appendChild(el('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, lab));
    }
    for (let d = Math.ceil(lx0 - 1e-9); d <= lx1 + 1e-9; d++){
      [1, 3].forEach(mlt => {
        const v = mlt * Math.pow(10, d); if (v < xmin * 0.999 || v > xmax * 1.001) return;
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: COL.grid, 'stroke-dasharray': mlt === 3 ? '2 4' : '' }));
        if (!narrow || mlt === 1) svg.appendChild(el('text', { x: X(v), y: H - B + 16, 'text-anchor': 'middle' }, fmAxis(v)));
      });
    }
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: COL.axis }));
    svg.appendChild(el('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle' }, 'loss size, log scale'));
    svg.appendChild(el('text', { x: 12, y: (T + H - B) / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${(T + H - B) / 2})` }, 'losses a year at least this large'));
    const clip = el('clipPath', { id: 'tclip' }); clip.appendChild(el('rect', { x: L, y: T, width: W - L - R, height: H - T - B })); svg.appendChild(clip);
    const G = el('g', { 'clip-path': 'url(#tclip)' }); svg.appendChild(G);
    const curve = (f, from, to) => {
      let d = '', st = false; const N = 160;
      for (let i = 0; i <= N; i++){
        const v = Math.pow(10, Math.log10(from) + (Math.log10(to) - Math.log10(from)) * i / N);
        const r = f(v); if (r == null || !(r > 0)) { if (st) break; else continue; }
        d += `${st ? 'L' : 'M'}${X(v).toFixed(1)},${Y(Math.max(YMIN * 0.5, r)).toFixed(1)}`; st = true;
        if (r < YMIN) break;
      }
      return d;
    };
    // reference levels
    const refs = [[1 / m.T, `${tName(m.T)} years`], [1 - m.alpha, `${confTxt()} level`]];
    refs.forEach(([r, lab], i) => {
      if (r < YMIN || r > YMAX) return;
      G.appendChild(el('line', { x1: L, x2: W - R, y1: Y(r), y2: Y(r), stroke: COL.gold, 'stroke-dasharray': '5 4', opacity: .55 }));
      svg.appendChild(el('text', { x: L + 6, y: Y(r) + (i === 0 ? -5 : 13), style: `fill:${COL.gold}` }, lab));
    });
    // threshold
    G.appendChild(el('line', { x1: X(a.u), x2: X(a.u), y1: T, y2: H - B, stroke: COL.text, 'stroke-dasharray': '3 3', opacity: .45 }));
    svg.appendChild(el('text', { x: X(a.u) + 5, y: H - B - 6, style: `fill:${COL.muted || '#8a96a8'}` }, `u = ${fm(a.u)}`));
    // whole-data fits
    if (showWhole){
      G.appendChild(el('path', { d: curve(w.logn.rate, xmin, xmax), fill: 'none', stroke: COL.logn, 'stroke-width': 1.8 }));
      G.appendChild(el('path', { d: curve(w.normal.rate, xmin, xmax), fill: 'none', stroke: COL.blue, 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));
    }
    // other thresholds
    m.steps.forEach(s => { if (s.k !== a.k) G.appendChild(el('path', { d: curve(s.rate, s.u * 1.0001, xmax), fill: 'none', stroke: 'rgba(111,211,160,.22)', 'stroke-width': 1.1 })); });
    // data points
    const xs = m.x;
    for (let i = 0; i < m.n; i++){
      const v = xs[i], r = (m.n - i) / m.Y, inTail = i >= m.n - a.k;
      G.appendChild(el('circle', { cx: X(v), cy: Y(r), r: inTail ? 3 : 2.3, fill: inTail ? COL.text : 'rgba(230,235,242,.38)' }));
    }
    // current GPD
    G.appendChild(el('path', { d: curve(a.rate, a.u * 1.0001, xmax), fill: 'none', stroke: COL.acc, 'stroke-width': 2.8 }));
    // 95% range at 1/T
    const rT = 1 / m.T;
    if (a.rl.profile && rT >= YMIN){
      const x0 = X(Math.max(xmin, a.rl.lo)), x1 = X(Math.min(xmax * 2, a.rl.hi)), yy = Y(rT);
      G.appendChild(el('rect', { x: x0, y: yy - 4, width: Math.max(2, x1 - x0), height: 8, rx: 3, fill: 'rgba(111,211,160,.22)' }));
      G.appendChild(el('circle', { cx: X(a.rl.x), cy: yy, r: 5, fill: COL.acc, stroke: '#0a0e16', 'stroke-width': 2 }));
    }
    // worst loss
    const wv = xs[m.n - 1], wr = 1 / m.Y;
    svg.appendChild(el('circle', { cx: X(wv), cy: Y(wr), r: 8, fill: 'none', stroke: COL.gold, 'stroke-width': 1.6 }));
    const wl = `worst: ${fm(wv)}`, wx = X(wv) + 12;
    svg.appendChild(el('text', { x: wx + wl.length * 7 > W - R ? X(wv) - 12 : wx, y: Y(wr) - 8, 'text-anchor': wx + wl.length * 7 > W - R ? 'end' : 'start', style: `fill:${COL.gold};font-weight:600` }, wl));
    svg.appendChild(el('text', { x: W - R - 4, y: T + 12, 'text-anchor': 'end', style: `fill:${COL.text};font-weight:600` }, narrow ? `ξ = ${fn(a.xi, 2)} · ${tName(m.T)}: ${fm(a.rl.x)}` : `top ${a.k} · ξ = ${fn(a.xi, 2)} · ${tName(m.T)}: ${fm(a.rl.x)}`));
    $('tailLegend').querySelectorAll('.lg-whole').forEach(s => s.classList.toggle('off', !showWhole));
    // hover
    const guide = el('line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: COL.text, opacity: 0 }); svg.appendChild(guide);
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', style: 'cursor:crosshair' }); svg.appendChild(hit);
    const tip = $('tailTip');
    const every = r => r == null || !(r > 0) ? 'never' : r >= 1 ? `${fn(r, r >= 10 ? 0 : 1)} a year` : `1 in ${fyrs(1 / r).replace(' years', '')} yrs`;
    hit.addEventListener('mousemove', ev => {
      const rc = svg.getBoundingClientRect(), px = (ev.clientX - rc.left) / rc.width * W;
      const v = Math.pow(10, lx0 + (px - L) / (W - L - R) * (lx1 - lx0));
      const emp = m.x.filter(t => t >= v).length / m.Y;
      guide.setAttribute('x1', px); guide.setAttribute('x2', px); guide.setAttribute('opacity', .3);
      tip.hidden = false;
      tip.innerHTML = `Loss ≥ <b>${fm(v)}</b><br>data: ${emp > 0 ? every(emp) : 'none seen'}<br><span style="color:${COL.acc}">GPD: ${v > a.u ? every(a.rate(v)) : 'below u'}</span>` +
        (showWhole ? `<br><span style="color:${COL.logn}">lognormal: ${every(w.logn.rate(v))}</span><br><span style="color:${COL.blue}">normal: ${every(w.normal.rate(v))}</span>` : '');
      const left = px / W * rc.width;
      tip.style.left = Math.min(rc.width - 90, Math.max(90, left)) + 'px';
      tip.style.top = '18%';
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; guide.setAttribute('opacity', 0); });
  }

  function renderStab(){
    const m = model, a = m.cur, svg = $('stabChart'); svg.innerHTML = '';
    const W = cw(svg), H = W < 520 ? 230 : 260, L = 58, R = 16, T = 14, B = 34;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const G = m.grid.filter(Boolean);
    const u0 = Math.log(G[0].u), u1 = Math.log(G[G.length - 1].u);
    const X = u => L + (Math.log(u) - u0) / (u1 - u0 || 1) * (W - L - R);
    let get, lo, hi, logY = false, fmt, ref = [], lab;
    if (metric === 'xi'){ get = s => s.xi; lo = s => s.xiLo; hi = s => s.xiHi; fmt = v => fn(v, 1); ref = [[0, 'ξ = 0'], [1, 'ξ = 1: no mean']]; lab = 'Shape ξ'; }
    else if (metric === 'rl'){ get = s => s.rl.x; lo = s => s.rl.lo; hi = s => s.rl.hi; logY = true; fmt = fmAxis; ref = [[m.x[m.n - 1], 'worst loss']]; lab = `${tName(m.T)}-year loss`; }
    else if (metric === 'var'){ get = s => s.VaR; lo = s => s.VaRlo; hi = s => s.VaRhi; logY = true; fmt = fmAxis; lab = `${confTxt()} annual VaR`; }
    else { get = s => s.meanExcess; lo = null; hi = null; fmt = fmAxis; lab = 'Mean excess above u'; }
    const vals = G.map(get).filter(isFinite);
    const bandIdx = metric === 'xi' ? G : m.steps; // CIs: Wald for ξ on every k; profile ranges at the ten steps for levels
    let ymin, ymax;
    if (metric === 'xi'){ ymin = Math.min(-0.2, ...G.map(lo)); ymax = Math.max(1.2, ...G.map(hi)); ymin = Math.floor(ymin * 2) / 2; ymax = Math.ceil(ymax * 2) / 2; }
    else if (logY){
      const lows = m.steps.map(lo).filter(v => isFinite(v) && v > 0);
      ymin = Math.pow(10, Math.floor(Math.log10(Math.min(...vals, ...lows, ...ref.map(r => r[0])))));
      ymax = Math.pow(10, Math.ceil(Math.log10(Math.max(...vals) * 3)));
      ymax = Math.min(ymax, ymin * 1e4);
    } else { ymin = 0; ymax = Math.max(...vals) * 1.15; }
    const Y = logY ? (v => T + (Math.log10(ymax) - Math.log10(Math.max(ymin, Math.min(ymax, v)))) / (Math.log10(ymax) - Math.log10(ymin)) * (H - T - B))
      : (v => T + (ymax - Math.max(ymin, Math.min(ymax, v))) / (ymax - ymin) * (H - T - B));
    // grid
    const yt = [];
    if (logY){ for (let d = Math.log10(ymin); d <= Math.log10(ymax) + 1e-9; d++) yt.push(Math.pow(10, d)); }
    else if (metric === 'xi'){ const st = ymax - ymin > 2.6 ? 1 : 0.5; for (let v = Math.ceil(ymin / st) * st; v <= ymax + 1e-9; v += st) yt.push(v); }
    else { const n = 5; for (let i = 0; i <= n; i++) yt.push(ymin + (ymax - ymin) * i / n); }
    yt.forEach(v => { svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: COL.grid })); svg.appendChild(el('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmt(v))); });
    // x ticks at the step thresholds 50%, 25%, 10%, 5%
    [0, 3, 7, 9].forEach((i, j) => { const s = m.steps[i]; if (!s || (W < 520 && j === 2)) return; const an = j === 0 ? 'start' : j === 3 ? 'end' : 'middle'; svg.appendChild(el('text', { x: X(s.u), y: H - 16, 'text-anchor': an }, fmAxis(Math.round(s.u / 1000) * 1000))); svg.appendChild(el('text', { x: X(s.u), y: H - 3, 'text-anchor': an, style: 'fill:#5b6678' }, 'top ' + fpct(STEP_P[i]))); });
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: COL.axis }));
    ref.forEach(([v, t]) => { if (v < ymin || v > ymax) return; svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: v === 1 && metric === 'xi' ? COL.red : COL.gold, 'stroke-dasharray': '5 4', opacity: .6 })); });
    const refLabels = () => ref.forEach(([v, t]) => {
      if (v < ymin || v > ymax) return;
      const c = v === 1 && metric === 'xi' ? COL.red : COL.gold, tw = t.length * 6.6 + 10, y = Y(v);
      svg.appendChild(el('rect', { x: L + 4, y: y - 9, width: tw, height: 17, rx: 4, fill: '#0b111c', stroke: c, 'stroke-opacity': .45 }));
      svg.appendChild(el('text', { x: L + 9, y: y + 4, style: `fill:${c}` }, t));
    });
    // band
    if (metric === 'xi'){
      const up = G.map(s => `${X(s.u).toFixed(1)},${Y(s.xiHi).toFixed(1)}`), dn = G.map(s => `${X(s.u).toFixed(1)},${Y(s.xiLo).toFixed(1)}`).reverse();
      svg.appendChild(el('path', { d: `M${up.join('L')}L${dn.join('L')}Z`, fill: 'rgba(111,211,160,.14)' }));
    } else if (lo){
      m.steps.forEach(s => { const l = lo(s), h = hi(s); if (!isFinite(l)) return; svg.appendChild(el('line', { x1: X(s.u), x2: X(s.u), y1: Y(l), y2: Y(isFinite(h) ? h : ymax), stroke: 'rgba(111,211,160,.45)', 'stroke-width': 5, 'stroke-linecap': 'round' })); });
    }
    if (metric === 'me' && a.xi < 1){
      const f = v => (a.sigma + a.xi * (v - a.u)) / (1 - a.xi), uEnd = G[G.length - 1].u;
      let dd = ''; for (let i = 0; i <= 40; i++){ const v = a.u * Math.pow(uEnd / a.u, i / 40); dd += `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(f(v)).toFixed(1)}`; }
      svg.appendChild(el('path', { d: dd, stroke: COL.gold, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', fill: 'none' }));
    }
    svg.appendChild(el('path', { d: 'M' + G.filter(s => isFinite(get(s))).map(s => `${X(s.u).toFixed(1)},${Y(get(s)).toFixed(1)}`).join('L'), fill: 'none', stroke: COL.acc, 'stroke-width': 2 }));
    m.steps.forEach(s => { if (isFinite(get(s))) svg.appendChild(el('circle', { cx: X(s.u), cy: Y(get(s)), r: 3.2, fill: COL.acc })); });
    const cx = X(a.u);
    svg.appendChild(el('line', { x1: cx, x2: cx, y1: T, y2: H - B, stroke: COL.text, opacity: .5 }));
    if (isFinite(get(a))) svg.appendChild(el('circle', { cx, cy: Y(get(a)), r: 5.5, fill: COL.acc, stroke: '#0a0e16', 'stroke-width': 2 }));
    svg.appendChild(el('text', { x: W - R - 4, y: T + 12, 'text-anchor': 'end', style: `fill:${COL.text};font-weight:600` }, `${lab}: ${metric === 'xi' ? fn(get(a), 2) : fm(get(a))}`));
    refLabels();
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', style: 'cursor:pointer' });
    hit.addEventListener('click', ev => {
      const rc = svg.getBoundingClientRect(), px = (ev.clientX - rc.left) / rc.width * W;
      let best = G[0], bd = Infinity; G.forEach(s => { const d = Math.abs(X(s.u) - px); if (d < bd){ bd = d; best = s; } });
      stopPlay(); setK(best.k);
    });
    svg.appendChild(hit);
    $('stabLegend').innerHTML = `<span><i class="sw main"></i>${lab}, every threshold</span>` +
      (metric === 'xi' ? `<span><i class="sw band"></i>95% range</span>` : lo ? `<span><i class="sw band"></i>95% profile range at the ten steps</span>` : `<span><i class="sw gold"></i>GPD-implied line from the current fit</span>`) +
      `<span><i class="sw dot" style="background:var(--accent)"></i>The ten steps</span><span class="muted">Click to pick a threshold</span>`;
  }

  function renderBars(){
    const m = model, a = m.cur, w = m.whole, svg = $('barChart'); svg.innerHTML = '';
    const W = cw(svg), narrow = W < 520, L = narrow ? 92 : 140, R = narrow ? 62 : 90, T = 6, gh = 78, H = T + 3 * gh + 6;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const groups = [[`${tName(m.T)}-yr loss`, [w.normal.rl, w.logn.rl, a.rl.x]], [`${confTxt()} VaR`, [w.normal.VaR, w.logn.VaR, a.VaR]], [`${confTxt()} ES`, [w.normal.ES, w.logn.ES, a.ES]]];
    const fin = groups.flatMap(g => g[1]).filter(isFinite);
    const vmax = Math.max(...fin) * 1.02, cols = [COL.blue, COL.logn, COL.acc];
    groups.forEach(([lab, vs], gi) => {
      const y0 = T + gi * gh;
      const parts = narrow ? lab.split(' ') : [lab];
      parts.forEach((pt, pi) => svg.appendChild(el('text', { x: L - 10, y: y0 + 38 + (pi - (parts.length - 1) / 2) * 15, 'text-anchor': 'end', style: `fill:${COL.text};font-family:Inter,sans-serif;font-size:${narrow ? 12 : 13}px;font-weight:600` }, pt)));
      vs.forEach((v, i) => {
        const y = y0 + 8 + i * 21, inf = !isFinite(v), wd = inf ? W - L - R : Math.max(2, v / vmax * (W - L - R));
        svg.appendChild(el('rect', { x: L, y, width: wd, height: 15, rx: 3, fill: cols[i], opacity: inf ? .45 : .9 }));
        svg.appendChild(el('text', { x: L + wd + 8, y: y + 12, style: `fill:${inf ? COL.red : COL.text}` }, inf ? '∞' : fm(v)));
      });
      if (gi < 2) svg.appendChild(el('line', { x1: 20, x2: W - 20, y1: y0 + gh - 3, y2: y0 + gh - 3, stroke: COL.grid }));
    });
    $('barNote').textContent = `GPD at the top ${a.k}; whole-data fits use all ${m.n}`;
  }

  function renderTable(){
    const m = model, si = stepIndex();
    $('thRl').textContent = tName(m.T);
    $('logBody').innerHTML = m.steps.map((s, i) => {
      const [fc, ft] = fitFlag(s);
      return `<tr data-k="${s.k}" class="${i === si ? 'sel' : ''}"><td>${s.k} <span class="muted">${fpct(STEP_P[i])}</span></td><td>${fm(s.u)}</td>
        <td class="${s.xi >= 1 ? 'inf' : ''}">${fn(s.xi, 2)} <span class="muted rng">${fn(s.xiLo, 2)}–${fn(s.xiHi, 2)}</span></td>
        <td class="bayes">${fm(s.rl.x)}</td><td>${fm(s.VaR)}</td><td class="${isFinite(s.ES) ? '' : 'inf'}">${isFinite(s.ES) ? fm(s.ES) : '∞'}</td>
        <td><span class="zchip ${fc}">${ft}</span></td></tr>`;
    }).join('');
    $('logBody').querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => { stopPlay(); setK(+tr.dataset.k); }));
  }

  function renderTicks(){
    $('stepTicks').innerHTML = [0, 3, 7, 9].map(i => `<span style="left:${i / (NS - 1) * 100}%">${fpct(STEP_P[i])}</span>`).join('');
  }

  // ---------- guide (live numbers) ----------
  function renderGuide(){
    const m = model; if (!m) return;
    const a = m.cur, w = m.whole, lam = m.n / m.Y, s0 = m.steps[0], s9 = m.steps[NS - 1];
    const rls = m.steps.map(s => s.rl.x), rlo = Math.min(...rls), rhi = Math.max(...rls);
    const T = m.T, worst = m.worst.a * 1000;
    // annual aggregate 1-in-T (SLA on the GPD tail, mean-corrected), for the Guide only
    const pA = 1 / T, qT = a.lamU > pA ? a.u + EVT.gpdIsf(pA / a.lamU, a.xi, a.sigma) : NaN;
    const aggT = isFinite(qT) ? qT + a.corr : NaN;
    const top5 = m.x.slice(-5).reduce((s, v) => s + v, 0);
    const ctab = rows => `<div class="tablewrap"><table class="ctab"><tr>${rows[0].map(h => `<th>${h}</th>`).join('')}</tr>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
    $('guideDyn').innerHTML = `
      <section class="card">
        <h2 class="g">1. The Question</h2>
        <p class="guide-note">Every number below comes from the current inputs on the Simulator tab and updates as you change them.</p>
        <p>"Our worst operational loss in ${fr(m.Y)} years was ${fm(worst)}. What does a ${tName(T)}-year loss look like?" A risk committee asks this because capital, insurance limits, and board risk appetite all depend on losses the firm has never seen. With ${m.n} losses in ${fr(m.Y)} years, you have no direct observation of a ${fint(T)}-year event. You have to extrapolate, and the answer depends almost entirely on how you model the tail.</p>
        <p>This app's answer, at the current threshold, is <b>${fm(a.rl.x)}</b>, with a 95% range of ${fm(a.rl.lo)} to ${fmHi(a.rl.hi)}. A lognormal fitted to the same data says ${fm(w.logn.rl)}. A normal says ${fm(w.normal.rl)}.</p>
        <div class="callout"><b>Two lessons, not one.</b> First, whole-data models understate the tail, often by several times. Second, even the right model is very uncertain this far out. Report the range, not just the number.</div>
      </section>

      <section class="card">
        <h2 class="g">2. Why Whole-Data Fits Fail</h2>
        <p>A normal or lognormal is fitted to all ${m.n} losses. Most of them are small: the median is ${fm(m.med)}. So the fit is driven by the ordinary losses in the middle, and the tail is whatever the bell shape implies. It's not a measurement of the large losses.</p>
        <p>The top five losses add up to ${fm(top5)}, or ${Math.round(top5 / m.sum * 100)}% of all losses by dollar. They're five points out of ${m.n}, so they have almost no pull on the fitted mean and spread. That's why the lognormal says the ${fm(worst)} loss should come about once every <b>${fyrs(w.logn.rpWorst)}</b>, and the normal says ${fyrs(w.normal.rpWorst)}, when the firm saw one in ${fr(m.Y)}. The GPD tail fit says about once every <b>${fyrs(a.rpWorst)}</b>.</p>
        <p>Moscadelli's (2004) study of the Basel Committee's op-loss data found the same thing at industry scale: conventional fits matched the body but systematically understated the high percentiles, while peaks-over-threshold fitted the tail well.</p>
      </section>

      <section class="card">
        <h2 class="g">3. Extreme Value Theory in One Idea</h2>
        <p>The Pickands–Balkema–de Haan theorem says that for almost any loss distribution you'll meet in practice, the part above a high enough threshold u looks like a <b>Generalized Pareto distribution</b> (GPD). You don't need to know the shape of the whole distribution. You only need the losses that exceed u, and you fit the GPD to how far they overshoot it.</p>
        <p>That's the peaks-over-threshold method. Here it keeps the top ${a.k} losses (${fpct(pctTail(a.k))}), all above u = ${fm(a.u)}, and throws the other ${m.n - a.k} away for the tail fit. Throwing data away feels wrong, but those smaller losses carry no information about the tail. Including them would bias it, which is exactly what the whole-data fits do.</p>
      </section>

      <section class="card">
        <h2 class="g">4. The GPD and the Meaning of <span class="nc">ξ</span></h2>
        <p>For an excess y = loss − u, the GPD's survival function is</p>
        <div class="eq mono">P(Y &gt; y) = (1 + ξ·y/σ)<sup>−1/ξ</sup></div>
        <p>σ is a scale, in dollars. ξ (xi) is the shape, and it's the number that matters. It says how fast the tail thins out:</p>
        ${ctab([['ξ', 'Tail', 'What it means'], ['below 0', 'bounded', 'There is a maximum possible loss.'], ['0', 'exponential', 'Like a lognormal or normal: the tail thins out quickly.'], ['0 to 0.5', 'heavy', 'Power-law tail. Mean and variance exist.'], ['0.5 to 1', 'very heavy', 'Mean exists, but variance is infinite.'], ['1 or more', 'extreme', 'No mean. Expected Shortfall is infinite.']])}
        <p>The current fit has ξ = <b>${fn(a.xi, 2)}</b>, so the tail is "${tailBadge(a.xi)[1].toLowerCase()}." A lognormal behaves like ξ = 0 far out: its tail is heavier than a normal's but still thins faster than any power law. That gap grows the further out you look.</p>
      </section>

      <section class="card">
        <h2 class="g">5. Fitting and Uncertainty</h2>
        <p>The app fits ξ and σ by maximum likelihood, solving numerically with a Nelder–Mead search on the log-likelihood</p>
        <div class="eq mono">ℓ(ξ, σ) = −k·ln σ − (1 + 1/ξ)·Σ ln(1 + ξ·yᵢ/σ)</div>
        <p>At the current threshold: ξ = ${fn(a.xi, 3)}, σ = ${fm(a.sigma)}. For ξ above −0.5 the standard error of ξ is about (1 + ξ)/√k = (1 + ${fn(a.xi, 3)})/√${a.k} = ${fn(a.seXi, 3)}, so the 95% range is ${fn(a.xiLo, 2)} to ${fn(a.xiHi, 2)}. With only ${a.k} points, that range spans everything from a ${tailBadge(Math.max(a.xiLo, 0.06))[1].toLowerCase()} to ${a.xiHi >= 1 ? 'one with no mean at all' : 'a ' + tailBadge(a.xiHi)[1].toLowerCase()}.</p>
        <p>For the return level, VaR, and the threshold log, the app uses <b>profile-likelihood</b> ranges (Coles 2001, section 4.3.3), not the symmetric ± formula. The likelihood is re-maximized with the return level held fixed, and the range keeps every level the data can't reject at 95%. The result is lopsided: the lower end is tight and the upper end is long, because the data can rule out a thin tail much more easily than a fat one.</p>
      </section>

      <section class="card">
        <h2 class="g">6. The ${tName(T)}-Year Loss</h2>
        <p>Losses above u arrive at λᵤ = k/years = ${a.k}/${fr(m.Y)} = ${fn(a.lamU, 2)} a year. The yearly rate of losses bigger than x is λᵤ·P(Y &gt; x − u). Setting that equal to 1/T and solving:</p>
        <div class="eq mono">x<sub>T</sub> = u + (σ/ξ)·[(T·λᵤ)<sup>ξ</sup> − 1] = ${fm(a.u)} + (${fm(a.sigma)}/${fn(a.xi, 3)})·[(${fint(T)}×${fn(a.lamU, 2)})<sup>${fn(a.xi, 3)}</sup> − 1] = ${fm(a.rl.x)}</div>
        <p>This is the single largest loss you'd expect about once in ${fint(T)} years. It's the right reading of the question for a loss event. A board may also want the 1-in-${fint(T)} <b>total</b> for the year: that's the annual VaR at ${fn(100 - 100 / T, 1)}%, about ${fm(aggT)} here, slightly more because it adds the year's ordinary losses.</p>
      </section>

      <section class="card">
        <h2 class="g">7. VaR and Expected Shortfall</h2>
        <p>Op-risk capital models have used a one-year 99.9% standard: the annual loss exceeded once in 1,000 years. When the severity is heavy-tailed, the worst year is dominated by its single worst loss. The <b>single-loss approximation</b> (Böcker and Klüppelberg 2005) turns that into a formula: annual VaR at α is roughly the severity quantile exceeded at rate 1 − α a year, plus a mean correction for the other λ − 1 losses (Böcker and Sprittulla 2006).</p>
        <div class="eq mono">VaR ≈ u + (σ/ξ)·[(λᵤ/(1−α))<sup>ξ</sup> − 1] + (λ − 1)·μ = ${fm(a.q.x)} + ${fm(a.corr)} = ${fm(a.VaR)}</div>
        <p>Here λ = ${fn(lam, 1)} losses a year and μ = ${a.xi < 1 ? fm(a.sevMean) : '∞'} is the average loss, using the actual losses below u and the GPD mean above it. Expected Shortfall, the average of the years worse than VaR, has a closed form for a GPD tail when ξ &lt; 1 (Böcker 2006):</p>
        <div class="eq mono">ES ≈ (q + σ − ξ·u)/(1 − ξ) + (λ − 1)·μ = ${isFinite(a.ES) ? fm(a.ES) : '∞'}</div>
        <p>${a.xi < 1 ? `ES is ${fn(a.ES / a.VaR, 1)}× VaR. For a GPD the ratio is about 1/(1 − ξ), so it explodes as ξ approaches 1.` : `Because ξ ≥ 1 at this threshold, the GPD has no mean, and ES is infinite. The VaR is still defined, but the mean correction is dropped.`} The approximation is good at 99.9% for heavy tails. As a check, a 2-million-year Monte Carlo simulation of the default data at the top 25% gave a VaR of $38.7M and an ES of $73.3M, against $38.3M and $73.8M from the formulas.</p>
      </section>

      <section class="card">
        <h2 class="g">8. Choosing the Threshold</h2>
        <p>The theorem only holds "above a high enough threshold." Too low, and ordinary losses bend the fit (bias). Too high, and there are too few points (variance). There's no formula for the right u. Practitioners look for a range where the estimates stop drifting, using two pictures from Coles (2001):</p>
        <ul>
          <li><b>Parameter stability.</b> Above a valid threshold, ξ should stay roughly constant. Switch the Threshold Stability chart to ξ: here it runs from ${fn(Math.min(...m.steps.map(s => s.xi)), 2)} to ${fn(Math.max(...m.steps.map(s => s.xi)), 2)} across the ten steps.</li>
          <li><b>Mean excess.</b> For a GPD, the average overshoot above v rises in a straight line with slope ξ/(1 − ξ). Switch the chart to Mean excess. Because the threshold axis is on a log scale, that line shows as the gold dashed curve from the current fit. Look for the range where the dots follow it.</li>
        </ul>
        <p>Across the ten steps, the ${tName(T)}-year loss runs from ${fm(rlo)} to ${fm(rhi)}. At the top ${fpct(STEP_P[0])} (${s0.k} points) it's ${fm(s0.rl.x)}. At the top ${fpct(STEP_P[NS - 1])} (${s9.k} points) it's ${fm(s9.rl.x)}. That spread is the honest uncertainty of a tail estimate from ${m.n} losses. The "Fit" flag in the Threshold Log marks a ξ range of ±0.3 or less as Stable and ±0.5 or less as Sensitive. Anything wider is Unstable.</p>
      </section>

      <section class="card">
        <h2 class="g">9. Caveats</h2>
        <ul>
          <li><b>Small samples.</b> ${m.n} losses and ${a.k} tail points are typical for one firm, and they're not much. Pooling with external loss data or scenario analysis is common for that reason.</li>
          <li><b>Independent and stable.</b> The method assumes losses are independent and come from an unchanging process. Control changes, new strategies, and growth all break that.</li>
          <li><b>The reporting floor.</b> Nothing below ${fm(state.floor * 1000)} is recorded. The tail fit only uses losses above u, so it isn't affected, but the whole-data fits ignore the truncation and are biased because of it.</li>
          <li><b>Late-discovered losses.</b> As the IBNR study showed, large losses can surface years after they occur. Recent years in this log may be undercounted, which biases λ and the tail downward.</li>
          <li><b>Inflation and scale.</b> A 2016 loss isn't the same size in today's dollars, and a larger firm has larger losses. Scaling the losses first is standard practice.</li>
          <li><b>The approximation.</b> The single-loss formulas are approximations. They work best at high confidence and for heavy tails. At low confidence or light tails, simulate.</li>
          <li><b>ξ ≥ 1.</b> With few points, ξ can come out above 1. That usually means the sample is too small to tell, not that losses truly have no mean.</li>
        </ul>
      </section>`;
  }

  // ---------- orchestration ----------
  function rangeWarn(){
    const m = model, a = m.cur, L = [];
    if (1 / m.T >= a.lamU) L.push(['warn', `A ${tName(m.T)}-year loss sits below the threshold of ${fm(a.u)}, where the tail model doesn't apply. Use a longer return period or a lower threshold.`]);
    if (1 - m.alpha >= a.lamU) L.push(['warn', `At ${confTxt()}, the VaR quantile sits below the threshold, so the tail formulas don't apply. Raise the confidence level.`]);
    renderMsgs($('measMsgs'), L);
  }
  function renderAll(){
    if (!model) return;
    rangeWarn();
    renderDataSum(); renderKpis(); renderStability(); renderSteps(); renderTail(); renderStab(); renderBars(); renderTable(); renderGuide();
  }
  function setK(k){ if (!model) return; curK = Math.max(model.kMin, Math.min(model.kMax, k)); const nm = compute(); if (nm.fail) return; model = nm; renderAll(); }
  function setStep(i){ if (!model) return; i = Math.max(0, Math.min(NS - 1, i)); setK(model.ks[i]); }
  let timer = null;
  function schedule(){ clearTimeout(timer); timer = setTimeout(recompute, 220); }
  function recompute(rebuild){
    clearTimeout(timer);
    if (!validateAll()) { document.body.classList.add('stale'); return; }
    document.body.classList.remove('stale');
    const nm = compute();
    if (nm.fail){
      document.body.classList.add('stale');
      $('dataMsgs').insertAdjacentHTML('beforeend', `<div class="msg err">The tail fit didn't converge for these ${nm.n} losses. This usually means many identical amounts. Add more distinct losses.</div>`);
      if (rebuild) buildLossLog();
      return false;
    }
    model = nm;
    if (rebuild) buildLossLog();
    renderAll(); return true;
  }
  function syncInputs(){
    $('inYears').value = fr(state.years); $('inFloor').value = fk(state.floor); $('inT').value = fint(state.T).replace(/,/g, ''); $('inConf').value = fr(state.conf);
  }
  [['inYears', 'years', parseNum], ['inFloor', 'floor', parseMoney], ['inT', 'T', parseNum], ['inConf', 'conf', parseNum]].forEach(([id, key, p]) => {
    $(id).addEventListener('input', e => { state[key] = p(e.target.value); if (key === 'floor') curK = null; schedule(); });
    $(id).addEventListener('change', () => { if (key === 'floor' && valid) buildLossLog(); });
  });
  $('resetBtn').addEventListener('click', () => {
    stopPlay(); state = Object.assign({ losses: freshLosses() }, DEFAULTS); curK = null;
    $('pasteArea').value = ''; syncInputs(); validateAll(); model = compute(); buildLossLog(); validateAll(); renderAll();
  });
  $('stepRange').addEventListener('input', e => { stopPlay(); setStep(+e.target.value); });
  $('fineRange').addEventListener('input', e => { stopPlay(); setK(model.kMax - +e.target.value); });
  $('prevBtn').addEventListener('click', () => { stopPlay(); const i = stepIndex(); setStep(i < 0 ? nearestStep() : i - 1); });
  $('nextBtn').addEventListener('click', () => { stopPlay(); const i = stepIndex(); setStep(i < 0 ? nearestStep() : i + 1); });
  function stopPlay(){ if (playing){ clearInterval(playing); playing = null; $('playBtn').textContent = 'Play'; } }
  $('playBtn').addEventListener('click', () => {
    if (playing) return stopPlay();
    if (!model) return;
    let i = stepIndex(); if (i < 0 || i >= NS - 1) { i = 0; setStep(0); }
    $('playBtn').textContent = 'Pause';
    playing = setInterval(() => { const j = stepIndex(); if (j >= NS - 1) return stopPlay(); setStep((j < 0 ? nearestStep() : j) + 1); }, 1000);
  });
  document.querySelectorAll('[data-fits]').forEach(b => b.addEventListener('click', () => {
    showWhole = b.dataset.fits === 'all'; document.querySelectorAll('[data-fits]').forEach(x => x.classList.toggle('on', x === b)); renderTail();
  }));
  document.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => {
    metric = b.dataset.metric; document.querySelectorAll('[data-metric]').forEach(x => x.classList.toggle('on', x === b)); renderStab();
  }));
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
    $('tab-sim').classList.toggle('hidden', t.dataset.tab !== 'sim');
    $('tab-guide').classList.toggle('hidden', t.dataset.tab !== 'guide');
  }));
  const mRl = () => { $('mRl').textContent = tName(state.T); };
  $('inT').addEventListener('input', () => { if (isFinite(state.T)) mRl(); });

  let rz = null, lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rz); rz = setTimeout(() => { if (model){ renderTail(); renderStab(); renderBars(); } }, 150); });
  // charts sized on a hidden tab get redrawn when it becomes visible
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { if (t.dataset.tab === 'sim' && model) setTimeout(() => { renderTail(); renderStab(); renderBars(); }, 0); }));

  // expose a tiny hook for automated checks
  window.__evt = { get model(){ return model; }, get state(){ return state; }, setK, setStep };

  syncInputs(); renderTicks(); model = compute(); buildLossLog(); validateAll(); mRl(); renderAll();
})();
