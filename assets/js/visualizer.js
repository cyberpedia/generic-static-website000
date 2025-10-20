(function () {
  if (window.Visualizer) return;

  class Visualizer {
    constructor(analyser, canvas) {
      this.analyser = analyser;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.style = 'bars';
      this.color1 = '#19d3ae';
      this.color2 = '#1e90ff';
      this.running = false;
      // visual options
      this.glow = true;
      this.trail = true;
      this.showArt = true;
      this.glowStrength = 12;
      this.trailAlpha = 0.08;

      // tunable params
      this.thickness = 1.0;   // global line thickness multiplier
      this.spikeScale = 1.0;  // circle spike length multiplier
      this.waveScale = 1.0;   // ring-wave amplitude multiplier
      this.ringFloor = 0.16;  // amplitude floor for circle visualization
      this.radialFloor = 0.16; // amplitude floor for radial bars
      this.beatSense = 1.0;   // beat sensitivity multiplier
      this.beatBoost = 1.0;   // beat pulse/particle boosting

      // motion and peak handling
      this.angle = 0;
      this.lastTS = 0;
      this.rotation = 0.6; // radians per second
      this.decay = 0.92;
      this.peaks = new Float32Array(this.analyser.frequencyBinCount);
      this.ampGain = 1;

      // coverage multiplier around the circle (ensure full 360° even with few bins)
      // Set to 1 to avoid duplicated arcs; we fill the circle by using more bins instead.
      this.segments = 1;

      // particles
      this.particles = [];
      this.maxParticles = 200;

      // album art
      this.artImage = null;

      // optional stereo analysers
      this.analyserL = null;
      this.analyserR = null;

      // progress arc (0..1)
      this.progress = 0;

      // emphasis gains (low/mid/high)
      this.lowGain = 1.0;
      this.midGain = 1.0;
      this.highGain = 1.0;
      // emphasis mode: 'flat' (no weighting) | 'weighted'
      this.emphasisMode = 'flat';

      // beat smoothing
      this.beatThreshold = 0.08;
      this.beatDecay = 0.90;
      this.beatLevel = 0;

      // beat/tempo controls
      this.beatSource = 'avg';
      this.beatHoldMs = 120;
      this.pulseWidth = 1.0;
      this.bpmEnabled = false;
      this.bpm = null;

      // Analyzer tuning for better dynamic range
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;

      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.freqFloat = new Float32Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.frequencyBinCount);

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setStyle(style) {
      this.style = style;
      if (this.stylePresetsOn) this.applyStylePresets();
    }

    setStylePresets(on) {
      this.stylePresetsOn = !!on;
      if (on) this.applyStylePresets();
    }

    applyStylePresets() {
      // Minimal per-style floors/scales
      const map = {
        circle:     { ringFloor: 0.18, spikeScale: 1.15, glowStrength: 12, trailAlpha: 0.0 },
        radial:     { radialFloor: 0.18, thickness: 1.2, glowStrength: 12, trailAlpha: 0.06 },
        ring:       { waveScale: 1.15, thickness: 1.3, glowStrength: 10, trailAlpha: 0.06 },
        bars:       { radialFloor: 0.14, thickness: 1.1, glowStrength: 8,  trailAlpha: 0.04 },
        mirror:     { radialFloor: 0.14, thickness: 1.1, glowStrength: 8,  trailAlpha: 0.04 },
        particles:  { glowStrength: 12, trailAlpha: 0.08 }
      };
      const p = map[this.style] || {};
      if (p.ringFloor !== undefined) this.setRingFloor(p.ringFloor);
      if (p.radialFloor !== undefined) this.setRadialFloor(p.radialFloor);
      if (p.spikeScale !== undefined) this.setSpikeScale(p.spikeScale);
      if (p.waveScale !== undefined) this.setWaveScale(p.waveScale);
      if (p.thickness !== undefined) this.setThickness(p.thickness);
      if (p.glowStrength !== undefined) this.setGlowStrength(p.glowStrength);
      if (p.trailAlpha !== undefined) this.setTrailAlpha(p.trailAlpha);
    }

    setPerformanceMode(on) {
      this.performance = !!on;
      this.maxParticles = this.performance ? 100 : 200;
    }

    bins(base) {
      return this.performance ? Math.max(24, Math.floor(base * 0.6)) : base;
    }

    setColors(c1, c2) {
      this.color1 = c1;
      this.color2 = c2;
    }

    setGlow(on) {
      this.glow = !!on;
    }

    setTrail(on) {
      this.trail = !!on;
    }

    setShowArt(on) {
      this.showArt = !!on;
    }

    setRotationSpeed(radPerSec) {
      this.rotation = Number(radPerSec) || this.rotation;
    }

    setGlowStrength(v) {
      this.glowStrength = Math.max(0, Number(v) || 0);
    }

    setTrailAlpha(v) {
      this.trailAlpha = Math.max(0, Math.min(0.5, Number(v) || 0));
    }

    setDecay(v) {
      const d = Number(v);
      if (d > 0 && d < 1) this.decay = d;
    }

    setThickness(v) {
      this.thickness = Math.max(0.5, Math.min(4, Number(v) || 1));
    }

    setSpikeScale(v) {
      this.spikeScale = Math.max(0.5, Math.min(2.5, Number(v) || 1));
    }

    setWaveScale(v) {
      this.waveScale = Math.max(0.5, Math.min(2.5, Number(v) || 1));
    }

    setRingFloor(v) {
      this.ringFloor = Math.max(0, Math.min(0.4, Number(v) || 0.16));
    }

    setRadialFloor(v) {
      this.radialFloor = Math.max(0, Math.min(0.4, Number(v) || 0.16));
    }

    setBeatSensitivity(v) {
      this.beatSense = Math.max(0.2, Math.min(2.5, Number(v) || 1));
    }

    setBeatBoost(v) {
      this.beatBoost = Math.max(0, Math.min(2.5, Number(v) || 1));
    }

    setBeatThreshold(v) {
      this.beatThreshold = Math.max(0, Math.min(0.6, Number(v) || 0.08));
    }

    setBeatDecay(v) {
      const d = Number(v);
      if (d > 0 && d < 1) this.beatDecay = d;
    }

    setEmphasis(low, mid, high) {
      this.lowGain = Math.max(0, Number(low) || 0);
      this.midGain = Math.max(0, Number(mid) || 0);
      this.highGain = Math.max(0, Number(high) || 0);
    }

    setEmphasisMode(mode) {
      const m = String(mode || '').toLowerCase();
      this.emphasisMode = m === 'weighted' ? 'weighted' : 'flat';
    }

    emphasisFactor(t) {
      // t in [0..1] position along spectrum
      if (this.emphasisMode !== 'weighted') return 1;
      const lowW = 1 - t;
      const midW = 1 - Math.abs(t - 0.5) * 2;
      const highW = t;
      const sumG = this.lowGain + this.midGain + this.highGain;
      const mix = sumG > 0 ? ((this.lowGain * lowW) + (this.midGain * midW) + (this.highGain * highW)) / sumG : 1;
      return 0.4 + 0.6 * mix;
    }

    setSmoothing(v) {
      const s = Math.max(0.5, Math.min(0.95, Number(v) || 0.75));
      this.analyser.smoothingTimeConstant = s;
      if (this.analyserL) this.analyserL.smoothingTimeConstant = s;
      if (this.analyserR) this.analyserR.smoothingTimeConstant = s;
    }

    setAlbumArt(url) {
      if (!url) {
        this.artImage = null;
        return;
      }
      const img = new Image();
      img.onload = () => { this.artImage = img; };
      img.src = url;
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        try {
          this.draw();
        } catch (err) {
          console.error('viz.draw error', err);
          try { if (window.BUG) BUG.error('viz.draw', err); } catch (_) {}
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
    }

    // Normalize dB value to 0..1
    norm(db) {
      const min = this.analyser.minDecibels;
      const max = this.analyser.maxDecibels;
      let v = (db - min) / (max - min);
      if (!isFinite(v)) v = 0;
      return Math.max(0, Math.min(1, v));
    }

    // Log-scale sampling across frequency bins for more energy in lows
    sampleIndex(i, bins, gamma = 2.0) {
      const t = i / (bins - 1);
      const l = this.freqFloat.length;
      return Math.min(l - 1, Math.floor(Math.pow(t, gamma) * (l - 1)));
    }

    setSegments(n) {
      const v = Number(n) || this.segments;
      this.segments = Math.max(1, Math.min(8, v));
    }

    getSpectrum(bins, gamma = 2.0, floorOverride = null) {
      this.analyser.getFloatFrequencyData(this.freqFloat);

      // peak for adaptive scaling
      let peak = 0;
      for (let i = 0; i < this.freqFloat.length; i++) {
        peak = Math.max(peak, this.norm(this.freqFloat[i]));
      }
      const gain = 1.0 / Math.max(0.35, peak + 0.05);

      const raw = new Array(bins).fill(0);
      for (let i = 0; i < bins; i++) {
        const idx = this.sampleIndex(i, bins, gamma);
        // local smoothing in frequency space
        let acc = 0, cnt = 0;
        for (let j = -3; j <= 3; j++) {
          const k = Math.max(0, Math.min(this.freqFloat.length - 1, idx + j));
          acc += this.norm(this.freqFloat[k]);
          cnt++;
        }
        let v = acc / cnt;

        // frequency emphasis (flat by default for uniform heights)
        const t = i / (bins - 1);
        const emphasis = this.emphasisFactor(t);
        v *= emphasis;

        // minimum floor so no dead zones
        const floor = floorOverride !== null ? floorOverride : 0.12;
        v = floor + v * (1 - floor);

        raw[i] = Math.pow(v, 1.08) * gain;
      }

      // angular smoothing to remove clumps (weighted 5-point kernel)
      const levels = new Array(bins).fill(0);
      const w0 = 1, w1 = 2, w2 = 3;
      const norm = w2 + w1 * 2 + w0 * 2; // 3 + 4 + 2 = 9
      for (let i = 0; i < bins; i++) {
        const i_2 = (i - 2 + bins) % bins;
        const i_1 = (i - 1 + bins) % bins;
        const i0 = i;
        const i1 = (i + 1) % bins;
        const i2 = (i + 2) % bins;
        levels[i] = (raw[i_2] * w0 + raw[i_1] * w1 + raw[i0] * w2 + raw[i1] * w1 + raw[i2] * w0) / norm;
      }

      // peak-hold per bin
      if (!this.barPeaks || this.barPeaks.length !== bins) {
        this.barPeaks = new Float32Array(bins);
      }
      for (let i = 0; i < bins; i++) {
        this.barPeaks[i] = Math.max(this.barPeaks[i] * this.decay, levels[i]);
      }
      return { levels, peaks: this.barPeaks, gain };
    }

    getTimeWave(bins) {
      // normalized time-domain amplitude for full-circle presence
      this.analyser.getByteTimeDomainData(this.timeData);
      const wave = new Array(bins).fill(0);
      const n = this.timeData.length;
      for (let i = 0; i < bins; i++) {
        const t = i / (bins - 1);
        const idx = Math.floor(t * (n - 1));
        // local smoothing
        let acc = 0, cnt = 0;
        for (let j = -3; j <= 3; j++) {
          const k = Math.max(0, Math.min(n - 1, idx + j));
          acc += Math.abs((this.timeData[k] - 128) / 128.0);
          cnt++;
        }
        wave[i] = (acc / cnt) * 0.85 + 0.08; // add small floor
      }
      // angular smoothing
      const sm = new Array(bins).fill(0);
      for (let i = 0; i < bins; i++) {
        const i0 = (i - 1 + bins) % bins;
        const i1 = i;
        const i2 = (i + 1) % bins;
        sm[i] = (wave[i0] + wave[i1] + wave[i2]) / 3;
      }
      return sm;
    }

    setStereoAnalysers(anL, anR) {
      this.analyserL = anL || null;
      this.analyserR = anR || null;
      if (this.analyserL) {
        this.analyserL.fftSize = 2048;
        this.analyserL.smoothingTimeConstant = 0.8;
        this.analyserL.minDecibels = -90;
        this.analyserL.maxDecibels = -10;
        this.freqFloatL = new Float32Array(this.analyserL.frequencyBinCount);
        this.timeDataL = new Uint8Array(this.analyserL.frequencyBinCount);
      }
      if (this.analyserR) {
        this.analyserR.fftSize = 2048;
        this.analyserR.smoothingTimeConstant = 0.8;
        this.analyserR.minDecibels = -90;
        this.analyserR.maxDecibels = -10;
        this.freqFloatR = new Float32Array(this.analyserR.frequencyBinCount);
        this.timeDataR = new Uint8Array(this.analyserR.frequencyBinCount);
      }
    }

    setProgress(p) {
      this.progress = Math.max(0, Math.min(1, Number(p) || 0));
    }

    getStereoSpectrum(bins, gamma = 1.0, floorOverride = null) {
      if (!this.analyserL || !this.analyserR) {
        const mono = this.getSpectrum(bins * 2, gamma, floorOverride);
        // split into halves
        const levelsL = mono.levels.slice(0, bins);
        const levelsR = mono.levels.slice(bins);
        const peaksL = mono.peaks.slice(0, bins);
        const peaksR = mono.peaks.slice(bins);
        return { levelsL, levelsR, peaksL, peaksR };
      }
      this.analyserL.getFloatFrequencyData(this.freqFloatL);
      this.analyserR.getFloatFrequencyData(this.freqFloatR);

      const compute = (arr) => {
        // peak for adaptive scaling
        let peak = 0;
        for (let i = 0; i < arr.length; i++) peak = Math.max(peak, this.norm(arr[i]));
        const gain = 1.0 / Math.max(0.35, peak + 0.05);

        const raw = new Array(bins).fill(0);
        for (let i = 0; i < bins; i++) {
          const idx = Math.min(arr.length - 1, Math.floor(Math.pow(i / (bins - 1), gamma) * (arr.length - 1)));
          // local smoothing
          let acc = 0, cnt = 0;
          for (let j = -3; j <= 3; j++) {
            const k = Math.max(0, Math.min(arr.length - 1, idx + j));
            // reuse norm formula using analyser params
            const vdb = (arr[k] - this.analyser.minDecibels) / (this.analyser.maxDecibels - this.analyser.minDecibels);
            acc += Math.max(0, Math.min(1, vdb));
            cnt++;
          }
          let v = acc / cnt;
          const t = i / (bins - 1);
          const emphasis = this.emphasisFactor(t);
          v *= emphasis;
          const floor = floorOverride !== null ? floorOverride : 0.12;
          v = floor + v * (1 - floor);
          raw[i] = Math.pow(v, 1.06) * gain;
        }
        // angular smoothing
        const levels = new Array(bins).fill(0);
        const w0 = 1, w1 = 2, w2 = 3;
        const norm = w2 + w1 * 2 + w0 * 2;
        for (let i = 0; i < bins; i++) {
          const i_2 = (i - 2 + bins) % bins;
          const i_1 = (i - 1 + bins) % bins;
          const i0 = i;
          const i1 = (i + 1) % bins;
          const i2 = (i + 2) % bins;
          levels[i] = (raw[i_2] * w0 + raw[i_1] * w1 + raw[i0] * w2 + raw[i1] * w1 + raw[i2] * w0) / norm;
        }
        return levels;
      };

      const levelsL = compute(this.freqFloatL);
      const levelsR = compute(this.freqFloatR);

      // peak-hold separately
      if (!this.barPeaksL || this.barPeaksL.length !== bins) this.barPeaksL = new Float32Array(bins);
      if (!this.barPeaksR || this.barPeaksR.length !== bins) this.barPeaksR = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        this.barPeaksL[i] = Math.max(this.barPeaksL[i] * this.decay, levelsL[i]);
        this.barPeaksR[i] = Math.max(this.barPeaksR[i] * this.decay, levelsR[i]);
      }

      return { levelsL, levelsR, peaksL: this.barPeaksL, peaksR: this.barPeaksR };
    }

    // --- Beat processing ----------------------------------------------------

    setBeatSource(src) {
      const s = String(src || 'avg').toLowerCase();
      this.beatSource = ['avg','low','mid','high'].includes(s) ? s : 'avg';
    }

    setBeatHoldMs(ms) {
      this.beatHoldMs = Math.max(0, Number(ms) || 0);
    }

    setPulseWidth(v) {
      this.pulseWidth = Math.max(0, Math.min(3, Number(v) || 1));
    }

    setBpmEnabled(on) {
      this.bpmEnabled = !!on;
    }

    getBeatEnergy() {
      // Use mono analyser for beat energy
      this.analyser.getFloatFrequencyData(this.freqFloat);
      // normalize and weight by selected source
      let sum = 0;
      let cnt = 0;
      const n = this.freqFloat.length;
      for (let i = 0; i < n; i++) {
        const v = this.norm(this.freqFloat[i]);
        const t = i / (n - 1);
        let w = 1;
        if (this.beatSource === 'low') w = 1 - t;
        else if (this.beatSource === 'mid') w = 1 - Math.abs(t - 0.5) * 2;
        else if (this.beatSource === 'high') w = t;
        sum += v * w;
        cnt++;
      }
      return cnt ? sum / cnt : 0;
    }

    updateBeat() {
      const now = performance.now();
      const energy = this.getBeatEnergy();

      // crossing detection (upward threshold crossing)
      const up = energy >= this.beatThreshold;
      if (up && !this._lastAbove) {
        this.beatHoldUntil = now + (this.beatHoldMs || 0);
        // record beat time for BPM
        if (!this.beatTimes) this.beatTimes = [];
        if (this._lastBeatTime) {
          const interval = (now - this._lastBeatTime) / 1000; // seconds
          if (interval > 0.25 && interval < 2.5) { // 24–240 BPM
            this.beatTimes.push(interval);
            if (this.beatTimes.length > 12) this.beatTimes.shift();
            // compute BPM from median of last intervals
            const arr = this.beatTimes.slice().sort((a,b)=>a-b);
            const mid = arr[Math.floor(arr.length/2)];
            this.bpm = Math.round(60 / mid);
          }
        }
        this._lastBeatTime = now;
      }
      this._lastAbove = up;

      // target level with thresholding and optional hold pulse
      let target = Math.max(0, energy - this.beatThreshold) * this.beatSense;
      if (this.beatHoldUntil && now < this.beatHoldUntil) {
        target = Math.max(target, 0.5); // sustain pulse while hold window active
      }
      this.beatLevel = this.beatLevel * this.beatDecay + target * (1 - this.beatDecay);
    }

    draw() {
      const { ctx, canvas } = this;
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);

      // Guard against zero-size canvas (mobile layout changes)
      if (w < 2 || h < 2) {
        this.resize();
        return;
      }

      // trail effect for select styles; circle keeps a crisp ring
      const trailStyles = new Set(['radial', 'ring', 'particles', 'bars', 'mirror', 'wave']);
      // advance rotation angle once per frame for all styles
      const now = performance.now();
      const dt = this.lastTS ? (now - this.lastTS) / 1000 : 0;
      this.lastTS = now;
      this.angle += this.rotation * dt;

      if (this.trail && trailStyles.has(this.style)) {
        ctx.fillStyle = `rgba(15,19,34,${this.trailAlpha})`;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      // update beat envelope (threshold/decay/hold/BPM)
      try { this.updateBeat(); } catch (_) {}

      // center art (draw under visualization)
      this.drawCenterArt(w, h);

      // glow
      ctx.shadowColor = this.glow ? this.color2 : 'transparent';
      ctx.shadowBlur = this.glow ? this.glowStrength : 0;

      const grad = API.gradient(ctx, this.color1, this.color2, w, h);
      ctx.fillStyle = grad;
      ctx.strokeStyle = grad;

      if (this.style === 'bars') this.drawBars(w, h);
      else if (this.style === 'wave') this.drawWave(w, h);
      else if (this.style === 'radial') this.drawRadialBars(w, h);
      else if (this.style === 'ring') this.drawRingWave(w, h);
      else if (this.style === 'mirror') this.drawMirrorBars(w, h);
      else if (this.style === 'particles') this.drawParticles(w, h);
      else this.drawCircle(w, h);

      // BPM overlay
      if (this.bpmEnabled && this.bpm) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${Math.max(12, Math.round(h * 0.06))}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(`BPM: ${this.bpm}`, 10, 22);
        ctx.restore();
      }
    }

    drawBars(w, h) {
      const bins = this.bins(96);
      const { peaks } = this.getSpectrum(bins, 2.0, this.radialFloor);
      const bw = w / bins;
      const width = Math.max(2, (bw - 4) * (0.75 + 0.25 * this.thickness)); // widen bars with thickness
      const gap = Math.max(2, (bw - width));
      for (let i = 0; i < bins; i++) {
        const v = peaks[i];
        const bh = v * h;
        const x = i * bw + (gap / 2);
        ctxRoundRect(this.ctx, x, h - bh, width, bh, 4);
        this.ctx.fill();
      }
    }

    drawWave(w, h) {
      const bins = this.bins(256);
      const wave = this.getTimeWave(bins);
      this.ctx.beginPath();
      for (let i = 0; i < bins; i++) {
        const x = (i / (bins - 1)) * w;
        const v = (wave[i] - 0.08) / 0.92; // re-center around 0
        const y = h / 2 + v * (h / 2) * 0.9 * this.waveScale;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.lineWidth = 2.0 * this.thickness;
      this.ctx.stroke();
    }

    drawRingWave(w, h) {
      // smoothed time-domain ring wave (rotation advanced in draw())

      const bins = this.bins(240);
      const wave = this.getTimeWave(bins);
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
      const scale = Math.min(h / 5, r * 0.75) * this.waveScale;

      this.ctx.beginPath();
      for (let i = 0; i < bins; i++) {
        const ang = (i / bins) * Math.PI * 2 + this.angle;
        const len = r + wave[i] * scale;
        const x = cx + Math.cos(ang) * len;
        const y = cy + Math.sin(ang) * len;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
      this.ctx.lineWidth = 2.6 * this.thickness;
      this.ctx.stroke();
    }

    drawMirrorBars(w, h) {
      // vertical bars mirrored top/bottom with smoothed spectrum
      const bins = this.bins(100);
      const { peaks } = this.getSpectrum(bins, 1.0, this.radialFloor);
      const bw = w / bins;
      const width = Math.max(2, (bw - 4) * (0.75 + 0.25 * this.thickness));
      const gap = Math.max(2, (bw - width));

      this.ctx.save();
      this.ctx.lineCap = 'round';

      for (let i = 0; i < bins; i++) {
        const v = peaks[i];
        const bh = v * (h / 2);
        const x = i * bw + (gap / 2);

        // gradient color along x
        const t = i / (bins - 1);
        this.ctx.fillStyle = lerpColor(this.color1, this.color2, t);

        // bottom bars
        ctxRoundRect(this.ctx, x, h - bh, width, bh, 4);
        this.ctx.fill();
        // top bars mirrored
        ctxRoundRect(this.ctx, x, 0, width, bh, 4);
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    drawRadialBars(w, h) {
      // frequency-domain radial bars using mono spectrum for full 360° uniform coverage
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;

      const bins = this.bins(180);
      const { peaks } = this.getSpectrum(bins, 1.0, this.radialFloor);

      // Beat ring using global beat level
      const pulse = Math.pow(Math.max(0, this.beatLevel), 1.2) * this.beatBoost;
      const beatRadius = r + pulse * (h / 16);
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, beatRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      this.ctx.lineWidth = (2.5 * this.thickness) * (1 + pulse * this.pulseWidth * 0.8);
      this.ctx.stroke();
      this.ctx.restore();

      this.ctx.save();
      this.ctx.lineCap = 'round';

      for (let i = 0; i < bins; i++) {
        const v = peaks[i];
        const ang = (i / bins) * Math.PI * 2 + this.angle;
        const len = r + Math.pow(v, 1.2) * (h / 3);
        const x0 = cx + Math.cos(ang) * r;
        const y0 = cy + Math.sin(ang) * r;
        const x1 = cx + Math.cos(ang) * len;
        const y1 = cy + Math.sin(ang) * len;

        const t = i / (bins - 1);
        this.ctx.strokeStyle = lerpColor(this.color1, this.color2, t);
        this.ctx.lineWidth = (2.2 + v * 3.6) * this.thickness;

        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.stroke();

        // cap dot
        this.ctx.beginPath();
        this.ctx.arc(x1, y1, (2.0 + v * 2.6) * this.thickness, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(255,255,255,0.85)';
        this.ctx.fill();
      }

      this.ctx.restore();

      // progress arc overlay
      if (this.progress > 0) {
        const start = -Math.PI / 2;
        const end = start + this.progress * Math.PI * 2;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r + 1.5, start, end);
        this.ctx.lineWidth = 3.4 * this.thickness;
        this.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    drawCircle(w, h) {
      // base ring + uniform amplitude spikes around full 360° using mono spectrum
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;

      // draw a continuous base ring (no dots) for perfect circle
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
      this.ctx.lineWidth = 3.2 * this.thickness;
      this.ctx.stroke();
      this.ctx.restore();

      const bins = this.bins(180);
      const { peaks } = this.getSpectrum(bins, 1.0, this.ringFloor);
      const spikeScale = Math.min(h / 4, r * 0.65) * this.spikeScale;

      for (let i = 0; i < bins; i++) {
        const v = peaks[i];
        const ang = (i / bins) * Math.PI * 2 + this.angle;
        const len = r + Math.pow(v, 1.10) * spikeScale;
        const x0 = cx + Math.cos(ang) * r;
        const y0 = cy + Math.sin(ang) * r;
        const x1 = cx + Math.cos(ang) * len;
        const y1 = cy + Math.sin(ang) * len;

        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.lineWidth = (1.8 + v * 2.0) * this.thickness;
        this.ctx.stroke();
      }

      // progress arc overlay (12 o'clock start, clockwise)
      if (this.progress > 0) {
        const start = -Math.PI / 2;
        const end = start + this.progress * Math.PI * 2;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r + 1.5, start, end);
        this.ctx.lineWidth = 3.4 * this.thickness;
        this.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    drawParticles(w, h) {
      // particle orbit around ring with beat-driven spawning using global beat level
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
      const pulse = Math.max(0, this.beatLevel) * this.beatBoost;
      const spawn = Math.min(8, Math.floor(pulse * 12));
      for (let s = 0; s < spawn; s++) {
        if (this.particles.length < this.maxParticles) {
          this.particles.push({
            theta: Math.random() * Math.PI * 2,
            radius: r + Math.random() * (h / 3) * 0.5,
            speed: 0.6 + Math.random() * 1.2,
            life: 1.0
          });
        }
      }
      // update and draw
      const next = [];
      const sizeScale = 1 + 0.4 * (this.thickness - 1);
      this.ctx.save();
      for (const p of this.particles) {
        p.theta += p.speed * 0.02;
        p.life *= 0.985;
        if (p.life < 0.08) continue;
        const x = cx + Math.cos(p.theta) * p.radius;
        const y = cy + Math.sin(p.theta) * p.radius;
        this.ctx.beginPath();
        this.ctx.arc(x, y, (2 + (1 - p.life) * 3) * sizeScale, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(255,255,255,${0.2 + p.life * 0.6})`;
        this.ctx.fill();
        next.push(p);
      }
      this.ctx.restore();
      this.particles = next;
    }

    drawCenterArt(w, h) {
      if (!this.showArt || !this.artImage) return;
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3 * 0.62;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
      this.ctx.closePath();
      this.ctx.clip();
      this.ctx.drawImage(this.artImage, cx - r, cy - r, r * 2, r * 2);
      this.ctx.restore();
    }
  }

  function lerpColor(c1, c2, t) {
    function hexToRgb(h) {
      const s = h.replace('#', '');
      const full = s.length === 3 ? s.split('').map(x => x + x).join('') : s;
      const n = parseInt(full, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const a = hexToRgb(c1), b = hexToRgb(c2);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const b2 = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${b2})`;
  }

  function ctxRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.Visualizer = Visualizer;
})();