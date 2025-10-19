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

    // motion and peak handling
    this.angle = 0;
    this.lastTS = 0;
    this.rotation = 0.6; // radians per second
    this.decay = 0.92;
    this.peaks = new Float32Array(this.analyser.frequencyBinCount);
    this.ampGain = 1;

    // particles
    this.particles = [];
    this.maxParticles = 200;

    // album art
    this.artImage = null;

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
      this.draw();
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

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);

    // trail effect for circle/radial styles
    const trailStyles = new Set(['circle', 'radial', 'ring', 'particles']);
    if (this.trail && trailStyles.has(this.style)) {
      ctx.fillStyle = 'rgba(15,19,34,0.08)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    // center art (draw under visualization)
    this.drawCenterArt(w, h);

    // glow
    ctx.shadowColor = this.glow ? this.color2 : 'transparent';
    ctx.shadowBlur = this.glow ? 12 : 0;

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
  }

  drawBars(w, h) {
    this.analyser.getFloatFrequencyData(this.freqFloat);
    // Compute peak to adapt bar scaling
    let peak = 0;
    for (let i = 0; i < this.freqFloat.length; i++) {
      const v = this.norm(this.freqFloat[i]);
      if (v > peak) peak = v;
    }
    const gain = 1.0 / Math.max(0.35, peak + 0.05);

    const bins = 96;
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const idx = this.sampleIndex(i, bins, 2.0);
      const v = this.norm(this.freqFloat[idx]);
      const bh = Math.pow(v, 1.2) * h * gain; // adaptive scaling
      ctxRoundRect(this.ctx, i * bw + 2, h - bh, bw - 4, bh, 4);
      this.ctx.fill();
    }
  }

  drawWave(w, h) {
    this.analyser.getByteTimeDomainData(this.timeData);
    this.ctx.beginPath();
    for (let i = 0; i < this.timeData.length; i++) {
      const x = (i / (this.timeData.length - 1)) * w;
      const v = (this.timeData[i] - 128) / 128.0;
      const y = h / 2 + v * (h / 2) * 0.9;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  drawRingWave(w, h) {
    // time-domain continuous ring wave
    const now = performance.now();
    const dt = this.lastTS ? (now - this.lastTS) / 1000 : 0;
    this.lastTS = now;
    this.angle += this.rotation * dt;

    this.analyser.getByteTimeDomainData(this.timeData);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
    const n = this.timeData.length;

    this.ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.angle;
      const v = (this.timeData[i] - 128) / 128.0;
      const len = r + v * (h / 4);
      const x = cx + Math.cos(ang) * len;
      const y = cy + Math.sin(ang) * len;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
  }

  drawMirrorBars(w, h) {
    // vertical bars mirrored top/bottom
    this.analyser.getFloatFrequencyData(this.freqFloat);
    let peak = 0;
    for (let i = 0; i < this.freqFloat.length; i++) peak = Math.max(peak, this.norm(this.freqFloat[i]));
    const gain = 1.0 / Math.max(0.35, peak + 0.05);

    const bins = 64;
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const idx = this.sampleIndex(i, bins, 2.0);
      const v = this.norm(this.freqFloat[idx]);
      const bh = Math.pow(v, 1.2) * (h / 2) * gain;
      // bottom bars
      ctxRoundRect(this.ctx, i * bw + 2, h - bh, bw - 4, bh, 4);
      this.ctx.fill();
      // top bars mirrored
      ctxRoundRect(this.ctx, i * bw + 2, 0, bw - 4, bh, 4);
      this.ctx.fill();
    }
  }

  drawRadialBars(w, h) {
    // frequency-domain radial bars with rotation and peak decay
    const now = performance.now();
    const dt = this.lastTS ? (now - this.lastTS) / 1000 : 0;
    this.lastTS = now;
    this.angle += this.rotation * dt;

    this.analyser.getFloatFrequencyData(this.freqFloat);

    let peak = 0, avg = 0;
    for (let i = 0; i < this.freqFloat.length; i++) {
      const v = this.norm(this.freqFloat[i]);
      if (v > peak) peak = v;
      avg += v;
    }
    avg /= this.freqFloat.length;
    const gain = 1.0 / Math.max(0.35, peak + 0.05);

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
    const bins = 96;

    // Beat ring pulse
    const beatRadius = r + Math.pow(avg, 1.2) * (h / 12);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, beatRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.save();
    this.ctx.lineCap = 'round';

    for (let i = 0; i < bins; i++) {
      const idx = this.sampleIndex(i, bins, 2.0);
      const v = this.norm(this.freqFloat[idx]);
      // peak hold with decay
      this.peaks[idx] = Math.max(this.peaks[idx] * this.decay, v);
      const pv = this.peaks[idx];

      const angle = (i / bins) * Math.PI * 2 + this.angle;
      const len = r + Math.pow(pv, 1.25) * (h / 3) * gain;
      const x0 = cx + Math.cos(angle) * r;
      const y0 = cy + Math.sin(angle) * r;
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;

      // color along angle
      const t = i / (bins - 1);
      this.ctx.strokeStyle = lerpColor(this.color1, this.color2, t);
      this.ctx.lineWidth = 2.5 + pv * 4;

      // bar
      this.ctx.beginPath();
      this.ctx.moveTo(x0, y0);
      this.ctx.lineTo(x1, y1);
      this.ctx.stroke();

      // peak marker dot
      const px = cx + Math.cos(angle) * (r + Math.pow(pv, 1.25) * (h / 3) * gain + 4);
      const py = cy + Math.sin(angle) * (r + Math.pow(pv, 1.25) * (h / 3) * gain + 4);
      this.ctx.beginPath();
      this.ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  drawCircle(w, h) {
    // Frequency-domain circle with a base ring + adaptive spikes
    this.analyser.getFloatFrequencyData(this.freqFloat);

    let peak = 0;
    for (let i = 0; i < this.freqFloat.length; i++) {
      const v = this.norm(this.freqFloat[i]);
      if (v > peak) peak = v;
    }
    const gain = 1.0 / Math.max(0.35, peak + 0.05);

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
    const bins = 128;

    // base ring
    for (let i = 0; i < bins; i++) {
      const angle = (i / bins) * Math.PI * 2;
      const x0 = cx + Math.cos(angle) * r;
      const y0 = cy + Math.sin(angle) * r;
      this.ctx.beginPath();
      this.ctx.arc(x0, y0, 2.0, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // amplitude dots
    for (let i = 0; i < bins; i++) {
      const angle = (i / bins) * Math.PI * 2;
      const idx = this.sampleIndex(i, bins, 2.0);
      const v = this.norm(this.freqFloat[idx]);
      const len = r + Math.pow(v, 1.25) * (h / 3) * gain;
      const x = cx + Math.cos(angle) * len;
      const y = cy + Math.sin(angle) * len;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.5 + v * 5, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawParticles(w, h) {
    // particle orbit around ring with beat-driven spawning
    this.analyser.getFloatFrequencyData(this.freqFloat);
    let avg = 0;
    for (let i = 0; i < this.freqFloat.length; i++) avg += this.norm(this.freqFloat[i]);
    avg /= this.freqFloat.length;

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
    const spawn = Math.min(6, Math.floor(avg * 12));
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
    this.ctx.save();
    for (const p of this.particles) {
      p.theta += p.speed * 0.02;
      p.life *= 0.985;
      if (p.life < 0.08) continue;
      const x = cx + Math.cos(p.theta) * p.radius;
      const y = cy + Math.sin(p.theta) * p.radius;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2 + (1 - p.life) * 3, 0, Math.PI * 2);
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