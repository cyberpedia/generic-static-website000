class Equalizer {
  constructor(ctx) {
    this.ctx = ctx;
    this.bands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.filters = this.bands.map(freq => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    let prev = this.input;
    for (const f of this.filters) {
      prev.connect(f);
      prev = f;
    }
    prev.connect(this.output);
  }

  setGain(i, db) {
    if (this.filters[i]) this.filters[i].gain.value = Number(db);
  }

  setPreset(name) {
    const presets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pop: [-1, 2, 4, 5, 3, 0, -1, -1, -2, -3],
      rock: [3, 2, 1, 0, -1, 1, 2, 4, 5, 5],
      jazz: [0, 1, 2, 3, 2, 1, 0, -1, -2, -3],
      bass: [6, 5, 4, 3, 2, 0, -2, -3, -4, -5],
      treble: [-4, -3, -2, -1, 0, 1, 3, 4, 5, 6]
    };
    const gains = presets[name] || presets.flat;
    gains.forEach((g, i) => this.setGain(i, g));
  }

  connect(node) {
    this.output.connect(node);
  }

  disconnect() {
    try { this.output.disconnect(); } catch (_) {}
  }
}