"""
HimUrja - training pipeline for the station load-forecasting model.

  1. Data   : ml/data/load_dataset.csv, produced by scripts/export-dataset.ts from the station
              digital twin (3 training years, 1 calibration year, 1 unseen test year per station).
  2. Model  : gradient-boosted regression trees (scikit-learn), one model shared by both
              stations (station is a feature -> transfer learning to Maitri-II later).
            NOTE: all rows are SIMULATED by the digital twin, so the metrics below measure how well the
            model learns the twin's demand process - not accuracy on real Maitri/Bharati meter data.
  3. Uncertainty: split-conformal prediction intervals (P10-P90) per lead-time bucket,
              calibrated on a held-out year - distribution-free coverage guarantee.
  4. Export : compact JSON (complete binary trees) executed in the browser / edge device
              with no Python runtime -> works fully offline at the station.

Run:  python3 ml/train.py
"""
import json
import time
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

FEATURES = ["station", "hour_sin", "hour_cos", "doy_sin", "doy_cos", "sunday", "crew", "temp_fc",
            "wind_fc", "darkness", "lag48", "lag168", "recent24", "lead", "blizzard_fc", "local_hour"]
DEPTH = 4
LEAD_BUCKETS = [(1, 6), (7, 24), (25, 48)]

df = pd.read_csv("ml/data/load_dataset.csv")
train, calib, test = (df[df.role == r] for r in ("train", "calib", "test"))
Xtr, ytr = train[FEATURES].values, train.target.values

t0 = time.time()
model = GradientBoostingRegressor(n_estimators=80, max_depth=DEPTH, learning_rate=0.15,
                                  subsample=0.8, min_samples_leaf=40, random_state=7)
model.fit(Xtr, ytr)
print(f"trained in {time.time() - t0:.1f}s on {len(train)} rows")


def mape(y, p):
    return float(np.mean(np.abs(y - p) / y) * 100)


def mae(y, p):
    return float(np.mean(np.abs(y - p)))


def rmse(y, p):
    return float(np.sqrt(np.mean((y - p) ** 2)))


# ---------- split-conformal intervals ----------
pc = model.predict(calib[FEATURES].values)
res = calib.target.values - pc
conformal = []
for lo, hi in LEAD_BUCKETS:
    m = (calib.lead.values >= lo) & (calib.lead.values <= hi)
    conformal.append({"lo": lo, "hi": hi,
                      "q10": float(np.quantile(res[m], 0.10)), "q90": float(np.quantile(res[m], 0.90)),
                      "q02": float(np.quantile(res[m], 0.025)), "q98": float(np.quantile(res[m], 0.975))})

# ---------- evaluation on the unseen year ----------
pt = model.predict(test[FEATURES].values)
yt = test.target.values
q10 = np.zeros_like(pt); q90 = np.zeros_like(pt)
for b in conformal:
    m = (test.lead.values >= b["lo"]) & (test.lead.values <= b["hi"])
    q10[m] = pt[m] + b["q10"]; q90[m] = pt[m] + b["q90"]
coverage = float(np.mean((yt >= q10) & (yt <= q90)) * 100)

metrics = {"data": "simulated - station digital twin (not measured station data)",
           "test_rows": int(len(test)), "coverage_80": round(coverage, 1), "stations": {}}
for sid, name in ((0, "maitri"), (1, "bharati")):
    m = test.station.values == sid
    y, p = yt[m], pt[m]
    e = y - p
    metrics["stations"][name] = {
        "mape_model": round(mape(y, p), 2),
        "mae_model": round(mae(y, p), 2),
        "rmse_model": round(rmse(y, p), 2),
        "bias_model": round(float(np.mean(e)), 2),
        "p95_abs_err": round(float(np.quantile(np.abs(e), 0.95)), 2),
        "mean_load": round(float(np.mean(y)), 1),
        "mae_seasonal_naive": round(mae(y, test.lag168.values[m]), 2),
        "rmse_seasonal_naive": round(rmse(y, test.lag168.values[m]), 2),
        "mape_seasonal_naive": round(mape(y, test.lag168.values[m]), 2),
        "mape_persistence48": round(mape(y, test.lag48.values[m]), 2),
        "mape_recent_mean": round(mape(y, test.recent24.values[m]), 2),
    }
by_lead = []
for lo, hi in LEAD_BUCKETS:
    m = (test.lead.values >= lo) & (test.lead.values <= hi)
    by_lead.append({"lead": f"{lo}-{hi} h", "mape": round(mape(yt[m], pt[m]), 2)})
metrics["by_lead"] = by_lead
# error distribution (actual - forecast, kW) on the unseen simulated year, both stations
edges = np.arange(-15, 15.01, 1.5)
err = yt - pt
counts, _ = np.histogram(np.clip(err, edges[0] + 1e-6, edges[-1] - 1e-6), bins=edges)
metrics["error_hist"] = {"edges": [round(float(x), 2) for x in edges], "counts": [int(c) for c in counts]}
imp = sorted(zip(FEATURES, model.feature_importances_), key=lambda t: -t[1])
metrics["importance"] = [{"feature": f, "value": round(float(v), 4)} for f, v in imp]
print(json.dumps(metrics, indent=1))


# ---------- export as complete binary trees (implicit BFS layout) ----------
def export_tree(tree):
    t = tree.tree_
    n_int = 2 ** DEPTH - 1
    feat = [0] * n_int
    thr = [0.0] * n_int
    leaves = [0.0] * (2 ** DEPTH)

    def fill(node, pos, depth):
        if depth == DEPTH:  # leaf slot
            leaves[pos - n_int] = float(t.value[node][0][0])
            return
        if t.children_left[node] == -1:  # early leaf -> always go left, replicate value
            feat[pos] = 0
            thr[pos] = 1e9
            fill(node, 2 * pos + 1, depth + 1)
            fill(node, 2 * pos + 2, depth + 1)
            return
        feat[pos] = int(t.feature[node])
        thr[pos] = float(t.threshold[node])
        fill(t.children_left[node], 2 * pos + 1, depth + 1)
        fill(t.children_right[node], 2 * pos + 2, depth + 1)

    fill(0, 0, 0)
    return [feat, [round(x, 3) if x < 1e29 else 1e9 for x in thr], [round(x, 3) for x in leaves]]


trees = [export_tree(est[0]) for est in model.estimators_]
init = float(model.init_.constant_[0][0]) if hasattr(model.init_, "constant_") else float(np.mean(ytr))
out = {"version": "himurja-load-gbt-1.0", "features": FEATURES, "depth": DEPTH,
       "lr": model.learning_rate, "init": round(init, 4), "trees": trees,
       "conformal": conformal, "metrics": metrics}

# verify exported model == sklearn model
def js_like_predict(x):
    s = out["init"]
    n_int = 2 ** DEPTH - 1
    for f, th, lv in trees:
        pos = 0
        for _ in range(DEPTH):
            pos = 2 * pos + 1 if x[f[pos]] <= th[pos] else 2 * pos + 2
        s += out["lr"] * lv[pos - n_int]
    return s

sample = test[FEATURES].values[:500]
dev = np.abs(np.array([js_like_predict(r) for r in sample]) - model.predict(sample))
print("export deviation (kW): mean", dev.mean(), "max", dev.max())
assert dev.mean() < 0.01

def c(x):
    return json.dumps(x, separators=(",", ":"))

lines = ["{"] + [f'"{k}":{c(v)},' for k, v in out.items() if k != "trees"] + ['"trees":[']
lines += [c(t) + ("," if i < len(trees) - 1 else "") for i, t in enumerate(trees)] + ["]}"]
with open("src/ai/model.json", "w") as f:
    f.write("\n".join(lines) + "\n")  # one tree per line: readable diffs
print("exported", len(trees), "trees")
