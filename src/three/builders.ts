import * as THREE from 'three';
import type { Crossing, LineData, Tower, TowerTemplate } from '../types';
import { getTemplate } from '../data/towerTemplates';

/**
 * 地形: 中线纵断面 + 左右边线拉成条带网格
 */
export function buildTerrain(line: LineData): THREE.Mesh {
  const halfW = line.corridorWidth / 2;
  const n = line.terrain.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  const low = new THREE.Color(0x3d5a3f);
  const high = new THREE.Color(0x6b7d55);
  let minZ = Infinity;
  let maxZ = -Infinity;
  line.terrain.forEach((t) => {
    minZ = Math.min(minZ, t.centerZ);
    maxZ = Math.max(maxZ, t.centerZ);
  });

  line.terrain.forEach((t) => {
    positions.push(t.mileage, -halfW, t.leftZ);
    positions.push(t.mileage, 0, t.centerZ);
    positions.push(t.mileage, halfW, t.rightZ);
    const k = (t.centerZ - minZ) / Math.max(1, maxZ - minZ);
    const col = low.clone().lerp(high, k);
    for (let i = 0; i < 3; i++) colors.push(col.r, col.g, col.b);
  });

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      const b = a + 1;
      const c = (i + 1) * 3 + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function beam(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  mat: THREE.Material,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r * 0.7, r, len, 6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  mesh.castShadow = true;
  return mesh;
}

/**
 * 程序化杆塔: 四棱锥桁架塔身 + 横担 + 挂点球
 */
export function buildTower(tower: Tower): THREE.Group {
  const tpl: TowerTemplate = getTemplate(tower.form, tower.height);
  const g = new THREE.Group();
  g.position.set(tower.mileage, 0, tower.groundZ);
  g.name = tower.no;

  const steelMat = new THREE.MeshStandardMaterial({
    color: tower.kind === 'strain' ? 0xb8c4d4 : 0x9fb0c6,
    roughness: 0.45,
    metalness: 0.6,
    emissive: new THREE.Color(0x2a3548),
    emissiveIntensity: 0.35,
  });

  const H = tpl.height;
  const bw = tpl.baseWidth;
  const levels = 6;
  // 四条主腿
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const ringAt = (level: number) => {
    const z = (H * level) / levels;
    const w = bw * 0.5 * (1 - (level / levels) * 0.82);
    return corners.map(([sy, sz]) => new THREE.Vector3(0, sy * w, z));
  };
  for (let lv = 0; lv < levels; lv++) {
    const r0 = ringAt(lv);
    const r1 = ringAt(lv + 1);
    for (let c = 0; c < 4; c++) {
      g.add(beam(r0[c], r1[c], 0.22, steelMat));
      // 斜材
      g.add(beam(r0[c], r1[(c + 1) % 4], 0.09, steelMat));
    }
    // 横材
    for (let c = 0; c < 4; c++) {
      g.add(beam(r1[c], r1[(c + 1) % 4], 0.1, steelMat));
    }
  }

  // 横担
  for (const arm of tpl.crossArms) {
    const len = arm.halfWidth;
    const z = arm.dz;
    g.add(
      beam(
        new THREE.Vector3(0, -len, z),
        new THREE.Vector3(0, len, z),
        0.28,
        steelMat,
      ),
    );
    // 横担斜撑
    g.add(beam(new THREE.Vector3(0, -len, z), new THREE.Vector3(0, 0, z + 2.2), 0.12, steelMat));
    g.add(beam(new THREE.Vector3(0, len, z), new THREE.Vector3(0, 0, z + 2.2), 0.12, steelMat));
  }

  // 挂点球
  const attachMat = new THREE.MeshStandardMaterial({
    color: 0xff9f43,
    emissive: 0x553311,
    roughness: 0.4,
  });
  for (const a of tpl.attachments) {
    const ov = tower.attachmentOverrides?.[a.role];
    const y = ov?.y ?? a.y;
    const dz = ov?.dz ?? a.dz;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      attachMat,
    );
    sphere.position.set(0, y, dz);
    g.add(sphere);
  }

  // 塔号标牌(小方块 + 用 label 系统展示)
  const tag = new THREE.Mesh(
    new THREE.BoxGeometry(3, 1.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1c2940 }),
  );
  tag.position.set(0, 0, H + 2.5);
  g.add(tag);

  return g;
}

/** 跨越物建模 */
export function buildCrossing(cr: Crossing): THREE.Group {
  const g = new THREE.Group();
  g.position.set(cr.mileage, 0, 0);
  g.name = cr.name;

  if (cr.kind === 'road') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 });
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(cr.width, cr.lateralWidth ?? 12, 0.4),
      mat,
    );
    road.position.set(0, 0, cr.z);
    road.receiveShadow = true;
    g.add(road);
    // 车道线
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
    for (let i = -2; i <= 2; i++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 0.05), lineMat);
      dash.position.set(i * 4, 0, cr.z + 0.24);
      g.add(dash);
    }
  } else if (cr.kind === 'line10kv') {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c4a38 });
    const topZ = cr.z + (cr.poleHeight ?? 10);
    const halfY = (cr.lateralWidth ?? 8) / 2;
    for (const y of [-halfY, halfY]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.25, cr.poleHeight ?? 10, 8),
        poleMat,
      );
      pole.position.set(0, y, cr.z + (cr.poleHeight ?? 10) / 2);
      g.add(pole);
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 2.4, 0.3),
        poleMat,
      );
      arm.position.set(0, y, topZ);
      g.add(arm);
    }
    // 10kV 导线(水平线)
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (const y of [-halfY, 0, halfY]) {
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, cr.width + 4, 6),
        wireMat,
      );
      wire.rotation.z = Math.PI / 2;
      wire.position.set(0, y, topZ);
      g.add(wire);
    }
  } else {
    // 民房
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8a88e });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a4b3a });
    const w = cr.lateralWidth ?? 10;
    const house = new THREE.Mesh(new THREE.BoxGeometry(cr.width, w, 5), wallMat);
    house.position.set(0, 0, cr.z + 2.5);
    house.castShadow = true;
    g.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, 2.5, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 0, cr.z + 6.2);
    g.add(roof);
  }
  return g;
}
