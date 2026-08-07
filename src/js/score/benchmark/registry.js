/**
 * Benchmark engine registry — Open/Closed: add a country by registering a new engine.
 * Does not own scoring behaviour.
 */
(function initWaterScoreBenchmarkRegistry(global) {
  global.WaterScoreBenchmarkRegistry = global.WaterScoreBenchmarkRegistry || {
    _engines: Object.create(null),
    order: [],
    defaultKey: 'thailand',

    register(engine) {
      if (!engine || !engine.key || typeof engine.calculate !== 'function') {
        throw new Error('Benchmark engine requires key and calculate()');
      }
      this._engines[engine.key] = engine;
      if (!this.order.includes(engine.key)) this.order.push(engine.key);
      return engine;
    },

    get(key) {
      return this._engines[key] || this._engines[this.defaultKey] || null;
    },

    has(key) {
      return Boolean(this._engines[key]);
    },

    list() {
      return this.order.filter(key => this._engines[key]).map(key => this._engines[key]);
    },

    calculate(key, readings) {
      const engine = this.get(key);
      if (!engine) return { score: null, params: null, findings: [], statuses: {} };
      return engine.calculate(readings || {});
    }
  };
  if (typeof window !== 'undefined') window.WaterScoreBenchmarkRegistry = global.WaterScoreBenchmarkRegistry;
})(typeof globalThis !== 'undefined' ? globalThis : window);
