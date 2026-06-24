/**
 * CultureEngine — learning mode + progress for Uganda ↔ Japan bridge.
 */
import { ProgressStore } from './progressStore.js';

export const LEARNING_MODES = {
  uganda: { id: 'uganda', label: 'Learn Uganda', flag: '🇺🇬' },
  japan:  { id: 'japan',  label: 'Learn Japan',  flag: '🇯🇵' },
  compare:{ id: 'compare', label: 'Compare',      flag: '⚖' },
};

export class CultureEngine {
  constructor() {
    this.mode = 'uganda';
    this.progress = new ProgressStore();
  }

  setMode(mode) {
    if (LEARNING_MODES[mode]) this.mode = mode;
    return this.mode;
  }

  getMode() {
    return this.mode;
  }

  onScenarioEnter(scenarioKey) {
    return this.progress.markScenario(scenarioKey);
  }

  getProgressBadge() {
    const { score, scenariosVisited } = this.progress.summary();
    if (score === 0) return null;
    return `${scenariosVisited.length} scenario${scenariosVisited.length === 1 ? '' : 's'} explored`;
  }
}
