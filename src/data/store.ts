import type { LineData, WorkCondition } from '../types';
import { idb, STORES } from './db';
import { generateDemoLine } from './demoLine';

type Listener = () => void;

/**
 * 全局应用状态(轻量 store, 发布订阅)
 */
class AppStore {
  line: LineData | null = null;
  currentConditionId: string = '';
  selectedSpanId: string | null = null;
  selectedTowerId: string | null = null;
  /** 工况对比: 另一工况 id */
  compareConditionId: string = '';
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async init(): Promise<void> {
    const lines = await idb.getAll<LineData>(STORES.LINES);
    if (lines.length > 0) {
      this.line = lines[0];
    } else {
      this.line = generateDemoLine();
      await this.save();
    }
    this.currentConditionId = this.line.conditions[0]?.id ?? '';
    this.emit();
  }

  async save(): Promise<void> {
    if (!this.line) return;
    this.line.updatedAt = Date.now();
    await idb.put(STORES.LINES, this.line);
    this.emit();
  }

  async resetDemo(): Promise<void> {
    this.line = generateDemoLine();
    this.currentConditionId = this.line.conditions[0].id;
    await this.save();
  }

  get condition(): WorkCondition | undefined {
    return this.line?.conditions.find((c) => c.id === this.currentConditionId);
  }

  get compareCondition(): WorkCondition | undefined {
    return this.line?.conditions.find((c) => c.id === this.compareConditionId);
  }

  update(mutator: (line: LineData) => void): void {
    if (!this.line) return;
    mutator(this.line);
    void this.save();
  }
}

export const store = new AppStore();
