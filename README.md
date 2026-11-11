# Extreme Value Theory Tail Risk Explorer

An interactive app for learning tail risk with extreme value theory. It asks a question risk committees actually face: "Our worst operational loss in 10 years was $8M. What does a 1-in-200-year loss look like?" The app fits a Generalized Pareto distribution (GPD) to the largest losses using peaks-over-threshold. It then compares that tail fit with normal and lognormal fits to the whole dataset, and lets you move the threshold to see how unstable tail estimates really are.

The app is a teaching tool, not an operational-risk capital model. It favors clear, visible math over production features.

**Live app:** https://seeking-eureka.com/extreme-value-theory-tail-risk-explorer/

**User guide:** click **User Guide** in the app, or go straight to it at https://seeking-eureka.com/extreme-value-theory-tail-risk-explorer/#guide

## What the App Shows

The Simulator tab shows four results at the current threshold:

1. **Shape ξ**: the GPD tail index, with a 95% range and a badge for how heavy the tail is.
2. **99.9% annual VaR**: the yearly total loss exceeded once in 1,000 years, with a 95% profile-likelihood range.
3. **Expected Shortfall**: the average of the years worse than VaR. It's shown as infinite when ξ ≥ 1.
4. **Tail points**: how many losses sit above the threshold, with a warning below 30.

A wide card shows the 1-in-200-year loss under the GPD, the lognormal, and the normal, along with how often each model says the worst observed loss should recur.

Other panels include a fit-stability verdict, a step-by-step breakdown of the calculation, a log-log tail plot (data, current GPD fit, the GPD at the other thresholds, and the whole-data fits), a threshold-stability chart (ξ, 1-in-T loss, VaR, or mean excess against the threshold), a model comparison chart, and a threshold log.

The Guide & Math tab walks through the method. Its worked examples update live from whatever values you enter.

## The Model

| Piece | Specification |
|---|---|
| Data | Individual losses at or above a reporting floor, over Y years |
| Threshold u | The (k+1)-th largest loss; the top k losses form the tail |
| Tail model | Excesses y = x − u ~ GPD(ξ, σ), P(Y > y) = (1 + ξy/σ)^(−1/ξ) |
| Fit | Maximum likelihood, Nelder–Mead on (ξ, ln σ) |
| Tail rate | λᵤ = k / Y tail losses a year; λ = n / Y losses a year in total |
| 1-in-T loss | x_T = u + (σ/ξ)[(T·λᵤ)^ξ − 1] |
| Annual VaR at α | Single-loss approximation with mean correction: q + (λ − 1)μ, where q = u + (σ/ξ)[(λᵤ/(1 − α))^ξ − 1] |
| Expected Shortfall | (q + σ − ξu)/(1 − ξ) + (λ − 1)μ, for ξ < 1; infinite otherwise |
| Comparison fits | Normal and lognormal fitted to all n losses, with the same mapping to VaR and ES |

**Uncertainty.** The 95% range on ξ uses the expected-information standard error (1 + ξ)/√k. The ranges on the 1-in-T loss and VaR are profile-likelihood intervals: the likelihood is re-maximized with the level held fixed, and the interval keeps every level within χ²₁(0.95)/2 of the maximum. They're lopsided on purpose, because the data can rule out a thin tail much more easily than a fat one.

**Mean correction.** μ is the spliced severity mean: the actual losses below u, plus the GPD mean u + σ/(1 − ξ) above it. When ξ ≥ 1 the mean doesn't exist, so the correction is dropped.

**Thresholds.** The stepper uses ten thresholds that leave 50%, 40%, 30%, 25%, 20%, 15%, 12.5%, 10%, 7.5%, and 5% of the losses in the tail. A fine slider reaches every k in between. The fit flag is Stable when the 95% range on ξ is ±0.3 or less, Sensitive at ±0.5 or less, and Unstable otherwise.

**Check.** On the default data at the top 25%, a 2-million-year Monte Carlo simulation of the spliced model gave a 99.9% VaR of $38.7M and an ES of $73.3M, against $38.3M and $73.8M from the formulas.

## Using the App

- Edit the loss log row by row (date, event type, amount), add or delete losses, and sort by date or size.
- Paste your own losses to replace the log: one per line, either a bare amount or date, event type, and amount, as copied from a spreadsheet. Plain numbers can be read as dollars or $K, and suffixes such as 1.5M or 300K always work. When every line has a date, the years of data are set from the dates. Nothing leaves the browser.
- Set the years of data, the reporting floor, the return period, and the VaR confidence level.
- Step through the thresholds with the arrows or press Play. Use the fine slider for any threshold in between, or click a row in the threshold log or a point on the stability chart.

**Default data.** 200 synthetic losses of $25K or more from 2016 to 2025 at a fictional mid-size buy-side firm, across five event types: trade error, NAV/pricing error, reconciliation break, vendor/settlement failure, and unauthorized trading. The largest is an $8.0M unauthorized-trading loss. The defaults are 10 years, a $25K floor, a 200-year return period, 99.9% confidence, and the top 25% (50 losses above $172K) in the tail.

At the default threshold, ξ is 0.51 (95% range 0.09 to 0.93), and the 1-in-200-year loss is $14.9M (95% range $4.6M to $182M). The 99.9% VaR is $38.3M and the ES is $73.8M. The lognormal puts the 1-in-200-year loss at $3.4M and the normal at $2.5M. The lognormal says the $8M loss should recur once every 6,780 years, against about 61 years under the GPD. Across the ten thresholds, the 1-in-200-year loss ranges from $14.9M to $110M.

**Input rules:**

- The log needs at least 30 losses at or above the reporting floor, and up to 2,000. Each loss must be above 0.
- Years of data runs from 1 to 100. Fewer than 5 years gets a soft warning.
- The return period runs from 2 to 10,000 years, and the confidence level from 90% to 99.99%.
- The threshold always leaves between 5% and 50% of the losses in the tail, and never fewer than 8 points.
- If the return period or confidence level asks for a loss below the threshold, the app warns you, because the tail model doesn't cover that range.

## Running Locally

There's no build step and nothing to install. Clone the repo and open `index.html` in a browser.

```
index.html    page structure and static guide content
styles.css    dark theme and layout
assets/       Seeking Eureka logo and favicon
data.js       the default synthetic loss log
evt.js        statistics engine: GPD maximum likelihood, profile likelihood, return levels, VaR and ES, normal and lognormal fits
app.js        loss log editing, paste parser, threshold stepper, SVG charts, and dynamic guide text
preview.png   link-preview image
UserGuide.md  plain-English user guide (source for the in-app User Guide panel)
userguide.js  renders UserGuide.md in a slide-over panel; opens on #guide
userguide.css styles for the User Guide panel
```

To update the in-app guide, edit `UserGuide.md` and push. The panel reads that file directly, so there's no HTML copy to keep in sync. The panel loads the guide with `fetch`, so it needs the app served over HTTP (GitHub Pages, or `python3 -m http.server` locally). If you open `index.html` straight from disk, the panel shows a link to the guide on GitHub instead.

The app is plain JavaScript with hand-drawn SVG charts and no third-party libraries. Fonts load from Google Fonts. Without a connection, the browser falls back to system fonts.

## Sources and Credits

**Extreme value theory**

- A. A. Balkema and L. de Haan (1974), ["Residual Life Time at Great Age,"](https://doi.org/10.1214/aop/1176996548) Annals of Probability 2(5): 792–804.
- James Pickands III (1975), ["Statistical Inference Using Extreme Order Statistics,"](https://doi.org/10.1214/aos/1176343003) Annals of Statistics 3(1): 119–131.
- A. C. Davison and R. L. Smith (1990), ["Models for Exceedances over High Thresholds,"](https://doi.org/10.1111/j.2517-6161.1990.tb01796.x) Journal of the Royal Statistical Society, Series B 52(3): 393–442.
- Stuart Coles (2001), [An Introduction to Statistical Modeling of Extreme Values](https://doi.org/10.1007/978-1-4471-3675-0), Springer. Threshold choice, mean excess and stability plots, return levels, and profile-likelihood intervals.
- Paul Embrechts, Claudia Klüppelberg, and Thomas Mikosch (1997), [Modelling Extremal Events for Insurance and Finance](https://doi.org/10.1007/978-3-642-33483-2), Springer.
- Alexander J. McNeil, Rüdiger Frey, and Paul Embrechts (2015), [Quantitative Risk Management, revised ed.](https://press.princeton.edu/books/hardcover/9780691166278/quantitative-risk-management), Princeton University Press.

**Operational risk**

- Marco Moscadelli (2004), ["The Modelling of Operational Risk: Experience with the Analysis of the Data Collected by the Basel Committee,"](https://www.bancaditalia.it/pubblicazioni/temi-discussione/2004/2004-0517/tema_517.pdf) Banca d'Italia, Temi di discussione 517.
- Klaus Böcker and Claudia Klüppelberg (2005), ["Operational VaR: A Closed-Form Approximation,"](https://www.risk.net/risk-management/operational-risk/1508755/operational-risk-operational-var-closed-form-approximation) Risk 18(12): 90–93.
- Klaus Böcker and Jacob Sprittulla (2006), ["Operational VAR: Meaningful Means"](https://mediatum.ub.tum.de/doc/1072585/1072585.pdf). The mean correction.
- Klaus Böcker (2006), ["Operational Risk: Analytical Results When High-Severity Losses Follow a Generalized Pareto Distribution (GPD) – A Note,"](https://www.risk.net/journal-of-risk/2161039/operational-risk-analytical-results-when-high-severity-losses-follow-a-generalized-pareto-distribution-gpd-a-note) Journal of Risk 8(4): 117–120.
- Basel Committee on Banking Supervision, [OPE25: Standardised Approach](https://www.bis.org/committees/bcbs/basel-framework/standard/ope/25/inforce/2023-01-01/published/2024-07-05).

**Fonts:** [Inter](https://fonts.google.com/specimen/Inter) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono), used under the SIL Open Font License.

## Disclaimer

- The default loss log is synthetic and doesn't represent any real firm, incident, or loss history.
- This project isn't affiliated with or endorsed by any author or organization cited above.
- It's an educational tool, not a capital model, and not investment, insurance, or regulatory advice.

## Author

Patrick Lefler · Seeking Eureka

## License

MIT. See `LICENSE`.
