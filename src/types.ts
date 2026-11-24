/**
 * 领域模型类型定义
 * 坐标约定: x = 线路走向里程(m), y = 横向偏移(m, 左负右正), z = 高程(m, 海拔)
 */

// ---------- 导线/地线型号 ----------
export interface ConductorType {
  id: string;
  name: string; // 如 LGJ-400/35
  kind: 'phase' | 'ground';
  area: number; // 标称截面 mm²
  diameter: number; // 外径 mm
  unitWeight: number; // 单位长度重量 kg/m
  elasticModulus: number; // 弹性模量 MPa (N/mm²)
  expansionCoeff: number; // 线膨胀系数 1/℃
  ratedStrength: number; // 额定拉断力 N
}

// 分裂方式
export type BundleMode = 1 | 2 | 4;

export interface BundleConfig {
  mode: BundleMode; // 分裂数
  spacing: number; // 分裂间距 mm
}

// ---------- 杆塔 ----------
export type TowerKind = 'suspension' | 'strain'; // 直线塔(悬垂) | 耐张塔
export type TowerForm = 'cathead' | 'cup' | 'strain'; // 猫头 | 酒杯 | 耐张

export interface TowerTemplate {
  form: TowerForm;
  name: string;
  height: number; // 塔高 m
  baseWidth: number; // 根开 m
  /** 横担层定义: 高程偏移(相对塔腿地面), 单侧横担长度(m) */
  crossArms: { dz: number; halfWidth: number }[];
  /** 挂点局部坐标(y 横向, z 相对塔位地面高程); 三相 + 地线, 按相序 A/B/C/双地线 */
  attachments: TowerAttachment[];
}

export interface TowerAttachment {
  role: 'A' | 'B' | 'C' | 'GW1' | 'GW2';
  y: number; // 横向坐标 m
  dz: number; // 相对塔位地面的高度 m
}

export interface Tower {
  id: string;
  no: string; // 杆塔编号 如 N1
  kind: TowerKind;
  form: TowerForm;
  height: number; // 塔高 m (地面到塔顶)
  mileage: number; // 里程 m
  groundZ: number; // 塔位地面高程 m
  /** 悬垂串长 m (耐张塔为跳线/耐张串长, 不参与偏摆) */
  stringLength: number;
  /** 覆盖后的实际挂点(编辑可改), dz 为相对地面高度; 不填则取模板默认 */
  attachmentOverrides?: Partial<Record<string, { y: number; dz: number }>>;
  remark?: string;
}

// ---------- 耐张段与档 ----------
export interface Span {
  id: string;
  fromTowerId: string;
  toTowerId: string;
  /** 录入档距(m), 若与杆塔里程不一致则标红 */
  spanLength?: number;
  /** 录入高差(m, 终点-起点), 与挂点高程不一致则标红 */
  elevationDiff?: number;
  /** 该档覆冰厚度覆盖(mm), 不填取工况默认; -1 表示脱冰档 */
  iceOverride?: number;
  /** 次档距布置(舞动/间隔棒): 数组长度=间隔棒数+1, 值为各次档距长度 m; 不填自动均分 */
  subSpans?: number[];
}

export interface TensionSection {
  id: string;
  name: string; // 耐张段名
  towerIds: string[]; // 两端为耐张塔
  spanIds: string[];
  conductorId: string; // 相导线型号
  groundId: string; // 地线型号
  bundle: BundleConfig;
  /** 架线控制条件: 气温℃, 无冰无风, 控制应力 MPa (年平均运行应力, 默认 25% RTS/area) */
  installTemp: number;
  installStress: number;
  /** 舞动参数 */
  galloping: GallopingConfig;
}

export interface GallopingConfig {
  freq: number; // 频率 Hz
  amplitude: number; // 峰峰值振幅 m (单导线/分裂导线整体)
  loops: number; // 半波数
  verticalRatio: number; // 垂直振幅/水平振幅比
  phaseAngle: number; // 垂直相对水平运动相位差(°), 90 为椭圆
}

// ---------- 工况 ----------
export interface WorkCondition {
  id: string;
  name: string;
  temp: number; // 气温 ℃
  ice: number; // 覆冰厚度 mm
  wind: number; // 设计风速 m/s (覆冰工况取覆冰风 10m/s)
  windOnIce?: boolean; // 覆冰风工况
  deIce?: boolean; // 脱冰工况
  builtin?: boolean;
}

// ---------- 跨越物与地形 ----------
export type CrossingKind = 'road' | 'line10kv' | 'house';

export interface Crossing {
  id: string;
  kind: CrossingKind;
  name: string;
  mileage: number; // 中心里程 m
  width: number; // 沿线路方向宽度 m
  /** 路面/屋顶/被跨线 高程 m */
  z: number;
  /** 10kV 线: 横担宽度; 房屋: 横向宽度 m */
  lateralWidth?: number;
  /** 10kV 线: 杆顶高度(相对 z 的附加高度) */
  poleHeight?: number;
  /** 要求的最小净距 m (规范值, 可改) */
  requiredClearance: number;
}

export interface TerrainSample {
  mileage: number;
  centerZ: number; // 中线地面高程
  leftZ: number; // 左边线
  rightZ: number; // 右边线
}

export interface LineData {
  id: string;
  name: string;
  voltage: string; // 220kV
  corridorWidth: number; // 走廊宽度(左右边线间距) m
  towers: Tower[];
  sections: TensionSection[];
  spans: Span[];
  crossings: Crossing[];
  terrain: TerrainSample[];
  conditions: WorkCondition[];
  conductors: ConductorType[];
  createdAt: number;
  updatedAt: number;
}
