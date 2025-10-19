class Visualizer {
  constructor(analyser, canvas) {
    this.analyser = analyser;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.style = 'bars';
    this.color1 = '#19d3ae';
    this.color2 = '#1e90ff';
    this.running = false;

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

    ctx.clearRect(0, 0, w, h);
    const grad = API.gradient(ctx, this.color1, this.color2, w, h);
    ctx.fillStyle = grad;
    ctx.strokeStyle = grad;

    if (this.style === 'bars') this.drawBars(w, h);
    else if (this.style === 'wave') this.drawWave(w, h);
    else this.drawCircle(w, h);
  }

  drawBars(w, h) {
    this.analyser.getFloatFrequencyData(this.freqFloat);
    const bins = 96;
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const idx = this.sampleIndex(i, bins, 2.2);
      const v = this.norm(this.freqFloat[idx]);
      const bh = Math.pow(v, 1.25) * h; // emphasize dynamics
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

  drawCircle(w, h) {
    this.analyser.getFloatFrequencyData(this.freqFloat);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3;
    const bins = 96;
    for (let i = 0; i < bins; i++) {
      const angle = (i / bins) * Math.PI * 2;
      const idx = this.sampleIndex(i, bins, 2.0);
      const v = this.norm(this.freqFloat[idx]);
      const len = r + Math.pow(v, 1.35) * (h / 3);
      const x = cx + Math.cos(angle) * len;
      const y = cy + Math.sin(angle) * len;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3 + v * 6, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
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