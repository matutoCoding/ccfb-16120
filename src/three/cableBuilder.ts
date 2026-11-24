import * as THREE from 'three';
import type { CableCurve3D } from '../physics/galloping';
import { iceSection, taperedIce, type IceShape } from '../physics/iceSection';

/**
 * 沿世界坐标曲线扫掠成管
 * - 无冰: 等半径圆管(导线)
 * - 有冰: 每采样站生成冰截面环(新月形/翼形), 截面沿档渐变, 各档冰厚不同
 * 帧架: x 轴沿导线切线, 迎风方向取世界 +y
 */
export function buildSweptTube(opts: {
  curve: CableCurve3D;
  radius: number; // 导线半径 m
  iceThickness: (mileage: number, pointIndex: number) => number; // 各点冰厚 m
  shape: IceShape;
  radialSegments?: number;
  colorBase?: number;
  colorIce?: number;
}): THREE.Mesh {
  const { curve, radius } = opts;
  const radial = opts.radialSegments ?? 12;
  const pts = curve.points;
  const n = pts.length;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const baseColor = new THREE.Color(opts.colorBase ?? 0x3a3f45);
  const iceColor = new THREE.Color(opts.colorIce ?? 0xbfe4ff);

  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const worldY = new THREE.Vector3(0, 1, 0);
  const worldZ = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(n - 1, i + 1)];
    xAxis.set(pNext.x - pPrev.x, pNext.y - pPrev.y, pNext.z - pPrev.z).normalize();
    // 截面 y 轴: 世界 y 在法平面上的投影(横向, 即迎风方向)
    yAxis.copy(worldY).addScaledVector(xAxis, -worldY.dot(xAxis));
    if (yAxis.lengthSq() < 1e-8) yAxis.set(0, 1, 0);
    yAxis.normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();

    const ice = opts.iceThickness(p.x, i);
    const ring = ice > 0.0005 ? iceSection(radius, ice, opts.shape, radial) : null;

    for (let j = 0; j <= radial; j++) {
      let ry: number;
      let rz: number;
      let isIce: boolean;
      if (ring) {
        const rp = ring.outer[j];
        ry = rp.y;
        rz = rp.z;
        isIce = true;
      } else {
        const theta = (2 * Math.PI * j) / radial;
        ry = radius * Math.cos(theta);
        rz = radius * Math.sin(theta);
        isIce = false;
      }
      positions.push(
        p.x + yAxis.x * ry + zAxis.x * rz,
        p.y + yAxis.y * ry + zAxis.y * rz,
        p.z + yAxis.z * ry + zAxis.z * rz,
      );
      const col = isIce ? iceColor : baseColor;
      colors.push(col.r, col.g, col.b);
    }
  }

  const ringVerts = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ringVerts + j;
      const b = a + ringVerts;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false; // 大量线缆时关闭阴影保性能
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 间隔棒: 沿曲线按次档距布置, 分裂导线用框架环
 */
export function buildSpacers(opts: {
  curve: CableCurve3D; // 取分裂中心曲线(任一根子线近似)
  subSpans?: number[];
  totalLength: number;
  bundleSpacing: number; // m
  mileageStart: number;
}): THREE.InstancedMesh {
  const { curve, totalLength, bundleSpacing, mileageStart } = opts;
  // 次档距: 未指定则均布 8 个间隔棒
  let positions: number[] = [];
  if (opts.subSpans && opts.subSpans.length > 1) {
    let acc = 0;
    for (let i = 0; i < opts.subSpans.length - 1; i++) {
      acc += opts.subSpans[i];
      positions.push(acc);
    }
  } else {
    const count = Math.max(2, Math.round(totalLength / 50));
    for (let i = 1; i <= count; i++) positions.push((totalLength * i) / (count + 1));
  }

  const geo = new THREE.TorusGeometry(bundleSpacing * 0.72, 0.05, 6, 18);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    roughness: 0.4,
    metalness: 0.6,
  });
  const inst = new THREE.InstancedMesh(geo, mat, positions.length);
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3();

  positions.forEach((u, idx) => {
    // 找曲线上最近点
    const targetX = mileageStart + u;
    let pi = 0;
    let best = Infinity;
    for (let i = 0; i < curve.points.length; i++) {
      const d = Math.abs(curve.points[i].x - targetX);
      if (d < best) {
        best = d;
        pi = i;
      }
    }
    const p = curve.points[pi];
    const pPrev = curve.points[Math.max(0, pi - 1)];
    const pNext = curve.points[Math.min(curve.points.length - 1, pi + 1)];
    xAxis.set(pNext.x - pPrev.x, pNext.y - pPrev.y, pNext.z - pPrev.z).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize().cross(xAxis);
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    quat.setFromRotationMatrix(m);
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), quat, scale);
    inst.setMatrixAt(idx, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/** 悬垂串(绝缘子): 竖挂圆柱串, 可带偏角 */
export function buildInsulatorString(opts: {
  top: THREE.Vector3;
  length: number;
  angleLong: number;
  angleTrans: number;
}): THREE.Group {
  const g = new THREE.Group();
  const { top, length, angleLong, angleTrans } = opts;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc8d4e4,
    roughness: 0.3,
    metalness: 0.1,
  });
  // 盘式绝缘子叠片
  const discs = Math.max(6, Math.round(length / 0.28));
  for (let i = 0; i < discs; i++) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.09, 10),
      mat,
    );
    disc.position.y = -(length * (i + 0.5)) / discs;
    g.add(disc);
  }
  g.position.copy(top);
  g.rotation.z = -angleLong;
  g.rotation.x = angleTrans;
  return g;
}

/** 渐变冰厚函数生成器: 每档独立冰厚, 档内正弦渐变 */
export function makeIceFn(
  spans: { mileageStart: number; mileageEnd: number; ice: number }[],
): (mileage: number) => number {
  return (mileage: number) => {
    for (const sp of spans) {
      if (mileage >= sp.mileageStart - 0.5 && mileage <= sp.mileageEnd + 0.5) {
        const s =
          (mileage - sp.mileageStart) /
          Math.max(1e-6, sp.mileageEnd - sp.mileageStart);
        return taperedIce(Math.min(1, Math.max(0, s)), sp.ice / 1000);
      }
    }
    return 0;
  };
}
