import type { TowerAttachment, TowerForm, TowerTemplate } from '../types';

/**
 * 程序化杆塔模板
 * 220kV 典型: 三相导线(上两相近水平、下一相) + 双地线
 * 挂点局部坐标: y 横向(m), dz 相对塔腿地面高度(m)
 */

function cathead(height: number): TowerTemplate {
  // 猫头塔: 上两相横担较窄、中相从塔顶窗伸出
  const attachments: TowerAttachment[] = [
    { role: 'GW1', y: -3.2, dz: height },
    { role: 'GW2', y: 3.2, dz: height },
    { role: 'A', y: -5.5, dz: height - 6 },
    { role: 'B', y: 0, dz: height - 4 },
    { role: 'C', y: 5.5, dz: height - 6 },
  ];
  return {
    form: 'cathead',
    name: `猫头直线塔 ${height}m`,
    height,
    baseWidth: 7.2,
    crossArms: [
      { dz: height, halfWidth: 3.6 },
      { dz: height - 6, halfWidth: 6.2 },
    ],
    attachments,
  };
}

function cup(height: number): TowerTemplate {
  // 酒杯塔: 上两相横担宽、中相在下横担中部
  const attachments: TowerAttachment[] = [
    { role: 'GW1', y: -3.0, dz: height },
    { role: 'GW2', y: 3.0, dz: height },
    { role: 'A', y: -7.2, dz: height - 7 },
    { role: 'B', y: 0, dz: height - 9 },
    { role: 'C', y: 7.2, dz: height - 7 },
  ];
  return {
    form: 'cup',
    name: `酒杯直线塔 ${height}m`,
    height,
    baseWidth: 8.0,
    crossArms: [
      { dz: height, halfWidth: 3.4 },
      { dz: height - 7, halfWidth: 8.0 },
      { dz: height - 9, halfWidth: 2.0 },
    ],
    attachments,
  };
}

function strain(height: number): TowerTemplate {
  // 耐张塔: 横担分层, 两侧对称挂点(每相单侧挂点)
  const attachments: TowerAttachment[] = [
    { role: 'GW1', y: -2.6, dz: height },
    { role: 'GW2', y: 2.6, dz: height },
    { role: 'A', y: -6.0, dz: height - 6.5 },
    { role: 'B', y: 0, dz: height - 9.5 },
    { role: 'C', y: 6.0, dz: height - 6.5 },
  ];
  return {
    form: 'strain',
    name: `耐张塔 ${height}m`,
    height,
    baseWidth: 9.5,
    crossArms: [
      { dz: height, halfWidth: 3.0 },
      { dz: height - 6.5, halfWidth: 6.8 },
      { dz: height - 9.5, halfWidth: 2.4 },
    ],
    attachments,
  };
}

export const TOWER_TEMPLATES: Record<TowerForm, (h: number) => TowerTemplate> = {
  cathead,
  cup,
  strain,
};

export function getTemplate(form: TowerForm, height: number): TowerTemplate {
  return TOWER_TEMPLATES[form](height);
}

/** 取塔某角色挂点(覆盖优先) */
export function attachmentOf(
  form: TowerForm,
  height: number,
  role: string,
  override?: { y: number; dz: number },
): { y: number; dz: number } {
  if (override) return override;
  const tpl = getTemplate(form, height);
  const a = tpl.attachments.find((x) => x.role === role);
  if (!a) throw new Error(`模板缺少挂点 ${role}`);
  return { y: a.y, dz: a.dz };
}
