import * as THREE from 'three';
import type { LineData, WorkCondition } from '../types';
import { SceneManager, type SceneLabel } from './SceneManager';
import { buildTerrain, buildTower, buildCrossing } from './builders';
import { buildSweptTube, buildSpacers, buildInsulatorString, makeIceFn } from './cableBuilder';
import {
  computeLine,
  attachmentWorld,
  buildCableCurves,
  CABLE_ROLES,
  type SectionComputed,
  type CableRole,
} from '../services/computeService';
import { checkClearance } from '../physics/clearance';
import { DEFAULT_CLEARANCE } from '../physics/constants';

export interface LineSceneOptions {
  iceShape: 'crescent' | 'airfoil';
  showIce: boolean;
  showSpacers: boolean;
  showGroundWire: boolean;
}

/**
 * 整条线路三维场景装配
 * 管段/间隔棒按档分组, 支持工况切换重建与舞动位移更新
 */
export class LineScene {
  sm: SceneManager;
  line: LineData;
  computed: SectionComputed[] = [];
  private cableGroup = new THREE.Group();
  private labelData: SceneLabel[] = [];
  private clearanceResults: ReturnType<typeof checkClearance>[] = [];
  opts: LineSceneOptions;
  /** 每条线缆的静态世界曲线(供舞动复用): key role-bundleIdx */
  staticCurves = new Map<string, { points: THREE.Vector3[]; spanRanges: [number, number][] }>();

  constructor(container: HTMLElement, line: LineData, opts: LineSceneOptions) {
    this.sm = new SceneManager(container);
    this.line = line;
    this.opts = opts;
    this.buildStaticWorld();
  }

  /** 地形/杆塔/跨越物等与工况无关部分 */
  private buildStaticWorld(): void {
    const scene = this.sm.scene;
    scene.add(buildTerrain(this.line));
    for (const t of this.line.towers) scene.add(buildTower(t));
    for (const cr of this.line.crossings) scene.add(buildCrossing(cr));

    // 里程参考线(走廊中线)
    const total = this.line.towers[this.line.towers.length - 1].mileage;
    const gridPts: THREE.Vector3[] = [];
    for (let x = 0; x <= total; x += 100) {
      gridPts.push(new THREE.Vector3(x, 0, 0.1));
    }
    const grid = new THREE.BufferGeometry().setFromPoints(gridPts);
    scene.add(
      new THREE.Line(
        grid,
        new THREE.LineDashedMaterial({
          color: 0x33507a,
          dashSize: 8,
          gapSize: 6,
        }),
      ).computeLineDistances(),
    );
    scene.add(this.cableGroup);

    const center = new THREE.Vector3(total / 2, 0, 140);
    this.sm.fitAll(center, new THREE.Vector3(total, 60, 90));
  }

  /** 工况变化: 重建全部线缆力学与管段 */
  updateCondition(wc: WorkCondition): void {
    // 清空旧线缆
    this.cableGroup.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.cableGroup.clear();
    this.staticCurves.clear();
    this.labelData = [];
    this.clearanceResults = [];

    this.computed = computeLine(this.line, wc);

    for (const c of this.computed) {
      const swingDx = new Map<string, number>();
      const swingDz = new Map<string, number>();
      const swingDy = new Map<string, number>();
      for (const s of [...c.phase.swings, ...c.ground.swings]) {
        // 相导线与地线偏摆取相导线结果(串偏角由垂直荷载主导, 差异小)
        if (!swingDx.has(s.towerId)) {
          swingDx.set(s.towerId, s.dx);
          swingDz.set(s.towerId, s.dz);
          swingDy.set(s.towerId, s.dy);
        }
      }

      // 悬垂串
      for (const tId of c.section.towerIds) {
        const tw = this.line.towers.find((t) => t.id === tId)!;
        if (tw.kind !== 'suspension') continue;
        const sw = c.phase.swings.find((x) => x.towerId === tId);
        const top = attachmentWorld(tw, 'B');
        this.cableGroup.add(
          buildInsulatorString({
            top: new THREE.Vector3(top.x, top.y, top.z),
            length: tw.stringLength,
            angleLong: sw?.longitudinalAngle ?? 0,
            angleTrans: sw?.transverseAngle ?? 0,
          }),
        );
      }

      // 三相 + 双地线
      for (const role of CABLE_ROLES) {
        const isGround = role.startsWith('GW');
        if (isGround && !this.opts.showGroundWire) continue;
        const result = isGround ? c.ground : c.phase;
        const conductor = isGround ? c.groundConductor : c.phaseConductor;
        const bundle = isGround ? ({ mode: 1 as const, spacing: 0 }) : c.section.bundle;
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

        // 各档里程范围与冰厚
        const spanRanges = result.spans.map((m) => {
          const sp = this.line.spans.find((s) => s.id === m.spanId)!;
          const t1 = this.line.towers.find((t) => t.id === sp.fromTowerId)!;
          return [
            t1.mileage + (swingDx.get(t1.id) ?? 0),
            t1.mileage + m.L + (swingDx.get(t1.id) ?? 0),
          ] as [number, number];
        });
        const iceSpans = result.spans.map((m, i) => ({
          mileageStart: spanRanges[i][0],
          mileageEnd: spanRanges[i][1],
          ice: this.opts.showIce ? m.ice : 0,
        }));
        const iceFn = makeIceFn(iceSpans);

        curves.forEach((curve, bi) => {
          const key = `${c.section.id}:${role}:${bi}`;
          this.staticCurves.set(key, {
            points: curve.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
            spanRanges,
          });
          const tube = buildSweptTube({
            curve,
            radius: conductor.diameter / 2000,
            iceThickness: (x) => iceFn(x),
            shape: this.opts.iceShape,
            radialSegments: 10,
          });
          tube.name = key;
          this.cableGroup.add(tube);

          // 间隔棒(仅相导线、双/四分裂、每档布置)
          if (this.opts.showSpacers && !isGround && bundle.mode > 1) {
            result.spans.forEach((m, si) => {
              const sp = this.line.spans.find((s) => s.id === m.spanId)!;
              const seg = curve.segments[si];
              const segCurve = { points: curve.points.slice(seg.indexStart, seg.indexEnd + 1) };
              if (segCurve.points.length < 3) return;
              this.cableGroup.add(
                buildSpacers({
                  curve: segCurve,
                  subSpans: sp.subSpans,
                  totalLength: m.L,
                  bundleSpacing: bundle.spacing / 1000,
                  mileageStart: seg.xStart,
                }),
              );
            });
          }

          // 净距校核(用第一根子线按档段精确切分)
          if (bi === 0) {
            result.spans.forEach((m, si) => {
              const seg = curve.segments[si];
              const res = checkClearance({
                curve: { points: curve.points.slice(seg.indexStart, seg.indexEnd + 1) },
                spanId: m.spanId,
                spanRange: [seg.xStart, seg.xEnd],
                terrain: this.line.terrain,
                crossings: this.line.crossings,
                groundRequired: DEFAULT_CLEARANCE.ground,
              });
              this.clearanceResults.push(res);
              for (const v of res.crossings) {
                this.labelData.push({
                  id: `cl-${m.spanId}-${v.crossingId}`,
                  pos: new THREE.Vector3(v.mileage, 0, v.conductorZ + 1.5),
                  text: `${v.crossingName} 净距${v.minDistance.toFixed(2)}m${
                    v.ok ? '' : ` <${v.required}m`
                  }`,
                  danger: !v.ok,
                });
              }
            });
          }
        });
      }
      this.sm.setLabels(this.labelData);
    }
  }

  /** 串偏角汇总(供 UI 面板) */
  getSwingSummary(): { towerNo: string; longDeg: number; transDeg: number; dx: number }[] {
    const out: { towerNo: string; longDeg: number; transDeg: number; dx: number }[] = [];
    for (const c of this.computed) {
      for (const s of c.phase.swings) {
        const tw = this.line.towers.find((t) => t.id === s.towerId);
        if (!tw) continue;
        out.push({
          towerNo: tw.no,
          longDeg: (s.longitudinalAngle * 180) / Math.PI,
          transDeg: (s.transverseAngle * 180) / Math.PI,
          dx: s.dx,
        });
      }
    }
    return out;
  }

  getClearance() {
    return this.clearanceResults;
  }

  screenshot(): string {
    return this.sm.screenshot();
  }

  dispose(): void {
    this.sm.dispose();
  }
}
