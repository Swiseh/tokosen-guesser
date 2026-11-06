import * as THREE from 'three';
import { buildTerrainMesh, worldOrigin, type TerrainMeshData } from './mesh';
import type { Heightmap } from './terrain';
import { sampleMeshHeight } from './terrain';

export interface ViewSettings {
  /** 目線の高さ（地面から） [m] */
  eyeHeight: number;
  /** 視程 [m]。この距離で霧がおよそ 95% になる */
  visibility: number;
}

/** 垂直画角の初期値 [度] */
const DEFAULT_FOV = 75;
const SKY_TOP = new THREE.Color('#5d8ccc');
const SKY_HORIZON = new THREE.Color('#c9d8e6');

const terrainVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vWorld = position;
    vNormal = normal;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const terrainFrag = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float slope = 1.0 - n.y;
    vec2 p = vWorld.xz;
    // 色むら（大中小のスケール）。地形の形には影響させない
    float var = vnoise(p * 0.004) * 0.5 + vnoise(p * 0.03) * 0.3 + vnoise(p * 0.25) * 0.2;

    // sRGB で指定してリニアに変換（出力時に colorspace_fragment で sRGB に戻る）
    vec3 forest = pow(vec3(0.20, 0.30, 0.16), vec3(2.2));
    vec3 meadow = pow(vec3(0.40, 0.46, 0.26), vec3(2.2));
    vec3 rock   = pow(vec3(0.50, 0.48, 0.44), vec3(2.2));
    vec3 col = mix(forest, meadow, smoothstep(0.35, 0.75, var));
    col = mix(col, rock, smoothstep(0.30, 0.55, slope + (var - 0.5) * 0.15));
    col *= 0.85 + 0.3 * vnoise(p * 1.3);

    float diffuse = max(dot(n, sunDir), 0.0);
    float ambient = 0.30 + 0.20 * n.y;
    col *= ambient + diffuse * 0.85;

    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-pow(dist * fogDensity, 1.5));
    gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // 常に最遠に描く
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  varying vec3 vDir;
  void main() {
    float t = clamp(normalize(vDir).y, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizon, top, pow(t, 0.6)), 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * 目線の高さの3Dビュー。ドラッグで見回し、ホイールで画角（ズーム）を変える。
 * ワールド座標：x=東、z=南、y=標高 [m]。原点は地図範囲の中心。
 */
export class Viewer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 1, 60000);
  private controls = { pan: true, zoom: true };
  private terrain: THREE.Mesh | null = null;
  private sky: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private hm: Heightmap | null = null;
  private origin = { col: 0, row: 0 };
  private pos = { col: 0, row: 0 };
  private dirty = true;
  private settings: ViewSettings = { eyeHeight: 1.7, visibility: 8000 };

  /** 向き [rad]。北=0、時計回り */
  yaw = 0;
  /** 仰角 [rad]。上が正 */
  pitch = 0;

  onViewChange?: () => void;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';

    this.material = new THREE.ShaderMaterial({
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
      uniforms: {
        // 太陽は高めに置き、陰影で方角が分かりすぎないようにする
        sunDir: { value: new THREE.Vector3(-0.35, 0.85, 0.4).normalize() },
        fogColor: { value: SKY_HORIZON.clone() },
        fogDensity: { value: 0 },
      },
    });

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.setupControls();
    new ResizeObserver(() => this.resize()).observe(container);
    this.applySettings();
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  /** 見回し（ドラッグ）と拡大・縮小（ホイール）を許可するか。NMPZ では出題中どちらも禁止 */
  setControls(c: { pan: boolean; zoom: boolean }) {
    this.controls = c;
    this.renderer.domElement.classList.toggle('locked', !c.pan);
  }

  private turnAnim = 0;

  /**
   * 指定した向きへなめらかに回る（近い方向に回る）。見回しが禁止されているときは何もしない。
   * 途中でドラッグされたら中断する。
   */
  turnTo(targetYaw: number, durationMs = 450) {
    if (!this.controls.pan) return;
    cancelAnimationFrame(this.turnAnim);
    const from = this.yaw;
    const TAU = Math.PI * 2;
    // -π〜π の範囲の差にして、短い方向へ回る
    const delta = ((((targetYaw - from) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      this.yaw = (((from + delta * e) % TAU) + TAU) % TAU;
      this.pitch *= 1 - e * 0.2; // ついでに水平に近づける
      this.updateCamera();
      if (t < 1) this.turnAnim = requestAnimationFrame(step);
    };
    this.turnAnim = requestAnimationFrame(step);
  }

  /** 画角を初期値に戻す */
  resetZoom() {
    this.camera.fov = DEFAULT_FOV;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  /** 水平画角 [rad] */
  get hfov() {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    return 2 * Math.atan(Math.tan(v / 2) * this.camera.aspect);
  }

  get position() {
    return { ...this.pos };
  }

  setSettings(s: Partial<ViewSettings>) {
    this.settings = { ...this.settings, ...s };
    this.applySettings();
    this.updateCamera();
  }

  /** mesh は Worker で作ったものを渡す。省略時はここで作る */
  setTerrain(hm: Heightmap, mesh: TerrainMeshData = buildTerrainMesh(hm)) {
    this.hm = hm;
    this.origin = worldOrigin(hm);
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    this.terrain = new THREE.Mesh(g, this.material);
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);
    this.dirty = true;
  }

  setViewpoint(col: number, row: number, yaw?: number) {
    cancelAnimationFrame(this.turnAnim);
    this.pos = { col, row };
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
    this.updateCamera();
  }

  private applySettings() {
    // exp(-(d*k)^1.5) が 0.05 になる距離 = 視程
    this.material.uniforms.fogDensity.value = Math.pow(3.0, 1 / 1.5) / this.settings.visibility;
    this.dirty = true;
  }

  private updateCamera() {
    if (!this.hm) return;
    const { col, row } = this.pos;
    const mpp = this.hm.metersPerPixel;
    const ground = sampleMeshHeight(this.hm, col, row);
    this.camera.position.set((col - this.origin.col) * mpp, ground + this.settings.eyeHeight, (row - this.origin.row) * mpp);
    this.camera.rotation.set(this.pitch, -this.yaw, 0);
    this.sky.position.copy(this.camera.position);
    this.dirty = true;
    this.onViewChange?.();
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.onViewChange?.();
  }

  private setupControls() {
    const el = this.renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    el.addEventListener('pointerdown', (e) => {
      if (!this.controls.pan) return;
      cancelAnimationFrame(this.turnAnim);
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging || !this.controls.pan) return;
      // 画角に比例した感度（ズーム時に回りすぎない）
      const k = THREE.MathUtils.degToRad(this.camera.fov) / el.clientHeight;
      this.yaw = (this.yaw - (e.clientX - lastX) * k + Math.PI * 4) % (Math.PI * 2);
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - lastY) * k, -1.4, 1.4);
      lastX = e.clientX;
      lastY = e.clientY;
      this.updateCamera();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.controls.zoom) return;
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * Math.exp(e.deltaY * 0.001), 15, 90);
        this.camera.updateProjectionMatrix();
        this.updateCamera();
      },
      { passive: false },
    );
  }
}

