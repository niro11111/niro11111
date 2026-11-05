// A small, dependency-free neural-network library for on-device learning.
//  * Multi-layer perceptron: dense layers, ReLU hidden activations, softmax output, cross-entropy.
//  * Adam optimizer, mini-batches, L2 weight decay, inverted dropout, early stopping on a
//    validation split, seeded initialization (He) and shuffling, so training is reproducible.
//  * Sparse inputs: hashed text features are mostly zeros, so the first layer only touches
//    non-zero inputs (fast enough to train in the browser in well under a second).
// Everything runs locally: training data never leaves the device, and the stored weights
// contain hashed feature indices only (no raw text).

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const gauss = (r) => { let u = 0; let v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** Sparse vector: { idx: Int32Array|number[], val: Float32Array|number[] } or a dense array. */
export const toSparse = (dense) => { const idx = []; const val = []; dense.forEach((v, i) => { if (v) { idx.push(i); val.push(v); } }); return { idx, val }; };

export class MLP {
  /** @param {number[]} sizes e.g. [inputDim, 64, nClasses] */
  constructor(sizes, { seed = 7 } = {}) {
    this.sizes = sizes;
    const r = rng(seed);
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const [n, m] = [sizes[l], sizes[l + 1]];
      const scale = Math.sqrt(2 / n);
      const w = new Float32Array(n * m);
      for (let i = 0; i < w.length; i++) w[i] = gauss(r) * scale;
      this.W.push(w); this.b.push(new Float32Array(m));
    }
  }

  /** Forward pass. x: sparse {idx,val} or dense array. Returns activations per layer. */
  forward(x, { train = false, dropout = 0, r = null } = {}) {
    const acts = []; const masks = [];
    let a = null;
    for (let l = 0; l < this.W.length; l++) {
      const m = this.sizes[l + 1]; const W = this.W[l]; const out = new Float32Array(this.b[l]);
      if (l === 0 && x.idx) { for (let k = 0; k < x.idx.length; k++) { const i = x.idx[k]; const v = x.val[k]; const row = i * m; for (let j = 0; j < m; j++) out[j] += v * W[row + j]; } }
      else { const inp = l === 0 ? x : a; for (let i = 0; i < inp.length; i++) { const v = inp[i]; if (!v) continue; const row = i * m; for (let j = 0; j < m; j++) out[j] += v * W[row + j]; } }
      if (l < this.W.length - 1) {
        let mask = null;
        if (train && dropout > 0) mask = new Uint8Array(m);
        for (let j = 0; j < m; j++) {
          out[j] = out[j] > 0 ? out[j] : 0;
          if (mask) { if (r() < dropout) out[j] = 0; else { mask[j] = 1; out[j] /= 1 - dropout; } }
        }
        masks.push(mask);
      } else {
        let mx = -Infinity; for (const v of out) mx = Math.max(mx, v);
        let sum = 0; for (let j = 0; j < m; j++) { out[j] = Math.exp(out[j] - mx); sum += out[j]; }
        for (let j = 0; j < m; j++) out[j] /= sum;
      }
      acts.push(out); a = out;
    }
    return { acts, masks };
  }
  predict(x) { return Array.from(this.forward(x).acts.at(-1)); }

  /**
   * @param {{x:any, y:number}[]} data
   * @returns training history (loss/accuracy per epoch) and the best validation epoch
   */
  fit(data, { epochs = 40, lr = 0.01, batch = 16, l2 = 1e-4, dropout = 0.1, valSplit = 0.15, patience = 6, seed = 7, classWeights = null, onEpoch = null } = {}) {
    const r = rng(seed + 1);
    const idx = data.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    // Stratified-ish split: every class keeps at least one training example.
    const nVal = valSplit > 0 ? Math.max(1, Math.floor(idx.length * valSplit)) : 0;
    const seenTrain = new Set(); const val = []; const train = [];
    for (const i of idx) { const y = data[i].y; if (val.length < nVal && seenTrain.has(y)) val.push(data[i]); else { train.push(data[i]); seenTrain.add(y); } }
    const L = this.W.length;
    const mW = this.W.map((w) => new Float32Array(w.length)); const vW = this.W.map((w) => new Float32Array(w.length));
    const mB = this.b.map((b) => new Float32Array(b.length)); const vB = this.b.map((b) => new Float32Array(b.length));
    const b1 = 0.9; const b2 = 0.999; let t = 0;
    const history = []; let best = { loss: Infinity, epoch: -1, W: null, b: null }; let bad = 0;
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
      let lossSum = 0; let correct = 0;
      for (let s0 = 0; s0 < train.length; s0 += batch) {
        const gW = this.W.map((w) => new Float32Array(w.length)); const gB = this.b.map((b) => new Float32Array(b.length));
        const chunk = train.slice(s0, s0 + batch);
        for (const ex of chunk) {
          const { acts, masks } = this.forward(ex.x, { train: true, dropout, r });
          const out = acts.at(-1);
          const cw = classWeights?.[ex.y] ?? 1;
          lossSum += -Math.log(Math.max(1e-9, out[ex.y])) * cw;
          if (out.indexOf(Math.max(...out)) === ex.y) correct++;
          let delta = Float32Array.from(out); delta[ex.y] -= 1; for (let j = 0; j < delta.length; j++) delta[j] *= cw;
          for (let l = L - 1; l >= 0; l--) {
            const m = this.sizes[l + 1]; const W = this.W[l];
            for (let j = 0; j < m; j++) gB[l][j] += delta[j];
            const inp = l === 0 ? ex.x : acts[l - 1];
            let prevDelta = null;
            if (l > 0) prevDelta = new Float32Array(this.sizes[l]);
            if (l === 0 && inp.idx) {
              for (let k = 0; k < inp.idx.length; k++) { const i = inp.idx[k]; const v = inp.val[k]; const row = i * m; for (let j = 0; j < m; j++) gW[0][row + j] += v * delta[j]; }
            } else {
              for (let i = 0; i < inp.length; i++) {
                const v = inp[i]; const row = i * m;
                if (v) for (let j = 0; j < m; j++) gW[l][row + j] += v * delta[j];
                if (prevDelta) { let s = 0; for (let j = 0; j < m; j++) s += W[row + j] * delta[j]; prevDelta[i] = s; }
              }
            }
            if (prevDelta) {
              const a = acts[l - 1]; const mask = masks[l - 1];
              for (let i = 0; i < prevDelta.length; i++) { if (a[i] <= 0 || (mask && !mask[i])) prevDelta[i] = 0; else if (mask) prevDelta[i] /= 1 - dropout; }
              delta = prevDelta;
            }
          }
        }
        // Adam update (only rows that received gradient are non-zero; weight decay on all).
        t++;
        const n = chunk.length; const c1 = 1 - b1 ** t; const c2 = 1 - b2 ** t;
        for (let l = 0; l < L; l++) {
          const W = this.W[l]; const g = gW[l]; const m1 = mW[l]; const v1 = vW[l];
          for (let i = 0; i < W.length; i++) {
            const gi = g[i] / n + l2 * W[i];
            if (gi === 0) continue;
            m1[i] = b1 * m1[i] + (1 - b1) * gi; v1[i] = b2 * v1[i] + (1 - b2) * gi * gi;
            W[i] -= (lr * (m1[i] / c1)) / (Math.sqrt(v1[i] / c2) + 1e-8);
          }
          const bb = this.b[l]; const gb = gB[l]; const mb = mB[l]; const vb = vB[l];
          for (let j = 0; j < bb.length; j++) { const gj = gb[j] / n; mb[j] = b1 * mb[j] + (1 - b1) * gj; vb[j] = b2 * vb[j] + (1 - b2) * gj * gj; bb[j] -= (lr * (mb[j] / c1)) / (Math.sqrt(vb[j] / c2) + 1e-8); }
        }
      }
      const valEval = val.length ? this.evaluate(val) : null;
      const rec = { epoch: ep + 1, loss: +(lossSum / train.length).toFixed(4), accuracy: +(correct / train.length).toFixed(4), valLoss: valEval?.loss ?? null, valAccuracy: valEval?.accuracy ?? null };
      history.push(rec); onEpoch?.(rec);
      const monitor = valEval ? valEval.loss : rec.loss;
      if (monitor < best.loss - 1e-4) { best = { loss: monitor, epoch: ep + 1, W: this.W.map((w) => Float32Array.from(w)), b: this.b.map((b) => Float32Array.from(b)) }; bad = 0; }
      else if (++bad >= patience) break; // early stopping
    }
    if (best.W) { this.W = best.W; this.b = best.b; }
    return { history, bestEpoch: best.epoch, trainSize: train.length, valSize: val.length, val };
  }

  evaluate(data) {
    let loss = 0; let correct = 0;
    for (const ex of data) { const p = this.predict(ex.x); loss += -Math.log(Math.max(1e-9, p[ex.y])); if (p.indexOf(Math.max(...p)) === ex.y) correct++; }
    return { loss: +(loss / data.length).toFixed(4), accuracy: +(correct / data.length).toFixed(4) };
  }

  toJSON() { return { sizes: this.sizes, W: this.W.map((w) => Array.from(w, (x) => +x.toFixed(5))), b: this.b.map((b) => Array.from(b, (x) => +x.toFixed(5))) }; }
  static fromJSON(j) { const m = new MLP(j.sizes, { seed: 1 }); m.W = j.W.map((w) => Float32Array.from(w)); m.b = j.b.map((b) => Float32Array.from(b)); return m; }
}

/** Confusion matrix, per-class precision/recall/F1 and macro-F1. */
export function classificationReport(yTrue, yPred, labels) {
  const k = labels.length;
  const cm = Array.from({ length: k }, () => new Array(k).fill(0));
  yTrue.forEach((t, i) => { cm[t][yPred[i]]++; });
  const perClass = labels.map((label, c) => {
    const tp = cm[c][c]; const fp = cm.reduce((a, row, r) => a + (r !== c ? row[c] : 0), 0); const fn = cm[c].reduce((a, v, j) => a + (j !== c ? v : 0), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fn ? tp / (tp + fn) : 0;
    return { label, support: tp + fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: precision + recall ? +((2 * precision * recall) / (precision + recall)).toFixed(3) : 0 };
  });
  const present = perClass.filter((c) => c.support > 0);
  return { accuracy: yTrue.length ? +(yTrue.filter((t, i) => t === yPred[i]).length / yTrue.length).toFixed(4) : null, macroF1: present.length ? +(present.reduce((a, c) => a + c.f1, 0) / present.length).toFixed(4) : null, perClass, confusion: cm };
}

/** Expected calibration error: does "90% confident" mean right 90% of the time? */
export function calibration(probs, correct, bins = 5) {
  const B = Array.from({ length: bins }, () => ({ n: 0, conf: 0, acc: 0 }));
  probs.forEach((p, i) => { const b = Math.min(bins - 1, Math.floor(p * bins)); B[b].n++; B[b].conf += p; B[b].acc += correct[i] ? 1 : 0; });
  const n = probs.length || 1;
  const ece = B.reduce((a, b) => a + (b.n ? (b.n / n) * Math.abs(b.acc / b.n - b.conf / b.n) : 0), 0);
  return { ece: +ece.toFixed(4), bins: B.map((b, i) => ({ range: [i / bins, (i + 1) / bins], n: b.n, confidence: b.n ? +(b.conf / b.n).toFixed(3) : null, accuracy: b.n ? +(b.acc / b.n).toFixed(3) : null })) };
}
