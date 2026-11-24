/** 物理常量与单位换算 */
export const G = 9.80665; // 重力加速度 m/s²
export const ICE_DENSITY = 900; // 覆冰密度 kg/m³ (GB 50545 取 0.9g/cm³)
export const AIR_PRESSURE_COEF = 0.625; // 基准风压系数 μ = 1/16 (标准空气密度)
export const WIND_SHAPE_COEF = 1.1; // 导线风荷载体型系数 (d≥17mm 取 1.1)
export const MM2_PER_M2 = 1e6;

/** 钢芯铝绞线常见年平均运行应力占 RTS 比例 */
export const EVERYDAY_STRESS_RATIO = 0.25;

/** 220kV 默认规范净距 m (可在跨越物上覆盖) */
export const DEFAULT_CLEARANCE = {
  ground: 6.5, // 非居民区导线对地面
  road: 7.0, // 跨公路路面
  line10kv: 3.0, // 220kV 跨 10kV 线
  house: 6.0, // 跨房屋屋顶
} as const;
