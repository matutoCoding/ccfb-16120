import * as THREE from 'three';
import type { LineData } from '../types';
import { SceneManager } from './SceneManager';
import { buildTerrain, buildTower, buildCrossing } from './builders';
import {
  computeLine,
  attachmentWorld,
  buildCableCurves,
  CABLE_ROLES,
  type CableRole,
  type SectionComputed,
} from '../services/computeService';
import { buildGallopingCurve, pairDistanceTimeline, type CableCurve3D } from '../physics/galloping';
import { DEFAULT_CLEARANCE } from '../physics/constants';

const N_SAMPLES = 48; // 每档采样(7 档 → 整条曲线约 337 点)
const N_FRAMES = 120;
const PHASE_GAP_WARN = 2.5; // 相间距预警值 m
const PHASE_GAP_CRIT = 2.0; // 闪络临界 m

interface PlayerCable {
  key: string;
  role: CableRole;
  base: THREE.Vector3[]; // 静态世界坐标(整条耐张段)
  mesh: THREE.Mesh;
  color: number;
  radius: number;
  galloping: ReturnType<typeof buildGallopingCurve>; // 该线缆自身的初相位舞动序列
}

/**
 * 舞动播放器: 三相+地线按驻波椭圆轨迹运动, 逐帧量测相间距
 * 距离曲线与三维画面共用同一帧数据
 */
export class GallopingPlayer {
  sm: SceneManager;
  line: LineData;
  sectionId: string;
  private cables: PlayerCable[] = [];
  private computed: SectionComputed[];
  private curve: ReturnType<typeof buildGallopingCurve>;
  private phaseOffset: Record<string, number> = {};
  private times: number[];
  private pairData: ReturnType<typeof pairDistanceTimeline> = [];
  private frameIndex = 0;
  private playing = false;
  private speed = 0.25; // 慢放比例
  private raf = 0;
  private lastTs = 0;
  private envelopeShown = false;
  private envelopeGroup = new THREE.Group();
  onFrame?: (frame: number, info: FrameInfo) => void;
  private sectionStart: number;
  private sectionEnd: number;

  constructor(container: HTMLElement, line: LineData, sectionId: string) {
    this.line = line;
    this.sectionId = sectionId;
    this.sm = new SceneManager(container);
    this.sm.scene.add(buildTerrain(line));
    for (const t of line.towers) this.sm.scene.add(buildTower(t));
    for (const cr of line.crossings) this.sm.scene.add(buildCrossing(cr));
    this.sm.scene.add(this.envelopeGroup);

    // 用最低温无冰工况作为舞动静态形态(覆冰后舞动也可, 取当前选中工况)
    const wc = line.conditions.find((c) => c.id === 'max-temp') ?? line.conditions[0];
    this.computed = computeLine(line, wc);
    const section = line.sections.find((s) => s.id === sectionId)!;
    this.sectionStart = line.towers.find((t) => t.id === section.towerIds[0])!.mileage;
    this.sectionEnd = line.towers.find((t) => t.id === section.towerIds[section.towerIds.length - 1])!.mileage;

    // 各相舞动初相位(°): 三相不同步舞动, 地线与最近相同步
    this.phaseOffset = { A: 0, B: 95, C: 190, GW1: 10, GW2: 170 };
    this.curve = buildGallopingCurve(section.galloping, N_SAMPLES, N_FRAMES);
    this.times = this.curve.frames.map((f) => f.t);
    this.buildCables();
    this.computePairDistances();

    this.sm.fitAll(
      new THREE.Vector3((this.sectionStart + this.sectionEnd) / 2, 0, 150),
      new THREE.Vector3(this.sectionEnd - this.sectionStart, 60, 100),
    );
  }

  private buildCables(): void {
    const colors: Record<string, number> = {
      A: 0xff6b6b,
      B: 0xffd93d,
      C: 0x6bcb77,
      GW1: 0x9fd8ff,
      GW2: 0x9fd8ff,
    };
    for (const c of this.computed) {
      if (c.section.id !== this.sectionId) continue;
      const swingDx = new Map<string, number>();
      const swingDz = new Map<string, number>();
      const swingDy = new Map<string, number>();
      for (const s of c.phase.swings) {
        swingDx.set(s.towerId, s.dx);
        swingDz.set(s.towerId, s.dz);
        swingDy.set(s.towerId, s.dy);
      }
      for (const role of CABLE_ROLES) {
        const isGround = role.startsWith('GW');
        const result = isGround ? c.ground : c.phase;
        const conductor = isGround ? c.groundConductor : c.phaseConductor;
        const bundle = isGround ? { mode: 1 as const, spacing: 0 } : c.section.bundle;
        const curves = buildCableCurves({
          line: this.line,
          computed: c,
          result,
          role,
          bundleMode: bundle.mode,
          spacingMm: bundle.spacing,
          swingDx,
          swingDz,
          swingDy,
        });
        // 舞动作用于分裂整体, 取第一根子线作轨迹载体
        const curve = curves[0];
        // 重采样到 N_SAMPLES(整条耐张段)
        const base = this.resample(curve);
        const galloping = buildGallopingCurve(
          this.line.sections.find((s) => s.id === this.sectionId)!.galloping,
          N_SAMPLES,
          N_FRAMES,
          this.phaseOffset[role] ?? 0,
        );
        const geo = new THREE.BufferGeometry();
        geo.setFromPoints(base);
        const mat = new THREE.MeshStandardMaterial({
          color: colors[role],
          emissive: colors[role],
          emissiveIntensity: 0.25,
          roughness: 0.4,
          metalness: 0.4,
        });
        const mesh = new THREE.Mesh(this.makeTube(geo, conductor.diameter / 2000), mat);
        mesh.frustumCulled = false;
        this.sm.scene.add(mesh);
        this.cables.push({
          key: role,
          role,
          base,
          mesh,
          color: colors[role],
          radius: conductor.diameter / 2000,
          galloping,
        });
      }
    }
  }

  /** 把任意采样数曲线重采样为统一 N_SAMPLES+1 点(里程线性) */
  private resample(curve: CableCurve3D): THREE.Vector3[] {
    const pts = curve.points;
    const x0 = pts[0].x;
    const x1 = pts[pts.length - 1].x;
    const out: THREE.Vector3[] = [];
    let j = 0;
    for (let i = 0; i <= N_SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / N_SAMPLES;
      while (j < pts.length - 2 && pts[j + 1].x < x) j++;
      const a = pts[j];
      const b = pts[Math.min(j + 1, pts.length - 1)];
      const t = (x - a.x) / Math.max(1e-9, b.x - a.x);
      out.push(new THREE.Vector3(
        x,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      ));
    }
    return out;
  }

  private makeTube(sourceGeo: THREE.BufferGeometry, radius: number): THREE.BufferGeometry {
    const pos = sourceGeo.getAttribute('position');
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    return new THREE.TubeGeometry(curve, N_SAMPLES * 2, Math.max(0.12, radius), 6, false);
  }

  /** 逐帧相间距: 三相两两 + 相地, 全部基于与画面相同的位移函数 */
  private computePairDistances(): void {
    const phaseCables = this.cables.filter((c) => !c.role.startsWith('GW'));
    const pairs: [number, number][] = [];
    for (let i = 0; i < phaseCables.length; i++) {
      for (let j = i + 1; j < phaseCables.length; j++) pairs.push([i, j]);
    }
    // 每帧构造各线缆世界曲线(每相用自身初相位的舞动序列)
    const allCurves: CableCurve3D[][] = phaseCables.map((cable) =>
      cable.galloping.frames.map((frame) => ({
        points: cable.base.map((p, i) => {
          const g = frame.points[i];
          return { x: p.x, y: p.y + g.dy, z: p.z + g.dz };
        }),
      })),
    );
    this.pairData = pairDistanceTimeline(allCurves, pairs, this.times);
  }

  /** 时间轴闪络打点(返回临界/预警帧位置 0..1) */
  getTimelineMarks(): { pos: number; crit: boolean }[] {
    const marks: { pos: number; crit: boolean }[] = [];
    for (const pd of this.pairData) {
      pd.timeline.forEach((r, i) => {
        if (r.minDistance <= PHASE_GAP_CRIT) marks.push({ pos: i / N_FRAMES, crit: true });
        else if (r.minDistance <= PHASE_GAP_WARN) marks.push({ pos: i / N_FRAMES, crit: false });
      });
    }
    return marks;
  }

  getPairData() {
    return this.pairData.map((pd) => ({
      pair: [this.cables[pd.pair[0]].role, this.cables[pd.pair[1]].role] as [string, string],
      timeline: pd.timeline,
      min: pd.min,
      minFrame: pd.minFrame,
    }));
  }

  private applyFrame(frame: number): void {
    this.frameIndex = frame;
    let t = 0;
    for (const cable of this.cables) {
      const disp = cable.galloping.frames[frame];
      t = disp.t;
      const pts = cable.base.map((p, i) => {
        const g = disp.points[i];
        return new THREE.Vector3(p.x, p.y + g.dy, p.z + g.dz);
      });
      const old = cable.mesh.geometry;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      cable.mesh.geometry = new THREE.TubeGeometry(
        curve,
        N_SAMPLES * 2,
        Math.max(0.12, cable.radius),
        6,
        false,
      );
      old.dispose();
    }
    // 本帧相间距信息
    const info: FrameInfo = {
      t,
      pairs: this.pairData.map((pd) => ({
        name: `${this.cables[pd.pair[0]].role}-${this.cables[pd.pair[1]].role}`,
        distance: pd.timeline[frame].minDistance,
        sampleIndex: pd.timeline[frame].sampleIndex,
        crit: pd.timeline[frame].minDistance <= PHASE_GAP_CRIT,
      })),
    };
    this.onFrame?.(frame, info);
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastTs = performance.now();
    const tick = (ts: number) => {
      if (!this.playing) return;
      const dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      // 一个周期实际放慢 1/speed 倍
      const framesPerSec = this.curve.nFrames / this.curve.duration * this.speed;
      const next = (this.frameIndex + Math.round(dt * framesPerSec)) % N_FRAMES;
      this.applyFrame(next);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  setFrame(f: number): void {
    this.pause();
    this.applyFrame(Math.max(0, Math.min(N_FRAMES - 1, f)));
  }

  stepFrame(delta: number): void {
    this.setFrame((this.frameIndex + delta + N_FRAMES) % N_FRAMES);
  }

  setSpeed(s: number): void {
    this.speed = s;
  }

  get frameCount(): number {
    return N_FRAMES;
  }
  get currentFrame(): number {
    return this.frameIndex;
  }
  get period(): number {
    return this.curve.duration;
  }

  /** 相机沿线路飞行(从耐张段起点到终点), 高程跟随首基塔挂点 */
  flyAlong(onDone?: () => void): void {
    this.pause();
    const section = this.line.sections.find((s) => s.id === this.sectionId)!;
    const firstTower = this.line.towers.find((t) => t.id === section.towerIds[0])!;
    const cableZ = attachmentWorld(firstTower, 'B').z;
    const x0 = this.sectionStart;
    const x1 = this.sectionEnd;
    const duration = 6000;
    const t0 = performance.now();
    const animate = (ts: number) => {
      const k = Math.min(1, (ts - t0) / duration);
      const x = x0 + (x1 - x0) * k;
      this.sm.camera.position.set(x - 60, 170, cableZ + 55);
      this.sm.controls.target.set(x + 40, 0, cableZ + 10);
      this.sm.controls.update();
      if (k < 1) requestAnimationFrame(animate);
      else onDone?.();
    };
    requestAnimationFrame(animate);
  }

  /** 锁定某档侧面 */
  sideView(spanIndex: number): void {
    const section = this.line.sections.find((s) => s.id === this.sectionId)!;
    const spanId = section.spanIds[spanIndex];
    const span = this.line.spans.find((s) => s.id === spanId)!;
    const t1 = this.line.towers.find((t) => t.id === span.fromTowerId)!;
    const t2 = this.line.towers.find((t) => t.id === span.toTowerId)!;
    // 目标高程取两端 B 相挂点均值, 保证导线居于画面中央
    const z1 = attachmentWorld(t1, 'B').z;
    const z2 = attachmentWorld(t2, 'B').z;
    this.sm.sideView((t1.mileage + t2.mileage) / 2, (z1 + z2) / 2, t2.mileage - t1.mileage);
  }

  /** 叠出各次档距轨迹包络: 对每条线缆采样点画全周期扫过范围(半透明管) */
  toggleEnvelope(): boolean {
    this.envelopeShown = !this.envelopeShown;
    this.envelopeGroup.clear();
    if (!this.envelopeShown) return this.envelopeShown;
    for (const cable of this.cables) {
      const envPts = cable.base.map((p, i) => {
        let maxR = 0;
        for (const f of cable.galloping.frames) {
          maxR = Math.max(maxR, Math.hypot(f.points[i].dy, f.points[i].dz));
        }
        return { p, r: Math.max(0.3, maxR) };
      });
      const pts = envPts.map((e) => e.p);
      const catmull = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      const geo = new THREE.TubeGeometry(catmull, N_SAMPLES * 2, 1.2, 8, false);
      const mat = new THREE.MeshBasicMaterial({
        color: cable.color,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.envelopeGroup.add(mesh);
      // 最大包络点标记
      const maxEnv = envPts.reduce((a, b) => (b.r > a.r ? b : a));
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 10, 8),
        new THREE.MeshBasicMaterial({ color: cable.color }),
      );
      marker.position.copy(maxEnv.p);
      this.envelopeGroup.add(marker);
    }
    return this.envelopeShown;
  }

  screenshot(): string {
    return this.sm.screenshot();
  }

  dispose(): void {
    this.pause();
    this.sm.dispose();
  }
}

export interface FrameInfo {
  t: number;
  pairs: { name: string; distance: number; sampleIndex: number; crit: boolean }[];
}

export { PHASE_GAP_WARN, PHASE_GAP_CRIT, DEFAULT_CLEARANCE };
