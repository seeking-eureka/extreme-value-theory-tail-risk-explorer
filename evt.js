/*
 * evt.js: statistics engine for the Extreme Value Theory Tail Risk Explorer.
 * Peaks-over-threshold with a Generalized Pareto (GPD) tail, fitted by
 * maximum likelihood, plus normal and lognormal whole-data fits for comparison.
 * Plain JavaScript, no dependencies. Works in the browser (window.EVT) and Node.
 */
(function (root) {
  'use strict';

  // ---------- normal distribution helpers ----------
  // erfc with fractional error < 1.2e-7 everywhere (Numerical Recipes, Chebyshev fit)
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const normSf = z => 0.5 * erfc(z / Math.SQRT2);           // P(Z > z)
  const normPdf = z => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  // Acklam's inverse normal CDF, refined with one Halley step
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425; let q, r, x;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const e = 0.5 * erfc(-x / Math.SQRT2) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  // ---------- GPD ----------
  const EPS = 1e-7;
  function gpdNll(y, xi, sig) {
    if (!(sig > 0)) return Infinity;
    const n = y.length; let s = 0;
    if (Math.abs(xi) < EPS) { for (let i = 0; i < n; i++) s += y[i]; return n * Math.log(sig) + s / sig; }
    for (let i = 0; i < n; i++) { const t = 1 + xi * y[i] / sig; if (t <= 0) return Infinity; s += Math.log(t); }
    return n * Math.log(sig) + (1 + 1 / xi) * s;
  }
  // survival of the excess: P(Y > y)
  function gpdSf(y, xi, sig) {
    if (y <= 0) return 1;
    if (Math.abs(xi) < EPS) return Math.exp(-y / sig);
    const t = 1 + xi * y / sig; if (t <= 0) return 0;
    return Math.pow(t, -1 / xi);
  }
  // excess level exceeded with probability p
  function gpdIsf(p, xi, sig) {
    if (Math.abs(xi) < EPS) return -sig * Math.log(p);
    return sig / xi * (Math.pow(p, -xi) - 1);
  }

  function nelderMead(f, x0, step, iters) {
    const n = x0.length; let pts = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; pts.push(p); }
    let vals = pts.map(f);
    for (let it = 0; it < iters; it++) {
      const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      pts = idx.map(i => pts[i]); vals = idx.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-11 * (1 + Math.abs(vals[0])) && it > 20) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
      const xr = c.map((v, j) => v + (v - pts[n][j])), fr = f(xr);
      if (fr < vals[0]) {
        const xe = c.map((v, j) => v + 2 * (v - pts[n][j])), fe = f(xe);
        if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
      } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else {
        const xc = c.map((v, j) => v + 0.5 * (pts[n][j] - v)), fc = f(xc);
        if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
        else { for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); } }
      }
    }
    let b = 0; for (let i = 1; i <= n; i++) if (vals[i] < vals[b]) b = i;
    return { x: pts[b], f: vals[b] };
  }

  // Maximum-likelihood GPD fit to excesses y (all > 0). Returns xi, sigma, nll.
  function fitGpd(y) {
    const n = y.length; let m = 0, v = 0;
    for (const t of y) m += t; m /= n;
    for (const t of y) v += (t - m) * (t - m); v /= (n - 1);
    const xiM = Math.max(-0.4, Math.min(0.9, 0.5 * (1 - m * m / v)));
    const starts = [[xiM, Math.log(Math.max(1e-9, 0.5 * m * (m * m / v + 1)))], [0.3, Math.log(m * 0.7)], [0.8, Math.log(m * 0.3)], [0.05, Math.log(m)]];
    const f = p => gpdNll(y, p[0], Math.exp(p[1]));
    let best = null;
    for (const s of starts) {
      if (!isFinite(f(s))) continue;
      let r = nelderMead(f, s, [0.15, 0.3], 600);
      r = nelderMead(f, r.x, [0.02, 0.05], 400);
      if (!best || r.f < best.f) best = r;
    }
    if (!best) return null;
    return { xi: best.x[0], sigma: Math.exp(best.x[1]), nll: best.f };
  }


  // Profile log-likelihood for the excess level e = x_p - u exceeded with conditional prob p.
  // sigma is tied to (xi, e): sigma = xi*e / (p^-xi - 1). Maximise over xi only.
  function profileAt(y, p, e) {
    const L = -Math.log(p);
    const sigOf = xi => Math.abs(xi) < 1e-6 ? e / L : xi * e / (Math.pow(p, -xi) - 1);
    const f = xi => gpdNll(y, xi, sigOf(xi));
    let bx = 0, bf = Infinity;
    for (let xi = -0.45; xi <= 3.0001; xi += 0.05) { const v = f(xi); if (v < bf) { bf = v; bx = xi; } }
    let a = bx - 0.05, b = bx + 0.05; const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let i = 0; i < 40; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    }
    return Math.min(bf, fc, fd);
  }
  // 95% profile-likelihood interval for the level u + e_hat; returns [lo, hi] (hi may be Infinity)
  function profileCI(y, u, p, eHat, nllHat) {
    const crit = 3.841459 / 2;
    const dev = e => profileAt(y, p, e) - nllHat - crit;   // > 0 outside the interval
    let lo = NaN, hi = Infinity;
    // lower bound
    let a = Math.log(eHat * 1e-4), b = Math.log(eHat);
    if (dev(Math.exp(a)) > 0) {
      for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (dev(Math.exp(m)) > 0) a = m; else b = m; }
      lo = Math.exp((a + b) / 2);
    } else lo = 0;
    // upper bound
    a = Math.log(eHat); b = Math.log(eHat * 1e5);
    if (dev(Math.exp(b)) > 0) {
      for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (dev(Math.exp(m)) > 0) b = m; else a = m; }
      hi = Math.exp((a + b) / 2);
    }
    return [u + lo, u + hi];
  }

  // ---------- full POT analysis at one threshold ----------
  // x: losses sorted ascending (dollars); k: number of tail points; Y: years; T: return period; alpha: VaR level
  function analyze(x, k, Y, T, alpha, opts) {
    opts = opts || {};
    const n = x.length, lam = n / Y;
    const u = x[n - k - 1];
    const y = []; for (let i = n - k; i < n; i++) y.push(x[i] - u);
    const fit = fitGpd(y); if (!fit) return null;
    const { xi, sigma } = fit;
    const zeta = k / n, lamU = k / Y;
    // asymptotic (expected-information) covariance, valid for xi > -0.5
    const a1 = 1 + xi;
    const vXi = a1 * a1 / k, vSig = 2 * sigma * sigma * a1 / k, cov = sigma * a1 / k;
    const vZeta = zeta * (1 - zeta) / n;
    const seXi = Math.sqrt(Math.max(0, vXi));
    // return level for exceedance rate r per year (r = 1/T): x = u + gpdIsf(r/lamU)
    function level(r) {
      const p = r / lamU;                         // conditional exceedance prob within the tail
      const xl = u + gpdIsf(p, xi, sigma);
      // delta method on (sigma, xi, zeta); p = r*Y/(n*zeta)
      let dS, dX, dZ;
      if (Math.abs(xi) < EPS) { dS = -Math.log(p); dX = 0; dZ = sigma / zeta; }
      else {
        const pw = Math.pow(p, -xi);
        dS = (pw - 1) / xi;
        dX = -sigma / (xi * xi) * (pw - 1) - sigma / xi * pw * Math.log(p);
        dZ = sigma * pw / zeta;                   // d/dzeta of sigma/xi*(p^-xi) with p ∝ 1/zeta
      }
      const varL = dS * dS * vSig + dX * dX * vXi + 2 * dS * dX * cov + dZ * dZ * vZeta;
      const ex = xl - u, se = Math.sqrt(Math.max(0, varL));
      // log-scale band on the excess keeps the interval positive and right-skewed
      const g = ex > 0 ? Math.exp(1.96 * se / ex) : 1;
      return { x: xl, se, lo: u + ex / g, hi: u + ex * g, inTail: p <= 1 };
    }
    // spliced severity mean: empirical body + GPD tail
    let bodySum = 0; for (let i = 0; i < n - k; i++) bodySum += x[i];
    const tailMean = xi < 1 ? u + sigma / (1 - xi) : Infinity;
    const sevMean = (bodySum + k * tailMean) / n;
    const rl = level(1 / T);
    const q = level(1 - alpha);                    // single-loss quantile at 1 - (1-alpha)/lambda
    const corr = xi < 1 ? (lam - 1) * sevMean : 0;  // Böcker–Sprittulla mean correction
    const VaR = q.x + corr;
    const esSev = xi < 1 ? (q.x + sigma - xi * u) / (1 - xi) : Infinity;
    const ES = esSev + corr;
    const xmax = x[n - 1];
    const rpWorst = 1 / (lamU * gpdSf(xmax - u, xi, sigma));
    let meanExcess = 0; for (const t of y) meanExcess += t; meanExcess /= k;
    if (opts.profile) {
      const pr = 1 / T / lamU, pq = (1 - alpha) / lamU;
      if (pr < 1 && rl.x > u) { const ci = profileCI(y, u, pr, rl.x - u, fit.nll); rl.lo = ci[0]; rl.hi = ci[1]; rl.profile = true; }
      if (pq < 1 && q.x > u) { const ci = profileCI(y, u, pq, q.x - u, fit.nll); q.lo = ci[0]; q.hi = ci[1]; q.profile = true; }
    }
    return {
      n, k, u, Y, lam, lamU, zeta, xi, sigma, nll: fit.nll, seXi, xiLo: xi - 1.96 * seXi, xiHi: xi + 1.96 * seXi,
      rl, q, VaR, get VaRlo() { return q.lo + corr; }, get VaRhi() { return q.hi + corr; }, esSev, ES, sevMean, corr, tailMean,
      rpWorst, xmax, meanExcess, y,
      rate: z => z <= u ? null : lamU * gpdSf(z - u, xi, sigma)
    };
  }

  // whole-data normal and lognormal fits, with the same SLA mapping to annual VaR and ES
  function wholeFits(x, Y, T, alpha) {
    const n = x.length, lam = n / Y;
    let m = 0; for (const t of x) m += t; m /= n;
    let v = 0; for (const t of x) v += (t - m) * (t - m); const sd = Math.sqrt(v / (n - 1));
    let lm = 0; for (const t of x) lm += Math.log(t); lm /= n;
    let lv = 0; for (const t of x) lv += (Math.log(t) - lm) ** 2; const ls = Math.sqrt(lv / (n - 1));
    const xmax = x[n - 1];
    const pT = 1 / (T * lam), pA = (1 - alpha) / lam;
    // normal
    const zT = normInv(1 - pT), zA = normInv(1 - pA);
    const nq = m + sd * zA;
    const normal = {
      name: 'Normal', mu: m, sd, mean: m,
      rl: m + sd * zT,
      VaR: nq + (lam - 1) * m,
      ES: m + sd * normPdf(zA) / pA + (lam - 1) * m,
      rpWorst: 1 / (lam * normSf((xmax - m) / sd)),
      rate: z => lam * normSf((z - m) / sd)
    };
    const lmean = Math.exp(lm + ls * ls / 2);
    const lq = Math.exp(lm + ls * zA);
    const logn = {
      name: 'Lognormal', mu: lm, sd: ls, mean: lmean, median: Math.exp(lm),
      rl: Math.exp(lm + ls * zT),
      VaR: lq + (lam - 1) * lmean,
      ES: lmean * normSf(zA - ls) / pA + (lam - 1) * lmean,
      rpWorst: 1 / (lam * normSf((Math.log(xmax) - lm) / ls)),
      rate: z => lam * normSf((Math.log(z) - lm) / ls)
    };
    return { normal, logn, mean: m, sd, lam };
  }

  const EVT = { profileAt, profileCI, erfc, normSf, normInv, gpdNll, gpdSf, gpdIsf, fitGpd, analyze, wholeFits };
  if (typeof module !== 'undefined' && module.exports) module.exports = EVT;
  else root.EVT = EVT;
})(typeof window !== 'undefined' ? window : this);
