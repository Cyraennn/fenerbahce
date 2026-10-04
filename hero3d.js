/**
 * Fenerbahçe — Hero 3D sahnesi (Three.js)
 * ----------------------------------------
 * Sarı-lacivert spiral galaksi, parlayan halkalar ve süzülen toz.
 * Fare ile paralaks, kaydırma ile derinlik. Hero görünmüyorsa çizim durur.
 */
"use strict";

(() => {
  const canvas = document.getElementById("heroCanvas");
  if (!canvas || typeof THREE === "undefined") return;

  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return; // WebGL yoksa CSS arka planı yeterli
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x061229, 0.035);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 3.2, 10);

  /** Yumuşak, yuvarlak parçacık dokusu */
  const makeDotTexture = () => {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  };
  const dot = makeDotTexture();

  /* --- Spiral galaksi ------------------------------------------------- */
  const galaxy = (() => {
    const COUNT = 9000;
    const ARMS = 3;
    const RADIUS = 9;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const inner = new THREE.Color(0xffed00);
    const outer = new THREE.Color(0x3d6fd6);
    const white = new THREE.Color(0xffffff);

    for (let i = 0; i < COUNT; i++) {
      const r = Math.pow(Math.random(), 1.6) * RADIUS;
      const arm = ((i % ARMS) / ARMS) * Math.PI * 2;
      const spin = r * 0.75;
      const spread = (axis) => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1) * 0.6 * (axis === "y" ? 0.4 : 1) * (1 + r * 0.15);

      positions[i * 3] = Math.cos(arm + spin) * r + spread("x");
      positions[i * 3 + 1] = spread("y");
      positions[i * 3 + 2] = Math.sin(arm + spin) * r + spread("z");

      const color = inner.clone().lerp(outer, r / RADIUS);
      if (Math.random() < 0.08) color.copy(white);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.075,
      map: dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.rotation.x = 0.35;
    points.position.set(3.2, -0.6, 0);
    return points;
  })();
  scene.add(galaxy);

  /* --- Parlayan halkalar ------------------------------------------------ */
  const rings = new THREE.Group();
  [
    { r: 2.1, color: 0xffed00, opacity: 0.9, tube: 0.025 },
    { r: 2.6, color: 0x5b8cff, opacity: 0.5, tube: 0.015 },
    { r: 3.3, color: 0xffed00, opacity: 0.35, tube: 0.01 },
  ].forEach(({ r, color, opacity, tube }, i) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 16, 160),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.rotation.x = Math.PI / 2 + i * 0.25;
    mesh.rotation.y = i * 0.4;
    rings.add(mesh);
  });

  // Merkezde yüzen tel kafes küre
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshBasicMaterial({ color: 0xffed00, wireframe: true, transparent: true, opacity: 0.35 })
  );
  rings.add(core);

  const coreGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: dot,
      color: 0xffed00,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  coreGlow.scale.set(6, 6, 1);
  rings.add(coreGlow);

  rings.position.copy(galaxy.position);
  rings.rotation.x = 0.35;
  scene.add(rings);

  /* --- Süzülen toz ----------------------------------------------------- */
  const dust = (() => {
    const COUNT = 700;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.06,
        map: dot,
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
  })();
  scene.add(dust);

  /* --- Etkileşim ------------------------------------------------------- */
  const mouse = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  let scrollFactor = 0;
  let burst = prefersReducedMotion ? 1 : 0; // Açılışta galaksi "doğar"
  let burstTarget = burst;

  window.addEventListener("pointermove", (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
  });

  window.addEventListener(
    "scroll",
    () => {
      scrollFactor = Math.min(window.scrollY / window.innerHeight, 1.5);
    },
    { passive: true }
  );

  document.addEventListener("fb:intro-done", () => (burstTarget = 1));
  // Jenerik herhangi bir nedenle gecikirse yine de başla
  setTimeout(() => (burstTarget = 1), 6000);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Dar ekranda galaksiyi ortala
    const narrow = w < 760;
    galaxy.position.x = rings.position.x = narrow ? 0 : 3.2;
    camera.fov = narrow ? 70 : 55;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  /* --- Döngü ----------------------------------------------------------- */
  const clock = new THREE.Clock();
  let running = false;
  let raf = 0;

  const render = () => {
    const t = clock.getElapsedTime();

    burst += (burstTarget - burst) * 0.025;
    smooth.x += (mouse.x - smooth.x) * 0.05;
    smooth.y += (mouse.y - smooth.y) * 0.05;

    const s = 0.001 + burst;
    galaxy.scale.setScalar(s);
    rings.scale.setScalar(s);

    galaxy.rotation.y = t * 0.05 + (1 - burst) * 4 + scrollFactor * 0.8;
    rings.children[0].rotation.z = t * 0.6;
    rings.children[1].rotation.z = -t * 0.4;
    rings.children[2].rotation.z = t * 0.25;
    core.rotation.x = t * 0.3;
    core.rotation.y = t * 0.45;
    coreGlow.material.opacity = 0.45 + Math.sin(t * 2) * 0.12;
    dust.rotation.y = t * 0.01;
    dust.position.y = Math.sin(t * 0.2) * 0.5;

    camera.position.x = smooth.x * 1.6;
    camera.position.y = 3.2 - smooth.y * 1.1 + scrollFactor * 2;
    camera.position.z = 10 + scrollFactor * 4;
    camera.lookAt(galaxy.position.x * 0.5, 0, 0);

    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(render);
  };

  const start = () => {
    if (running || prefersReducedMotion) return;
    running = true;
    raf = requestAnimationFrame(render);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  if (prefersReducedMotion) {
    render();
    return;
  }

  // Hero ekranda değilse GPU'yu yorma
  let visible = true;
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && !document.hidden) start();
    else stop();
  }).observe(canvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  start();
})();
