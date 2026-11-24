import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneLabel {
  id: string;
  pos: THREE.Vector3;
  text: string;
  danger?: boolean;
  el?: HTMLDivElement;
}

/**
 * three.js 场景管理: 渲染循环、相机控制、HTML 标签投影、截图
 */
export class SceneManager {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  labels: SceneLabel[] = [];
  labelLayer: HTMLDivElement;
  private raf = 0;
  private container: HTMLElement;
  private resizeObs: ResizeObserver;
  private frameCallbacks = new Set<() => void>();
  private tmpV = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true, // 截图需要
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a101a);
    this.scene.fog = new THREE.Fog(0x0a101a, 900, 3200);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.5, 8000);
    // 本项目 z 轴为高程(竖直), 统一 z-up, 保证近景杆塔直立
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(120, 260, 180);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 2500;

    // 光照
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a3445, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(-300, 600, 250);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 800;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 2200;
    this.scene.add(sun);

    // 标签层
    this.labelLayer = document.createElement('div');
    this.labelLayer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(this.labelLayer);

    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(container);

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  addFrameCallback(fn: () => void): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  setLabels(labels: SceneLabel[]): void {
    this.labels = labels;
    this.labelLayer.innerHTML = '';
    for (const lab of labels) {
      const el = document.createElement('div');
      el.className = 'hud-label' + (lab.danger ? ' bad' : '');
      el.textContent = lab.text;
      this.labelLayer.appendChild(el);
      lab.el = el;
    }
  }

  clearLabels(): void {
    this.labels = [];
    this.labelLayer.innerHTML = '';
  }

  /** 沿线路飞行: 里程位置 */
  flyToMileage(x: number, y: number, z: number, lookAhead = 120): void {
    this.camera.position.set(x - lookAhead * 0.4, z + 90, y + 160);
    this.controls.target.set(x + lookAhead * 0.3, z + 20, y);
    this.controls.update();
  }

  /** 锁定某一档侧面视角(沿横向 y 轴看线路纵断面), z 传导线挂点高程 */
  sideView(xCenter: number, z: number, spanLen: number): void {
    const dist = Math.max(spanLen * 0.9, 150);
    this.controls.target.set(xCenter, 0, z);
    this.camera.position.set(xCenter, dist, z);
    this.camera.lookAt(xCenter, 0, z);
    this.controls.update();
  }

  fitAll(center: THREE.Vector3, size: THREE.Vector3): void {
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.25;
    // z-up: 主要在横(y)向与竖(z)向拉开, 纵向(x)略偏形成透视
    this.camera.position.set(
      center.x + dist * 0.45,
      center.y + dist * 0.8,
      center.z + dist * 0.55,
    );
    this.controls.target.copy(center);
    this.controls.update();
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private updateLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const lab of this.labels) {
      if (!lab.el) continue;
      this.tmpV.copy(lab.pos).project(this.camera);
      if (this.tmpV.z > 1) {
        lab.el.style.display = 'none';
        continue;
      }
      lab.el.style.display = 'block';
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      lab.el.style.left = `${sx}px`;
      lab.el.style.top = `${sy}px`;
    }
  }

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.frameCallbacks.forEach((fn) => fn());
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}
