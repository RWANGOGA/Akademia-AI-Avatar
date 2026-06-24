/**
 * Learning progress stored in localStorage.
 */
const KEY = 'akademia_culture_progress';

const DEFAULT = {
  lessonsCompleted: [],
  phrasesPracticed: [],
  scenariosVisited: [],
  lastTopic: null,
};

export class ProgressStore {
  load() {
    try {
      return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULT };
    }
  }

  save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  markScenario(key) {
    const d = this.load();
    if (!d.scenariosVisited.includes(key)) d.scenariosVisited.push(key);
    d.lastTopic = key;
    this.save(d);
    return d;
  }

  markPhrase(luganda) {
    const d = this.load();
    if (!d.phrasesPracticed.includes(luganda)) d.phrasesPracticed.push(luganda);
    this.save(d);
    return d;
  }

  summary() {
    const d = this.load();
    const total = d.scenariosVisited.length + d.phrasesPracticed.length;
    return { ...d, score: total };
  }
}
