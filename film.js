/**
 * Fenerbahçe — "Bir Asrın Filmi" (gerçek zamanlı 3D film)
 * ----------------------------------------
 * Three.js ile 5 sahnelik 44 saniyelik bir film üretir:
 *   1) Deniz feneri (1907)  2) Stadyum  3) Kupalar  4) Avrupa  5) Final
 * WebGL görüntüsü 2D tuvalde altyazı, sinema şeridi, vinyet ve grenle
 * birleştirilir. WebAudio ile müzik/tribün sesi üretilir.
 * "Videoyu Kaydet" → MediaRecorder ile .webm olarak indirilir.
 */
"use strict";

(() => {
  const player = document.getElementById("filmPlayer");
  const out = document.getElementById("filmCanvas");
  if (!player || !out) return;

  const fallback = document.getElementById("filmFallback");
  const bigPlay = document.getElementById("filmBigPlay");
  const playBtn = document.getElementById("filmPlay");
  const muteBtn = document.getElementById("filmMute");
  const recBtn = document.getElementById("filmRecord");
  const fullBtn = document.getElementById("filmFull");
  const recBadge = document.getElementById("filmRec");
  const timeEl = document.getElementById("filmTime");
  const progress = document.getElementById("filmProgress");
  const progressFill = document.getElementById("filmProgressFill");
  const chaptersEl = document.getElementById("filmChapters");

  const showFallback = () => {
    fallback.hidden = false;
    bigPlay.hidden = true;
    player.querySelector(".film-controls").hidden = true;
  };

  if (typeof THREE === "undefined") {
    showFallback();
    return;
  }

  const W = 1280;
  const H = 720;
  const DURATION = 44;
  const BAR = 54; // sinema şeridi yüksekliği (px)
  const FONT_URL =
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_bold.typeface.json";

  const CHAPTERS = [
    { t: 0, label: "Fener" },
    { t: 8, label: "Stadyum" },
    { t: 18, label: "Kupalar" },
    { t: 28, label: "Avrupa" },
    { t: 36, label: "Final" },
  ];

  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Yardımcılar ------------------------------------------------------ */
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => {
    const k = clamp((x - a) / (b - a), 0, 1);
    return k * k * (3 - 2 * k);
  };
  const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

  /** Tohumlu rastgele sayı üreteci: film her oynatmada aynı görünür. */
  const seeded = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const rand = seeded(1907);

  /** Kare bazlı, tekrarlanabilir gürültü (0..1) */
  const hash = (i, f) => {
    const x = Math.sin(i * 12.9898 + f * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  const canvasTex = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  };

  const dot = canvasTex(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
  dot.encoding = THREE.LinearEncoding;

  const glow = (color, scale, opacity = 1) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dot,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sprite.scale.set(scale, scale, 1);
    return sprite;
  };

  const additive = (color, opacity) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  /** Tepesi orijinde, +X yönüne bakan ışık huzmesi konisi */
  const beamGeometry = (radius, length) => {
    const g = new THREE.ConeGeometry(radius, length, 32, 1, true);
    g.translate(0, -length / 2, 0);
    g.rotateZ(Math.PI / 2);
    return g;
  };

  const starField = (count, radius, size, upperOnly) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * Math.PI * 2;
      const v = upperOnly ? rand() * 0.9 + 0.05 : rand() * 2 - 1;
      const r = Math.sqrt(1 - v * v);
      positions[i * 3] = Math.cos(u) * r * radius;
      positions[i * 3 + 1] = v * radius;
      positions[i * 3 + 2] = Math.sin(u) * r * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size,
        map: dot,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
  };

  /* --- Render altyapısı -------------------------------------------------- */
  const glCanvas = document.createElement("canvas");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
  } catch {
    showFallback();
    return;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const ctx = out.getContext("2d");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1500);
  scene.add(new THREE.HemisphereLight(0x9db8ff, 0x0a1f44, 0.55));

  /* Metal kupalar için ortam yansıması (PMREM) */
  const envTex = (() => {
    const env = new THREE.Scene();
    env.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(50, 32, 16),
        new THREE.MeshBasicMaterial({ color: 0x0a1f44, side: THREE.BackSide })
      )
    );
    const panel = (color, intensity, w, h, x, y, z) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
        })
      );
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      env.add(mesh);
    };
    panel(0xffffff, 6, 60, 12, 0, 40, 0);
    panel(0xffed00, 4, 20, 40, 34, 8, 0);
    panel(0x4f7dff, 1.1, 20, 30, -34, 6, 12);
    panel(0xffffff, 3, 40, 10, 0, 12, -36);
    panel(0xffb347, 3.5, 30, 10, 0, -20, 30);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    return tex;
  })();

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffb21f,
    metalness: 1,
    roughness: 0.24,
    envMap: envTex,
    envMapIntensity: 1.3,
  });

  const navyMetal = new THREE.MeshStandardMaterial({
    color: 0x0a1f44,
    metalness: 0.6,
    roughness: 0.35,
    envMap: envTex,
  });

  /* ======================================================================
   * SAHNE 1 — Deniz Feneri (0–8 sn)
   * ==================================================================== */
  const sceneFener = (() => {
    const group = new THREE.Group();

    group.add(starField(1600, 400, 1.6, true));
    const moon = glow(0xfff1c4, 90, 0.9);
    moon.position.set(-160, 90, -260);
    group.add(moon);
    const moonCore = glow(0xffffff, 26, 1);
    moonCore.position.copy(moon.position);
    group.add(moonCore);

    const moonLight = new THREE.DirectionalLight(0xbcd0ff, 0.9);
    moonLight.position.set(-160, 90, -260);
    group.add(moonLight);

    // Dalgalı deniz
    const seaGeo = new THREE.PlaneGeometry(420, 420, 110, 110);
    seaGeo.rotateX(-Math.PI / 2);
    const seaBase = seaGeo.attributes.position.array.slice();
    const sea = new THREE.Mesh(
      seaGeo,
      new THREE.MeshStandardMaterial({
        color: 0x0b2a5c,
        roughness: 0.32,
        metalness: 0.35,
        flatShading: true,
        envMap: envTex,
        envMapIntensity: 0.4,
      })
    );
    group.add(sea);

    // Kaya + fener kulesi
    const rock = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 5.2, 2.6, 9),
      new THREE.MeshStandardMaterial({ color: 0x1b2333, roughness: 0.95, flatShading: true })
    );
    rock.position.y = 0.6;
    group.add(rock);

    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.55 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x0a1f44, roughness: 0.5 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 1.18, 10, 32), white);
    tower.position.y = 6.9;
    group.add(tower);

    // Lacivert bantlar
    [4.2, 8.4].forEach((y) => {
      const k = (y - 1.9) / 10;
      const r = lerp(1.18, 0.78, k) + 0.03;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.04, r + 0.04, 1.1, 32), navy);
      band.position.y = y;
      group.add(band);
    });

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.18, 32), navy);
    gallery.position.y = 12;
    group.add(gallery);

    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 1.15, 24),
      new THREE.MeshStandardMaterial({ color: 0xffed00, emissive: 0xffed00, emissiveIntensity: 2.2 })
    );
    lamp.position.y = 12.65;
    group.add(lamp);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.95, 24), navy);
    cap.position.y = 13.7;
    group.add(cap);

    const lampLight = new THREE.PointLight(0xffe066, 3, 70, 2);
    lampLight.position.y = 12.65;
    group.add(lampLight);

    const lampGlow = glow(0xffed00, 9, 0.9);
    lampGlow.position.y = 12.65;
    group.add(lampGlow);

    // Dönen ışık huzmeleri
    const beams = new THREE.Group();
    beams.position.y = 12.65;
    [0, Math.PI].forEach((angle) => {
      const outer = new THREE.Mesh(beamGeometry(5, 90), additive(0xffed00, 0.13));
      const inner = new THREE.Mesh(beamGeometry(1.8, 70), additive(0xfff6b0, 0.2));
      const holder = new THREE.Group();
      holder.rotation.y = angle;
      holder.add(outer, inner);
      beams.add(holder);
    });
    group.add(beams);

    // Ay ışığının denizdeki yansıması
    const shimmer = glow(0xbcd0ff, 60, 0.18);
    shimmer.position.set(-60, 0.5, -100);
    shimmer.scale.set(30, 140, 1);
    group.add(shimmer);

    const update = (lt) => {
      const pos = seaGeo.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const x = seaBase[i];
        const z = seaBase[i + 2];
        pos[i + 1] =
          Math.sin(x * 0.08 + lt * 0.9) * 0.55 +
          Math.cos(z * 0.11 + lt * 1.2) * 0.45 +
          Math.sin((x + z) * 0.05 + lt * 0.5) * 0.4;
      }
      seaGeo.attributes.position.needsUpdate = true;
      seaGeo.computeVertexNormals();

      beams.rotation.y = 0.6 + lt * 1.05;
      lampGlow.material.opacity = 0.75 + Math.sin(lt * 6) * 0.15;

      const angle = 2.25 - lt * 0.1;
      const radius = 48 - lt * 3.3;
      camera.position.set(Math.cos(angle) * radius, 3 + lt * 0.95, Math.sin(angle) * radius);
      camera.lookAt(0, 7 + lt * 0.45, 0);
    };

    return {
      group, update, start: 0, end: 8,
      bg: 0x040b1c, fog: new THREE.FogExp2(0x040b1c, 0.009),
    };
  })();

  /* ======================================================================
   * SAHNE 2 — Stadyum (8–18 sn)
   * ==================================================================== */
  const sceneStadium = (() => {
    const group = new THREE.Group();

    group.add(starField(800, 500, 1.4, true));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 700),
      new THREE.MeshStandardMaterial({ color: 0x050a12, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    group.add(ground);

    // Saha
    const pitchTex = canvasTex(1050, 680, (g) => {
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? "#1f8a4c" : "#27a35a";
        g.fillRect(i * 75, 0, 75, 680);
      }
      g.strokeStyle = "rgba(255,255,255,0.92)";
      g.lineWidth = 5;
      g.strokeRect(20, 20, 1010, 640);
      g.beginPath();
      g.moveTo(525, 20);
      g.lineTo(525, 660);
      g.stroke();
      g.beginPath();
      g.arc(525, 340, 91.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeRect(20, 139, 165, 403);
      g.strokeRect(865, 139, 165, 403);
      g.strokeRect(20, 248, 55, 183);
      g.strokeRect(975, 248, 55, 183);
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(525, 340, 6, 0, Math.PI * 2);
      g.fill();
    });
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(105, 68),
      new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.85 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0.02;
    group.add(pitch);

    // Tribün kabuğu (eğimli oval)
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.0, 1, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0b1630, roughness: 0.8, side: THREE.DoubleSide })
    );
    shell.scale.set(58, 18, 41);
    shell.position.y = 9;
    group.add(shell);

    // Çatı ışık şeridi
    const roofCurve = new THREE.CatmullRomCurve3(
      Array.from({ length: 64 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * 84.5, 18.4, Math.sin(a) * 59.7);
      }),
      true
    );
    const roof = new THREE.Mesh(
      new THREE.TubeGeometry(roofCurve, 256, 0.5, 8, true),
      new THREE.MeshStandardMaterial({ color: 0xffed00, emissive: 0xffed00, emissiveIntensity: 1.6 })
    );
    group.add(roof);

    // Taraftarlar: 7 kat, sarı-lacivert koreografi
    const TIERS = 7;
    const PER_TIER = 2700;
    const COUNT = TIERS * PER_TIER;
    const crowdPos = new Float32Array(COUNT * 3);
    const crowdCol = new Float32Array(COUNT * 3);
    const baseCol = new Float32Array(COUNT * 3);
    const angles = new Float32Array(COUNT);
    const baseY = new Float32Array(COUNT);
    const yellow = new THREE.Color(0xffed00);
    const navyLight = new THREE.Color(0x2456b8);
    const whiteCol = new THREE.Color(0xffffff);

    for (let i = 0; i < COUNT; i++) {
      const tier = Math.floor(i / PER_TIER);
      const y = 1.4 + tier * 2.35 + (rand() - 0.5) * 0.6;
      const rx = 58 + (26 * y) / 18 - 0.9 + (rand() - 0.5) * 1.2;
      const rz = (rx * 41) / 58;
      const a = rand() * Math.PI * 2;
      angles[i] = a;
      baseY[i] = y;
      crowdPos[i * 3] = Math.cos(a) * rx;
      crowdPos[i * 3 + 1] = y;
      crowdPos[i * 3 + 2] = Math.sin(a) * rz;

      const segment = Math.floor((a / (Math.PI * 2)) * 24);
      const c = rand() < 0.05 ? whiteCol : segment % 2 ? yellow : navyLight;
      baseCol[i * 3] = c.r;
      baseCol[i * 3 + 1] = c.g;
      baseCol[i * 3 + 2] = c.b;
    }

    const crowdGeo = new THREE.BufferGeometry();
    crowdGeo.setAttribute("position", new THREE.BufferAttribute(crowdPos, 3));
    crowdGeo.setAttribute("color", new THREE.BufferAttribute(crowdCol, 3));
    const crowd = new THREE.Points(
      crowdGeo,
      new THREE.PointsMaterial({
        size: 0.85,
        map: dot,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      })
    );
    group.add(crowd);

    // Işık kuleleri
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a96aa, roughness: 0.6, metalness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 2.5 });
    const floodGlows = [];
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz]) => {
      const x = sx * 80;
      const z = sz * 60;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 44, 1.6), towerMat);
      tower.position.set(x, 22, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 1.2), headMat);
      head.position.set(x, 45, z);
      head.lookAt(0, 0, 0);
      const flare = glow(0xfff4c8, 46, 0.85);
      flare.position.set(x, 45, z);
      floodGlows.push(flare);
      group.add(tower, head, flare);

      const spot = new THREE.SpotLight(0xfff2d0, 1.3, 260, 0.5, 0.6, 1);
      spot.position.set(x, 45, z);
      spot.target.position.set(0, 0, 0);
      group.add(spot, spot.target);
    });

    // Tribün üstü kıvılcımlar (meşale efekti)
    const SPARKS = 480;
    const EMITTERS = 24;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkCol = new Float32Array(SPARKS * 3);
    const sparkSeed = Float32Array.from({ length: SPARKS }, () => rand());
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
    group.add(
      new THREE.Points(
        sparkGeo,
        new THREE.PointsMaterial({
          size: 0.55,
          map: dot,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    // Tribün dumanı
    const smokes = Array.from({ length: 14 }, (_, i) => {
      const s = glow(i % 2 ? 0xffed00 : 0x6f8fd8, 40 + rand() * 30, 0.08);
      const a = (i / 14) * Math.PI * 2;
      s.position.set(Math.cos(a) * 70, 20 + rand() * 6, Math.sin(a) * 50);
      s.userData.a = a;
      group.add(s);
      return s;
    });

    const update = (lt) => {
      const frame = Math.floor(lt * 12);
      for (let i = 0; i < COUNT; i++) {
        const wave = Math.pow(Math.max(0, Math.cos(angles[i] - lt * 1.9)), 14);
        crowdPos[i * 3 + 1] = baseY[i] + wave * 1.3;
        const flash = hash(i, frame) < 0.012 ? 1 : 0;
        const mix = Math.min(1, wave * 0.7 + flash);
        crowdCol[i * 3] = lerp(baseCol[i * 3], 1, mix);
        crowdCol[i * 3 + 1] = lerp(baseCol[i * 3 + 1], 1, mix);
        crowdCol[i * 3 + 2] = lerp(baseCol[i * 3 + 2], 1, mix);
      }
      crowdGeo.attributes.position.needsUpdate = true;
      crowdGeo.attributes.color.needsUpdate = true;

      for (let i = 0; i < SPARKS; i++) {
        const e = i % EMITTERS;
        const a = (e / EMITTERS) * Math.PI * 2 + 0.13;
        const age = ((lt * 0.7 + sparkSeed[i]) % 1) * 1.6;
        const spread = (hash(i, 3) - 0.5) * 3;
        sparkPos[i * 3] = Math.cos(a) * 82 + spread;
        sparkPos[i * 3 + 1] = 17 + age * 7 + Math.sin(age * 6 + i) * 0.4;
        sparkPos[i * 3 + 2] = Math.sin(a) * 58 + (hash(i, 7) - 0.5) * 3;
        const fade = Math.max(0, 1 - age / 1.6);
        sparkCol[i * 3] = 1 * fade;
        sparkCol[i * 3 + 1] = (0.55 + 0.4 * fade) * fade;
        sparkCol[i * 3 + 2] = 0.1 * fade;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;

      smokes.forEach((s, i) => {
        const a = s.userData.a + lt * 0.03;
        s.position.x = Math.cos(a) * 72;
        s.position.z = Math.sin(a) * 52;
        s.material.opacity = 0.06 + Math.sin(lt * 0.8 + i) * 0.03;
      });
      floodGlows.forEach((f, i) => (f.material.opacity = 0.8 + Math.sin(lt * 9 + i * 2) * 0.05));

      // Kamera: yukarıdan dalış, sonra tribün çevresinde tur
      if (lt < 3.5) {
        const k = smooth(0, 3.5, lt);
        camera.position.set(0, lerp(150, 34, k), lerp(240, 92, k));
        camera.lookAt(0, lerp(0, 4, k), 0);
      } else {
        const a = Math.PI / 2 + (lt - 3.5) * 0.22;
        const r = 92 - (lt - 3.5) * 3;
        camera.position.set(Math.cos(a) * r, 34 - (lt - 3.5) * 2.4, Math.sin(a) * r * 0.82);
        camera.lookAt(0, 4, 0);
      }
    };

    return {
      group, update, start: 8, end: 18,
      bg: 0x02060f, fog: new THREE.FogExp2(0x02060f, 0.0032),
    };
  })();

  /* ======================================================================
   * SAHNE 3 — Kupalar (18–28 sn)
   * ==================================================================== */
  const sceneTrophies = (() => {
    const group = new THREE.Group();

    const cupProfile = [
      [0, 0], [1.3, 0], [1.3, 0.3], [0.55, 0.45], [0.38, 0.7], [0.32, 1.5],
      [0.46, 1.75], [0.9, 2.05], [1.25, 2.6], [1.42, 3.3], [1.5, 3.95],
      [1.38, 4.02], [1.3, 3.4], [1.1, 2.75], [0, 2.45],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const cupGeo = new THREE.LatheGeometry(cupProfile, 72);
    const handleGeo = new THREE.TorusGeometry(0.62, 0.09, 12, 40, Math.PI);

    const makeTrophy = () => {
      const t = new THREE.Group();
      t.add(new THREE.Mesh(cupGeo, goldMat));
      [1, -1].forEach((side) => {
        const handle = new THREE.Mesh(handleGeo, goldMat);
        handle.position.set(side * 1.28, 3.0, 0);
        handle.rotation.z = -side * Math.PI / 2;
        t.add(handle);
      });
      return t;
    };

    const trophies = [];
    [
      { x: 0, z: 0, s: 1.25 },
      { x: -6.2, z: -1.8, s: 0.9 },
      { x: 6.2, z: -1.8, s: 0.9 },
    ].forEach(({ x, z, s }) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.05, 1.6, 48), navyMetal);
      pedestal.position.set(x, 0.8, z);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.82, 0.05, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0xffed00 })
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, 1.6, z);
      const trophy = makeTrophy();
      trophy.position.set(x, 1.6, z);
      trophy.scale.setScalar(s);
      trophies.push(trophy);
      group.add(pedestal, rim, trophy);

      const spot = new THREE.SpotLight(0xfff2c0, 4, 40, 0.32, 0.5, 1.2);
      spot.position.set(x, 18, z + 2);
      spot.target = trophy;
      group.add(spot);

      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 17, 32, 1, true), additive(0xfff2c0, 0.055));
      cone.position.set(x, 9.5, z);
      group.add(cone);
    });

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: 0x081325, metalness: 0.75, roughness: 0.3, envMap: envTex })
    );
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    // Zeminde ışık halkaları
    const floorRings = [4, 8, 12, 17, 23].map((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.08, 128),
        additive(i % 2 ? 0x4f7dff : 0xffed00, 0.5)
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      group.add(ring);
      return ring;
    });

    const rimLight = new THREE.PointLight(0x4f7dff, 2.5, 50);
    rimLight.position.set(-10, 6, -10);
    const warmLight = new THREE.PointLight(0xffd27a, 2, 50);
    warmLight.position.set(10, 8, 8);
    group.add(rimLight, warmLight);

    // Yükselen altın tozu
    const DUST = 1400;
    const dustPos = new Float32Array(DUST * 3);
    const dustBase = Float32Array.from({ length: DUST * 3 }, (_, i) =>
      i % 3 === 1 ? rand() * 16 : (rand() - 0.5) * 30
    );
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    group.add(
      new THREE.Points(
        dustGeo,
        new THREE.PointsMaterial({
          size: 0.12,
          map: dot,
          color: 0xffd84a,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    const update = (lt) => {
      trophies.forEach((t, i) => {
        t.rotation.y = lt * (i === 0 ? 0.5 : -0.4);
        t.position.y = 1.6 + Math.sin(lt * 1.4 + i) * 0.08;
      });
      floorRings.forEach((r, i) => (r.material.opacity = 0.25 + 0.25 * Math.sin(lt * 2 - i * 0.8)));

      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3] = dustBase[i * 3] + Math.sin(lt + i) * 0.3;
        dustPos[i * 3 + 1] = (dustBase[i * 3 + 1] + lt * 0.7) % 16;
        dustPos[i * 3 + 2] = dustBase[i * 3 + 2];
      }
      dustGeo.attributes.position.needsUpdate = true;

      const a = -0.7 + lt * 0.13;
      const r = 17 - lt * 0.6;
      camera.position.set(Math.sin(a) * r, 6.5 - lt * 0.2, Math.cos(a) * r);
      camera.lookAt(0, 3.4, 0);
    };

    return {
      group, update, start: 18, end: 28,
      bg: 0x040912, fog: new THREE.FogExp2(0x040912, 0.025),
    };
  })();

  /* ======================================================================
   * SAHNE 4 — Avrupa (28–36 sn)
   * ==================================================================== */
  const sceneEurope = (() => {
    const group = new THREE.Group();
    group.add(starField(2000, 300, 1.2, false));

    // Bulutsu
    for (let i = 0; i < 16; i++) {
      const colors = [0xffed00, 0x2a5bd7, 0x6a3fd0, 0x1d8fff];
      const s = glow(colors[i % 4], 50 + rand() * 60, 0.12 + rand() * 0.1);
      s.position.set((rand() - 0.5) * 160, (rand() - 0.5) * 80, -40 - rand() * 80);
      group.add(s);
    }

    const basketTex = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = "#d9682b";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = "#1a1210";
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      [0, w / 4, w / 2, (3 * w) / 4].forEach((x) => {
        g.moveTo(x, 0);
        g.lineTo(x, h);
      });
      g.stroke();
      [w / 4, (3 * w) / 4].forEach((c, k) => {
        g.beginPath();
        for (let y = 0; y <= h; y += 4) {
          const x = c + (k ? -1 : 1) * 150 * Math.sin((Math.PI * y) / h);
          if (y === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      });
    });

    const volleyTex = canvasTex(1024, 512, (g, w, h) => {
      const colors = ["#ffd400", "#ffffff", "#14306a", "#ffffff", "#ffd400", "#14306a"];
      colors.forEach((c, i) => {
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(0, (i * h) / 6);
        for (let x = 0; x <= w; x += 8) g.lineTo(x, (i * h) / 6 + Math.sin(x / 80) * 22);
        g.lineTo(w, h);
        g.lineTo(0, h);
        g.fill();
      });
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 4;
      for (let i = 1; i < 6; i++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = (i * h) / 6 + Math.sin(x / 80) * 22;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    });

    const footTex = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = "#f4f4f4";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#0a1f44";
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 9; col++) {
          const cx = col * 128 + (row % 2) * 64;
          const cy = row * 128;
          g.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
            g.lineTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34);
          }
          g.fill();
        }
      }
    });

    const balls = [basketTex, volleyTex, footTex].map((map, i) => {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(2.3, 64, 32),
        new THREE.MeshStandardMaterial({ map, roughness: i === 0 ? 0.75 : 0.45, envMap: envTex, envMapIntensity: 0.35 })
      );
      group.add(ball);
      return ball;
    });

    // Yıldız halkası
    const crown = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.TorusGeometry(9, 0.05, 8, 200), additive(0xffed00, 0.7));
    halo.rotation.x = Math.PI / 2;
    crown.add(halo);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const s = glow(0xffed00, 2.2, 1);
      s.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9);
      crown.add(s);
    }
    group.add(crown);

    const core = glow(0xffed00, 14, 0.6);
    group.add(core);
    const centerLight = new THREE.PointLight(0xffe27a, 2.6, 60);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(10, 14, 20);
    group.add(centerLight, key);

    const ballPos = (i, lt) => {
      const a = (i / 3) * Math.PI * 2 + lt * 0.22 - 0.4;
      return new THREE.Vector3(Math.cos(a) * 9, Math.sin(lt * 0.8 + i) * 0.8, Math.sin(a) * 9);
    };

    const update = (lt) => {
      balls.forEach((ball, i) => {
        ball.position.copy(ballPos(i, lt));
        ball.rotation.y = lt * (0.8 + i * 0.2);
        ball.rotation.x = lt * 0.3;
      });
      crown.rotation.y = -lt * 0.15;
      crown.rotation.z = Math.sin(lt * 0.5) * 0.15;
      core.material.opacity = 0.5 + Math.sin(lt * 3) * 0.1;

      // Odak: genel plan → basketbol topu → voleybol topu
      const wide = new THREE.Vector3(0, 0, 0);
      const k1 = smooth(0.2, 3.0, lt);
      const k2 = smooth(5.4, 6.8, lt);
      const focus = wide.clone().lerp(ballPos(0, lt), k1).lerp(ballPos(1, lt), k2);

      const orbit = lt * 0.35;
      const near = new THREE.Vector3(
        focus.x + Math.sin(orbit) * 7.5,
        focus.y + 2.2,
        focus.z + Math.cos(orbit) * 7.5
      );
      const far = new THREE.Vector3(Math.sin(lt * 0.1) * 6, 12, 36);
      camera.position.copy(far.lerp(near, k1));
      camera.lookAt(focus);
    };

    return {
      group, update, start: 28, end: 36,
      bg: 0x020818, fog: new THREE.FogExp2(0x020818, 0.006),
    };
  })();

  /* ======================================================================
   * SAHNE 5 — Final (36–44 sn)
   * ==================================================================== */
  const sceneFinale = (() => {
    const group = new THREE.Group();
    group.add(starField(1200, 300, 1.3, false));

    // Arkada dönen ışık huzmeleri (deniz fenerine selam)
    const rays = new THREE.Group();
    rays.position.set(0, 4, -12);
    for (let i = 0; i < 12; i++) {
      const ray = new THREE.Mesh(beamGeometry(4, 80), additive(i % 2 ? 0x4f7dff : 0xffed00, 0.07));
      ray.rotation.z = (i / 12) * Math.PI * 2;
      rays.add(ray);
    }
    group.add(rays);

    const textGroup = new THREE.Group();
    group.add(textGroup);

    // Yazı tipi yüklenemezse yedek: parlayan halka + çekirdek
    const fallbackLogo = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 32, 128), goldMat);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.25, 16, 96), navyMetal);
    fallbackLogo.add(ring, inner, glow(0xffed00, 16, 0.7));
    fallbackLogo.position.y = 5;
    textGroup.add(fallbackLogo);

    new THREE.FontLoader().load(
      FONT_URL,
      (font) => {
        const make = (str, size, height) => {
          const g = new THREE.TextGeometry(str, {
            font, size, height,
            curveSegments: 10,
            bevelEnabled: true,
            bevelThickness: size * 0.06,
            bevelSize: size * 0.04,
            bevelSegments: 4,
          });
          g.center();
          return g;
        };
        const fb = new THREE.Mesh(make("FB", 5.6, 1.7), [goldMat, navyMetal]);
        fb.position.y = 5.6;
        const year = new THREE.Mesh(make("1907", 1.9, 0.55), goldMat);
        year.position.y = 1;
        textGroup.remove(fallbackLogo);
        textGroup.add(fb, year);
        needsRedraw = true;
      },
      undefined,
      () => {} // yedek logo görünür kalır
    );

    const keyA = new THREE.PointLight(0xffe27a, 3, 80);
    keyA.position.set(8, 10, 14);
    const keyB = new THREE.PointLight(0x4f7dff, 3, 80);
    keyB.position.set(-10, 2, 10);
    group.add(keyA, keyB);

    // Havai fişekler (tekrarlanabilir: konum = f(zaman))
    const BURSTS = 12;
    const PER = 240;
    const N = BURSTS * PER;
    const fwPos = new Float32Array(N * 3);
    const fwCol = new Float32Array(N * 3);
    const fwDir = new Float32Array(N * 3);
    const palette = [0xffed00, 0xffffff, 0x4f8dff, 0xffd000].map((c) => new THREE.Color(c));
    const bursts = Array.from({ length: BURSTS }, (_, b) => ({
      t: 0.7 + b * 0.55,
      x: (rand() - 0.5) * 40,
      y: 9 + rand() * 11,
      z: -14 - rand() * 12,
      color: palette[b % palette.length],
      speed: 5 + rand() * 4,
    }));
    for (let i = 0; i < N; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = 0.7 + rand() * 0.3;
      fwDir[i * 3] = Math.cos(a) * r * s;
      fwDir[i * 3 + 1] = u * s;
      fwDir[i * 3 + 2] = Math.sin(a) * r * s;
    }
    const fwGeo = new THREE.BufferGeometry();
    fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3));
    fwGeo.setAttribute("color", new THREE.BufferAttribute(fwCol, 3));
    group.add(
      new THREE.Points(
        fwGeo,
        new THREE.PointsMaterial({
          size: 0.45,
          map: dot,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    const update = (lt) => {
      rays.rotation.z = lt * 0.18;

      const k = smooth(0.2, 2.8, lt);
      textGroup.rotation.y = lerp(-1.3, 0, k) + Math.sin(lt * 0.6) * 0.12 * k;
      textGroup.scale.setScalar(lerp(0.5, 1, easeOut(k)));
      textGroup.position.y = lerp(-4, 0, easeOut(k));
      fallbackLogo.rotation.z = lt * 0.3;

      for (let b = 0; b < BURSTS; b++) {
        const burst = bursts[b];
        const age = lt - burst.t;
        for (let p = 0; p < PER; p++) {
          const i = b * PER + p;
          if (age < 0 || age > 2.4) {
            fwCol[i * 3] = fwCol[i * 3 + 1] = fwCol[i * 3 + 2] = 0;
            continue;
          }
          const d = (burst.speed * (1 - Math.exp(-age * 2.2))) / 2.2 * 2;
          fwPos[i * 3] = burst.x + fwDir[i * 3] * d;
          fwPos[i * 3 + 1] = burst.y + fwDir[i * 3 + 1] * d - 1.1 * age * age;
          fwPos[i * 3 + 2] = burst.z + fwDir[i * 3 + 2] * d;
          const fade = Math.max(0, 1 - age / 2.4) * (0.7 + 0.3 * hash(i, Math.floor(lt * 20)));
          fwCol[i * 3] = burst.color.r * fade;
          fwCol[i * 3 + 1] = burst.color.g * fade;
          fwCol[i * 3 + 2] = burst.color.b * fade;
        }
      }
      fwGeo.attributes.position.needsUpdate = true;
      fwGeo.attributes.color.needsUpdate = true;

      const c = smooth(0, 6, lt);
      camera.position.set(Math.sin(lt * 0.25) * 4, lerp(1.5, 4, c), lerp(38, 24, c));
      camera.lookAt(0, 1.2, 0);
    };

    return {
      group, update, start: 36, end: 44,
      bg: 0x02040c, fog: new THREE.FogExp2(0x02040c, 0.008),
      bursts,
    };
  })();

  const SCENES = [sceneFener, sceneStadium, sceneTrophies, sceneEurope, sceneFinale];
  SCENES.forEach((s) => {
    s.group.visible = false;
    scene.add(s.group);
  });

  /* --- Altyazılar ------------------------------------------------------ */
  const CAPTIONS = [
    { s: 0.6, e: 3.9, title: "3 MAYIS 1907", sub: "KADIKÖY · FENERBAHÇE BURNU", center: true, size: 132 },
    { s: 4.3, e: 7.6, title: "ADINI BİR DENİZ FENERİNDEN ALDI", sub: "VE O IŞIK HİÇ SÖNMEDİ" },
    { s: 9.2, e: 12.8, title: "ÜLKER STADYUMU", sub: "ŞÜKRÜ SARACOĞLU SPOR KOMPLEKSİ" },
    { s: 13.2, e: 17.5, title: "47.000 SARI-LACİVERT YÜREK", sub: "KADIKÖY'ÜN KALBİ BURADA ATAR" },
    { s: 18.6, e: 21.6, count: 19, title: "SÜPER LİG", sub: "TÜRKİYE'NİN İLK ŞAMPİYONU · 1959" },
    { s: 21.8, e: 24.8, count: 7, title: "TÜRKİYE KUPASI", sub: "KUPALARIN EFENDİSİ" },
    { s: 25.0, e: 27.7, count: 10, title: "SÜPER KUPA", sub: "TOPLAM 28 ULUSAL ŞAMPİYONLUK" },
    { s: 28.6, e: 31.4, title: "EUROLEAGUE ŞAMPİYONU", sub: "ERKEK BASKETBOL · 2017 · 2025" },
    { s: 31.6, e: 33.8, title: "AVRUPA'NIN ZİRVESİ", sub: "KADIN BASKETBOL · 2023 · 2024 · 2026" },
    { s: 34.0, e: 35.8, title: "VOLEYBOLDA DÜNYA ŞAMPİYONU", sub: "2010 DÜNYA · 2012 CEV ŞAMPİYONLAR LİGİ" },
    { s: 37.4, e: 43.6, title: "FENERBAHÇE", sub: "1907'DEN BUGÜNE · NİCE ŞAMPİYONLUKLARA", size: 120 },
  ];

  const supportsSpacing = "letterSpacing" in ctx;
  const setSpacing = (px) => {
    if (supportsSpacing) ctx.letterSpacing = `${px}px`;
  };

  const drawCaption = (c, t) => {
    const alpha = clamp((t - c.s) / 0.45, 0, 1) * clamp((c.e - t) / 0.45, 0, 1);
    if (alpha <= 0) return;
    const enter = easeOut((t - c.s) / 0.9);
    const size = c.size ?? 84;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 28;
    ctx.textBaseline = "alphabetic";

    const gold = ctx.createLinearGradient(0, 0, 0, H);
    gold.addColorStop(0, "#fffbd0");
    gold.addColorStop(0.5, "#ffed00");
    gold.addColorStop(1, "#e6b800");

    if (c.center) {
      const y = H / 2 + 20 + (1 - enter) * 30;
      ctx.textAlign = "center";
      setSpacing(lerp(40, 6, enter));
      ctx.font = `${size}px "Bebas Neue", Impact, sans-serif`;
      ctx.fillStyle = gold;
      ctx.fillText(c.title, W / 2, y);
      setSpacing(8);
      ctx.font = `600 24px Barlow, Arial, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(c.sub, W / 2, y + 48);
    } else {
      const x = 96;
      const y = H - BAR - 92 + (1 - enter) * 26;
      ctx.textAlign = "left";

      // Sarı vurgu çubuğu
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffed00";
      ctx.fillRect(x - 26, y - size * 0.78, 6, (size * 0.78 + 48) * enter);
      ctx.shadowBlur = 28;

      let titleX = x;
      if (c.count) {
        const n = Math.round(c.count * easeOut((t - c.s) / 1.1));
        ctx.font = `${size * 1.55}px "Bebas Neue", Impact, sans-serif`;
        setSpacing(2);
        ctx.fillStyle = gold;
        ctx.fillText(String(n), x, y + 10);
        titleX = x + ctx.measureText(String(c.count)).width + 22;
      }

      setSpacing(lerp(18, 3, enter));
      ctx.font = `${size}px "Bebas Neue", Impact, sans-serif`;
      ctx.fillStyle = c.count ? "#ffffff" : gold;
      ctx.fillText(c.title, titleX, y);

      setSpacing(6);
      ctx.font = `600 22px Barlow, Arial, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(c.sub, titleX, y + 40);
    }
    ctx.restore();
  };

  /* --- Kompozisyon katmanları ---------------------------------------- */
  const vignette = (() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.6)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    return c;
  })();

  const grainPattern = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, "repeat");
  })();

  const sceneAt = (t) => SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];

  let needsRedraw = false;

  const renderFrame = (t) => {
    const active = sceneAt(t);
    SCENES.forEach((s) => (s.group.visible = s === active));
    scene.background = new THREE.Color(active.bg);
    scene.fog = active.fog;
    active.update(t - active.start);
    renderer.render(scene, camera);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(glCanvas, 0, 0, W, H);

    // Sahne geçişleri: karartma / beyaz parlama
    const fadeIn = active.start === 0 ? clamp(t / 1.2, 0, 1) : clamp((t - active.start) / 0.5, 0, 1);
    const fadeOut = active.end >= DURATION ? clamp((DURATION - t) / 1.2, 0, 1) : clamp((active.end - t) / 0.45, 0, 1);
    const dark = 1 - Math.min(fadeIn, fadeOut);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fillRect(0, 0, W, H);
    }
    [8, 36].forEach((ft) => {
      const f = Math.max(0, 1 - Math.abs(t - ft - 0.08) / 0.32);
      if (f > 0) {
        ctx.fillStyle = `rgba(255,250,215,${f * 0.85})`;
        ctx.fillRect(0, 0, W, H);
      }
    });

    ctx.drawImage(vignette, 0, 0);

    // Film greni
    ctx.save();
    ctx.globalAlpha = 0.06;
    const ox = Math.floor(hash(1, Math.floor(t * 24)) * 256);
    const oy = Math.floor(hash(2, Math.floor(t * 24)) * 256);
    ctx.translate(ox, oy);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(-ox, -oy, W, H);
    ctx.restore();

    // Sinema şeritleri
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, BAR);
    ctx.fillRect(0, H - BAR, W, BAR);

    // Künye
    const chapterIndex = SCENES.indexOf(active);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    setSpacing(4);
    ctx.font = `600 15px Barlow, Arial, sans-serif`;
    ctx.fillStyle = "#ffed00";
    ctx.fillText("FB SİNEMA", 28, BAR / 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(
      `BÖLÜM ${String(chapterIndex + 1).padStart(2, "0")} · ${CHAPTERS[chapterIndex].label.toLocaleUpperCase("tr")}`,
      150,
      BAR / 2
    );
    ctx.textAlign = "right";
    ctx.fillText("1907 — " + new Date().getFullYear(), W - 28, BAR / 2);
    ctx.restore();

    CAPTIONS.forEach((c) => drawCaption(c, t));
  };

  /* --- Ses: WebAudio ile üretilen müzik + tribün ---------------------- */
  const audio = (() => {
    let ac = null;
    let mix;
    let speaker;
    let recDest;
    let noiseBuf;
    let droneFilter;
    let crowdGain;
    let riserGain;
    let riserFilter;
    let muted = true;

    const ensure = () => {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();

      mix = ac.createGain();
      mix.gain.value = 0.85;
      const comp = ac.createDynamicsCompressor();
      mix.connect(comp);
      speaker = ac.createGain();
      speaker.gain.value = muted ? 0 : 1;
      comp.connect(speaker);
      speaker.connect(ac.destination);
      recDest = ac.createMediaStreamDestination();
      comp.connect(recDest);

      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      // Derin drone (A minör)
      droneFilter = ac.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 260;
      droneFilter.Q.value = 3;
      const droneGain = ac.createGain();
      droneGain.gain.value = 0.13;
      [55, 55.5, 82.4, 110.2].forEach((f) => {
        const osc = ac.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.connect(droneFilter);
        osc.start();
      });
      droneFilter.connect(droneGain).connect(mix);

      // Tribün uğultusu
      const crowd = ac.createBufferSource();
      crowd.buffer = noiseBuf;
      crowd.loop = true;
      const band = ac.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 850;
      band.Q.value = 0.5;
      crowdGain = ac.createGain();
      crowdGain.gain.value = 0;
      crowd.connect(band).connect(crowdGain).connect(mix);
      crowd.start();

      // Final öncesi yükselen gerilim
      const riser = ac.createBufferSource();
      riser.buffer = noiseBuf;
      riser.loop = true;
      riserFilter = ac.createBiquadFilter();
      riserFilter.type = "bandpass";
      riserFilter.Q.value = 4;
      riserGain = ac.createGain();
      riserGain.gain.value = 0;
      riser.connect(riserFilter).connect(riserGain).connect(mix);
      riser.start();

      return ac;
    };

    const kick = (strength = 1) => {
      if (!ac) return;
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.16);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.9 * strength, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(g).connect(mix);
      osc.start(now);
      osc.stop(now + 0.55);
    };

    const boom = (strength = 1) => {
      if (!ac) return;
      const now = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1800, now);
      lp.frequency.exponentialRampToValueAtTime(90, now + 1.2);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.7 * strength, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      src.connect(lp).connect(g).connect(mix);
      src.start(now);
      src.stop(now + 1.5);
    };

    const setLevels = (t) => {
      if (!ac) return;
      const now = ac.currentTime;
      const inStadium = t >= 8 && t < 18;
      const inFinale = t >= 36;
      crowdGain.gain.setTargetAtTime(inStadium ? 0.32 : inFinale ? 0.26 : 0.02, now, 0.25);
      const r = t >= 33.4 && t < 36 ? smooth(33.4, 36, t) : 0;
      riserGain.gain.setTargetAtTime(r * 0.3, now, 0.05);
      riserFilter.frequency.setTargetAtTime(300 + r * 5000, now, 0.05);
      droneFilter.frequency.setTargetAtTime(200 + (Math.min(t, 40) / 40) * 900, now, 0.3);
    };

    return {
      ensure,
      kick,
      boom,
      setLevels,
      stream: () => recDest?.stream ?? null,
      get muted() {
        return muted;
      },
      setMuted(value) {
        muted = value;
        if (!value) ensure();
        if (ac) {
          speaker.gain.setTargetAtTime(value ? 0 : 1, ac.currentTime, 0.05);
          if (!value) ac.resume();
        }
      },
      suspend: () => ac?.suspend(),
      resume: () => ac?.resume(),
    };
  })();

  // Zaman çizelgesindeki ses olayları
  const EVENTS = [
    ...[1.0, 1.32, 3.0, 3.32, 5.0, 5.32, 7.0, 7.32].map((t) => ({ t, fn: () => audio.kick(0.45) })),
    ...[8.0, 18.0, 28.0, 36.0].map((t) => ({ t, fn: () => { audio.kick(1.3); audio.boom(0.9); } })),
    ...sceneFinale.bursts.map((b) => ({ t: 36 + b.t, fn: () => audio.boom(0.55) })),
  ];
  const BEAT = 0.625; // 96 BPM

  const fireEvents = (from, to) => {
    if (to - from > 0.5) return; // atlamada sesleri tetikleme
    EVENTS.forEach((e) => {
      if (e.t > from && e.t <= to) e.fn();
    });
    if (to >= 8 && to < 36) {
      if (Math.floor((to - 8) / BEAT) > Math.floor((from - 8) / BEAT)) audio.kick(0.7);
    }
  };

  /* --- Oynatıcı ------------------------------------------------------- */
  let t = 0;
  let playing = false;
  let userPaused = false;
  let inView = false;
  let recording = false;
  let raf = 0;
  let lastNow = 0;
  let recorder = null;
  let chunks = [];

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const updateUI = () => {
    progressFill.style.width = `${(t / DURATION) * 100}%`;
    timeEl.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    progress.setAttribute("aria-valuenow", String(Math.floor(t)));
    playBtn.textContent = playing ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", playing ? "Duraklat" : "Oynat");
    muteBtn.textContent = audio.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", audio.muted ? "Sesi aç" : "Sesi kapat");
    player.classList.toggle("is-playing", playing);
  };

  const tick = (now) => {
    raf = 0;
    const dt = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;

    if (playing) {
      const prev = t;
      t += dt;
      if (t >= DURATION) {
        if (recording) {
          t = DURATION - 0.001;
          stopRecording();
          pause(true);
        } else {
          t = 0;
        }
      } else {
        fireEvents(prev, t);
      }
      audio.setLevels(t);
    }

    renderFrame(t);
    updateUI();
    if (playing) raf = requestAnimationFrame(tick);
  };

  const play = () => {
    if (playing) return;
    playing = true;
    audio.resume();
    lastNow = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
    updateUI();
  };

  const pause = (byUser) => {
    playing = false;
    if (byUser) userPaused = true;
    audio.suspend();
    updateUI();
  };

  const seek = (time) => {
    t = clamp(time, 0, DURATION - 0.001);
    if (!playing) {
      renderFrame(t);
      updateUI();
    }
  };

  // Bölüm işaretleri
  CHAPTERS.forEach((c) => {
    const mark = document.createElement("span");
    mark.style.left = `${(c.t / DURATION) * 100}%`;
    mark.dataset.label = c.label;
    chaptersEl.appendChild(mark);
  });

  playBtn.addEventListener("click", () => {
    if (playing) pause(true);
    else {
      userPaused = false;
      play();
    }
  });

  bigPlay.addEventListener("click", () => {
    userPaused = false;
    audio.setMuted(false);
    play();
  });

  muteBtn.addEventListener("click", () => {
    audio.setMuted(!audio.muted);
    updateUI();
  });

  fullBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else player.requestFullscreen?.();
  });

  // İlerleme çubuğu: tıkla / sürükle / klavye
  let dragging = false;
  const seekFromEvent = (event) => {
    const rect = progress.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * DURATION);
  };
  progress.addEventListener("pointerdown", (event) => {
    if (recording) return;
    dragging = true;
    progress.setPointerCapture(event.pointerId);
    seekFromEvent(event);
  });
  progress.addEventListener("pointermove", (event) => dragging && seekFromEvent(event));
  progress.addEventListener("pointerup", () => (dragging = false));
  progress.addEventListener("keydown", (event) => {
    if (recording) return;
    const steps = { ArrowLeft: -2, ArrowRight: 2, Home: -DURATION, End: DURATION };
    if (event.key in steps) {
      event.preventDefault();
      seek(t + steps[event.key]);
    }
  });

  player.addEventListener("keydown", (event) => {
    if (event.key === " " && event.target === player) {
      event.preventDefault();
      playBtn.click();
    }
  });

  /* --- Video kaydı (MediaRecorder → .webm) ----------------------------- */
  const setRecUI = () => {
    recBtn.classList.toggle("is-recording", recording);
    recBtn.textContent = recording ? "⏹ Kaydı Durdur" : "⏺ Videoyu Kaydet";
    recBadge.hidden = !recording;
  };

  const stopRecording = () => {
    if (!recording) return;
    recording = false;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecUI();
  };

  const startRecording = () => {
    if (!out.captureStream || typeof MediaRecorder === "undefined") {
      recBtn.textContent = "Tarayıcı kaydı desteklemiyor";
      return;
    }

    audio.ensure();
    audio.resume();
    const stream = out.captureStream(30);
    audio.stream()?.getAudioTracks().forEach((track) => stream.addTrack(track));

    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
    chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getVideoTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "fenerbahce-bir-asrin-filmi.webm";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    };

    seek(0);
    recorder.start(250);
    recording = true;
    userPaused = false;
    setRecUI();
    play();
  };

  recBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));

  /* --- Başlangıç: ön ısıtma, poster ve otomatik oynatma ---------------- */
  // Her sahneyi bir kez çizerek shader derlemelerini önceden yap (geçişlerde takılma olmasın)
  const warmUp = () => {
    SCENES.forEach((s) => renderFrame((s.start + s.end) / 2));
    renderFrame(2.4); // poster karesi
    updateUI();
  };

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(warmUp);

  // Ekrana girince sessiz otomatik oynat, çıkınca duraklat
  new IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting;
      if (inView && !userPaused && !prefersReducedMotion) play();
      else if (!inView && playing && !recording) pause(false);
    },
    { threshold: 0.35 }
  ).observe(player);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing && !recording) pause(false);
    else if (!document.hidden && inView && !userPaused && !prefersReducedMotion) play();
  });

  // Yazı tipi geç yüklenirse duraklatılmış kareyi yenile
  setInterval(() => {
    if (needsRedraw && !playing) {
      needsRedraw = false;
      renderFrame(t || 2.4);
    }
  }, 500);
})();
