/**
 * Fenerbahçe Spor Kulübü — Tanıtım Sitesi (Pro Max)
 * ----------------------------------------
 * - Mobil menü, yapışkan başlık durumu
 * - Sinematik 3D bölüm geçişleri (açılış jeneriği dahil)
 * - Harf harf 3D başlık, sayaçlar
 * - Özel imleç, manyetik butonlar, 3D eğilen kartlar
 * - Yatay kayan tarih şeridi, 3D stadyum, dönen efsane kartları
 * - Kaydırırken 3D açılan içerikler, kaydırma ilerleme çubuğu
 */
"use strict";

(() => {
  /** Kulüp kuruluş yılı */
  const FOUNDING_YEAR = 1907;

  /** Sticky header yüksekliği (px) — CSS'teki --header-h ile uyumlu */
  const HEADER_OFFSET = 72;

  /** Sayaç animasyon süresi (ms) */
  const COUNTER_DURATION = 2200;

  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  /* ------------------------------------------------------------------
   * 1) Mobil menü ve başlık durumu
   * ------------------------------------------------------------------ */
  const header = document.querySelector(".site-header");
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");

  /**
   * Menü durumunu değiştirir.
   * @param {boolean} [force] - true/false verilirse o duruma zorlar.
   */
  const setMenu = (force) => {
    const open =
      typeof force === "boolean" ? force : !navMenu.classList.contains("open");
    navMenu.classList.toggle("open", open);
    navToggle.classList.toggle("active", open);
    navToggle.setAttribute("aria-expanded", String(open));
  };

  navToggle.addEventListener("click", () => setMenu());

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      navMenu.classList.contains("open") &&
      !navMenu.contains(target) &&
      !navToggle.contains(target)
    ) {
      setMenu(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  /* ------------------------------------------------------------------
   * 2) Sinematik 3D geçişler
   *    Her bölümün kendi "kamera hareketi" vardır: sayfa 3D uzayda
   *    geri çekilir, yıldız/tünel efekti hızlanır, panjurlar kapanır,
   *    bölüm başlığı derinlikten uçarak gelir; ardından kamera hedef
   *    bölüme dalar.
   * ------------------------------------------------------------------ */
  const stage = document.getElementById("pageStage");
  const cine = document.getElementById("cine");
  const cineCanvas = document.getElementById("cineCanvas");
  const cineTitle = document.getElementById("cineTitle");
  const cineChapter = document.getElementById("cineChapter");
  const cineHeading = document.getElementById("cineHeading");
  const cineSub = document.getElementById("cineSub");
  const cineFlash = document.getElementById("cineFlash");
  const shutters = Array.from(document.querySelectorAll("#cineShutters span"));
  const bars = Array.from(document.querySelectorAll(".cine-bar"));

  const EASE_IN = "cubic-bezier(0.7, 0, 0.84, 0)";
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const EASE_IN_OUT = "cubic-bezier(0.87, 0, 0.13, 1)";

  /**
   * Bölüme özel kamera hareketleri.
   * exit: mevcut sahnenin uzaklaşması, enter: yeni sahnenin geldiği konum.
   * fx: arka plan efekti ("stars" = hiperuzay, "tunnel" = halka tüneli).
   */
  const VARIANTS = {
    hero: {
      shutter: "v", fx: "stars",
      exit: { ry: -28, z: -420 },
      enter: { z: 650, rx: 6 },
    },
    film: {
      shutter: "h", fx: "stars",
      exit: { z: -800 },
      enter: { z: 700, rz: -3 },
    },
    tarih: {
      shutter: "h", fx: "tunnel",
      exit: { rx: 24, z: -480, y: -60 },
      enter: { rx: -22, z: -420, y: 80 },
    },
    basarilar: {
      shutter: "v", fx: "stars",
      exit: { rz: -8, z: -560 },
      enter: { rz: 7, z: 550 },
    },
    efsaneler: {
      shutter: "v", fx: "tunnel",
      exit: { ry: -40, z: -500 },
      enter: { ry: 40, z: -500 },
    },
    stadyum: {
      shutter: "h", fx: "tunnel",
      exit: { rx: -26, z: -440 },
      enter: { rx: 38, y: 160, z: -520 },
    },
    branslar: {
      shutter: "v", fx: "stars",
      exit: { ry: 34, z: -400 },
      enter: { ry: -32, z: -400 },
    },
    iletisim: {
      shutter: "h", fx: "tunnel",
      exit: { rx: 12, z: -720 },
      enter: { z: 520, rx: -4 },
    },
  };

  /** Kamera nesnesini CSS transform metnine çevirir. */
  const camera = ({ rx = 0, ry = 0, rz = 0, y = 0, z = 0 } = {}) =>
    `perspective(1200px) translate3d(0, ${y}px, ${z}px) ` +
    `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const play = (el, keyframes, options) =>
    el.animate(keyframes, { fill: "forwards", ...options }).finished;

  /* --- Hiperuzay / tünel tuvali --------------------------------------- */
  const warp = (() => {
    const ctx = cineCanvas.getContext("2d");
    const stars = Array.from({ length: 380 }, () => ({}));
    const RING_COUNT = 12;
    let w = 0;
    let h = 0;
    let raf = 0;
    let speed = 0;
    let targetSpeed = 0;
    let travelled = 0;
    let fx = "stars";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cineCanvas.width = Math.round(w * dpr);
      cineCanvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (star, far) => {
      star.x = (Math.random() - 0.5) * w * 2;
      star.y = (Math.random() - 0.5) * h * 2;
      star.z = far ? w : Math.random() * w + 1;
      star.pz = star.z;
      star.gold = Math.random() < 0.35;
    };

    const drawStars = (cx, cy, k, alpha) => {
      ctx.lineCap = "round";
      for (const s of stars) {
        s.pz = s.z;
        s.z -= speed;
        if (s.z < 1) {
          spawn(s, true);
          continue;
        }
        const depth = 1 - s.z / w;
        ctx.strokeStyle = s.gold
          ? `rgba(255, 237, 0, ${depth * alpha})`
          : `rgba(255, 255, 255, ${depth * 0.9 * alpha})`;
        ctx.lineWidth = depth * 3 + 0.3;
        ctx.beginPath();
        ctx.moveTo(cx + (s.x / s.pz) * k, cy + (s.y / s.pz) * k);
        ctx.lineTo(cx + (s.x / s.z) * k, cy + (s.y / s.z) * k);
        ctx.stroke();
      }
    };

    const drawTunnel = (cx, cy, k) => {
      const gap = w / RING_COUNT;
      const radius = Math.max(w, h) * 0.32;
      for (let i = 0; i < RING_COUNT; i++) {
        const z = (((i * gap - travelled) % w) + w) % w + 1;
        const r = (radius / z) * k;
        if (r > Math.max(w, h) * 2) continue;
        const depth = 1 - z / w;
        ctx.strokeStyle =
          i % 2 === 0
            ? `rgba(255, 237, 0, ${depth * 0.85})`
            : `rgba(80, 130, 220, ${depth * 0.6})`;
        ctx.lineWidth = depth * 10 + 0.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const frame = () => {
      speed += (targetSpeed - speed) * 0.06;
      travelled += speed;

      // Hafif iz bırakan arka plan = hareket bulanıklığı
      ctx.fillStyle = "rgba(6, 18, 41, 0.34)";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const k = w * 0.5;
      if (fx === "tunnel") drawTunnel(cx, cy, k);
      drawStars(cx, cy, k, fx === "tunnel" ? 0.6 : 1);

      raf = requestAnimationFrame(frame);
    };

    return {
      start(effect) {
        cancelAnimationFrame(raf);
        fx = effect;
        resize();
        stars.forEach((s) => spawn(s, false));
        ctx.fillStyle = "#061229";
        ctx.fillRect(0, 0, w, h);
        speed = 2;
        targetSpeed = 2;
        raf = requestAnimationFrame(frame);
      },
      speed(value) {
        targetSpeed = value * (w / 1400);
      },
      stop() {
        cancelAnimationFrame(raf);
        raf = 0;
      },
      resize() {
        if (raf) resize();
      },
    };
  })();

  window.addEventListener("resize", () => warp.resize());

  /* --- Geçiş aşamaları ------------------------------------------------- */
  const sectionOrder = Array.from(document.querySelectorAll(".nav-link"))
    .map((link) => link.getAttribute("href")?.slice(1))
    .filter(Boolean);

  /** Sahnenin dönüş noktasını ekranın ortasına sabitler. */
  const centerStageOrigin = () => {
    const y = window.innerHeight / 2 - stage.getBoundingClientRect().top;
    stage.style.transformOrigin = `50% ${y}px`;
  };

  const setTitleCopy = (target) => {
    const index = sectionOrder.indexOf(target.id);
    const chapter = String(index + 1).padStart(2, "0");
    const total = String(sectionOrder.length).padStart(2, "0");
    cineChapter.textContent = `Bölüm ${chapter} / ${total}`;
    cineHeading.textContent = target.dataset.cineTitle ?? "";
    cineSub.textContent = target.dataset.cineSub ?? "";
  };

  const shutterFrames = (shutter, from, to) => {
    const axis = shutter === "h" ? "rotateX" : "rotateY";
    return [
      { transform: `${axis}(${from}deg)` },
      { transform: `${axis}(${to}deg)` },
    ];
  };

  const setShutterOrigin = (shutter, phase) => {
    const closing = phase === "close";
    const origin =
      shutter === "h"
        ? closing ? "center top" : "center bottom"
        : closing ? "left center" : "right center";
    shutters.forEach((el) => (el.style.transformOrigin = origin));
  };

  const barFrames = (index, show) => {
    const hidden = `translateY(${index === 0 ? -100 : 100}%)`;
    return show
      ? [{ transform: hidden }, { transform: "translateY(0)" }]
      : [{ transform: "translateY(0)" }, { transform: hidden }];
  };

  const titleInFrames = [
    { opacity: 0, transform: "translateZ(-1600px) rotateX(35deg)", filter: "blur(14px)" },
    { opacity: 1, transform: "translateZ(0) rotateX(0)", filter: "blur(0)" },
  ];

  /** 1. perde: kamera geri çekilir, panjurlar kapanır, başlık gelir. */
  const runExit = (variant) => {
    setShutterOrigin(variant.shutter, "close");
    centerStageOrigin();
    warp.speed(26);

    return Promise.all([
      ...bars.map((bar, i) =>
        play(bar, barFrames(i, true), { duration: 600, easing: EASE_OUT })
      ),
      play(stage,
        [
          { transform: camera(), opacity: 1 },
          { transform: camera(variant.exit), opacity: 0.25 },
        ],
        { duration: 950, easing: EASE_IN }),
      play(cineCanvas, [{ opacity: 0 }, { opacity: 1 }],
        { duration: 550, delay: 150, easing: "ease-out" }),
      ...shutters.map((el, i) =>
        play(el, shutterFrames(variant.shutter, 90, 0),
          { duration: 560, delay: 420 + i * 55, easing: EASE_OUT })
      ),
      play(cineTitle, titleInFrames,
        { duration: 800, delay: 650, easing: EASE_OUT }),
    ]);
  };

  /** 2. perde: kamera yeni bölüme dalar, panjurlar açılır. */
  const runEnter = (variant) => {
    setShutterOrigin(variant.shutter, "open");
    centerStageOrigin();
    warp.speed(60);
    setTimeout(() => warp.speed(3), 650);

    return Promise.all([
      play(cineTitle,
        [
          { opacity: 1, transform: "translateZ(0)" },
          { opacity: 0, transform: "translateZ(900px)" },
        ],
        { duration: 650, easing: EASE_IN }),
      play(cineFlash, [{ opacity: 0 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0 }],
        { duration: 650, delay: 420, easing: "ease-out" }),
      ...shutters.map((el, i) =>
        play(el, shutterFrames(variant.shutter, 0, -90),
          { duration: 650, delay: 380 + Math.abs(i - 3) * 60, easing: EASE_IN_OUT })
      ),
      play(stage,
        [
          { transform: camera(variant.enter), opacity: 0.2 },
          { transform: camera(), opacity: 1 },
        ],
        { duration: 1300, delay: 420, easing: EASE_OUT }),
      play(cineCanvas, [{ opacity: 1 }, { opacity: 0 }],
        { duration: 600, delay: 600, easing: "ease-in" }),
      ...bars.map((bar, i) =>
        play(bar, barFrames(i, false), { duration: 700, delay: 1100, easing: EASE_IN_OUT })
      ),
    ]);
  };

  const resetCinematic = () => {
    warp.stop();
    [stage, cineCanvas, cineTitle, cineFlash, ...shutters, ...bars].forEach((el) =>
      el.getAnimations().forEach((anim) => anim.cancel())
    );
    stage.style.transformOrigin = "";
    cine.classList.remove("is-active", "is-intro");
  };

  /** Perde arkasında, hedef bölüme anında atlar. */
  const jumpTo = (target) => {
    const top =
      target.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
    window.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };

  let busy = false;
  let queued = null;

  const finishCinematic = () => {
    resetCinematic();
    busy = false;
    window.dispatchEvent(new Event("scroll"));
    if (queued) {
      const next = queued;
      queued = null;
      cinematicTo(next);
    }
  };

  const cinematicTo = async (target) => {
    if (busy) {
      queued = target;
      return;
    }
    busy = true;

    const variant = VARIANTS[target.id] ?? VARIANTS.hero;
    cine.dataset.shutter = variant.shutter;
    setTitleCopy(target);
    cine.classList.add("is-active");
    warp.start(variant.fx);

    await runExit(variant);
    jumpTo(target);
    await wait(260);
    await runEnter(variant);
    finishCinematic();
  };

  const goTo = (target) => {
    if (prefersReducedMotion) jumpTo(target);
    else cinematicTo(target);
  };

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const hash = link.getAttribute("href");
      if (!hash || hash === "#") return;

      const target = document.querySelector(hash);
      if (!target) return;

      event.preventDefault();

      if (navMenu.classList.contains("open")) setMenu(false);

      // "İçeriğe atla" bağlantısı erişilebilirlik için animasyonsuz çalışır
      if (link.classList.contains("skip-link")) jumpTo(target);
      else goTo(target);

      history.pushState(null, "", hash);
    });
  });

  // Tarayıcının geri / ileri tuşları da sinematik geçişle çalışır
  window.addEventListener("popstate", () => {
    const target = document.querySelector(location.hash || "#hero");
    if (target) goTo(target);
  });

  /* --- Açılış jeneriği -------------------------------------------------- */
  const heroSplit = document.querySelector(".hero-title .split");

  // Başlığı harflere böl (3D harf animasyonu için)
  if (heroSplit) {
    const text = heroSplit.textContent.trim();
    heroSplit.textContent = "";
    Array.from(text).forEach((letter, i) => {
      const span = document.createElement("span");
      span.className = "char";
      span.style.setProperty("--i", String(i));
      span.textContent = letter;
      heroSplit.appendChild(span);
    });
  }

  const introDone = () => {
    heroSplit?.classList.add("is-in");
    document.dispatchEvent(new CustomEvent("fb:intro-done"));
  };

  if (prefersReducedMotion) {
    cine.classList.remove("is-intro");
    introDone();
  } else {
    busy = true;
    cine.dataset.shutter = VARIANTS.hero.shutter;
    warp.start(VARIANTS.hero.fx);
    warp.speed(8);

    (async () => {
      // Yazı tipi yüklenmeden başlık uçmasın
      await Promise.race([document.fonts?.ready, wait(1500)]);
      await play(cineTitle, titleInFrames, { duration: 1300, easing: EASE_OUT });
      await wait(450);
      setTimeout(introDone, 700);
      await runEnter(VARIANTS.hero);
      finishCinematic();
    })();
  }

  /* ------------------------------------------------------------------
   * 3) Sayaçlar
   * ------------------------------------------------------------------ */
  /**
   * 0'dan hedefe doğru yumuşak (easeOutCubic) sayaç animasyonu.
   * @param {HTMLElement} el - Güncellenecek öğe.
   * @param {number} target - Hedef değer.
   */
  const animateCounter = (el, target) => {
    if (prefersReducedMotion) {
      el.textContent = String(target);
      return;
    }

    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / COUNTER_DURATION, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const yearsCounter = document.getElementById("yearsCounter");
  if (yearsCounter) yearsCounter.dataset.count = String(new Date().getFullYear() - FOUNDING_YEAR);

  const counters = Array.from(document.querySelectorAll("[data-count]"));

  if ("IntersectionObserver" in window) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCounter(entry.target, Number(entry.target.dataset.count));
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );

    // Hero sayaçları açılış jeneriği bitince başlasın
    const startObserving = () => counters.forEach((el) => counterObserver.observe(el));
    if (busy) document.addEventListener("fb:intro-done", startObserving, { once: true });
    else startObserving();
  } else {
    counters.forEach((el) => (el.textContent = el.dataset.count));
  }

  /* ------------------------------------------------------------------
   * 4) Aktif menü bağlantısı takibi
   * ------------------------------------------------------------------ */
  const navLinks = Array.from(document.querySelectorAll(".nav-link"));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute("href") ?? ""))
    .filter((section) => section !== null);

  const setActiveLink = (id) => {
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
    });
  };

  /**
   * Ekranın üst %45'ini geçen son bölümü aktif sayar.
   * Sinematik geçiş sırasında sahne 3D dönüştüğü için ölçüm yapılmaz.
   */
  const syncActiveLink = () => {
    if (busy || sections.length === 0) return;
    const line = window.innerHeight * 0.45;
    let current = sections[0];
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= line) current = section;
    });
    setActiveLink(current.id);
  };

  /* ------------------------------------------------------------------
   * 5) Kaydırmaya bağlı efektler: ilerleme çubuğu, başlık, yatay şerit
   * ------------------------------------------------------------------ */
  const progressBar = document.getElementById("scrollProgress");
  const htl = document.getElementById("tarih");
  const htlTrack = document.getElementById("htlTrack");
  const htlProgress = document.getElementById("htlProgress");
  const mobileLayout = window.matchMedia("(max-width: 900px)");
  let htlDistance = 0;

  /** Yatay şerit için bölüm yüksekliğini, kaydırma mesafesine göre ayarlar. */
  const layoutTimeline = () => {
    if (!htl || !htlTrack) return;
    if (mobileLayout.matches) {
      htl.style.height = "";
      htlDistance = 0;
      return;
    }
    htlDistance = Math.max(htlTrack.scrollWidth - window.innerWidth, 0);
    htl.style.height = `${window.innerHeight + htlDistance}px`;
  };

  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    header.classList.toggle("is-scrolled", window.scrollY > 40);
    syncActiveLink();

    if (htlDistance > 0) {
      const passed = HEADER_OFFSET - htl.getBoundingClientRect().top;
      const p = clamp(passed / htlDistance, 0, 1);
      htlTrack.style.transform = `translate3d(${-p * htlDistance}px, 0, 0)`;
      htlProgress.style.transform = `scaleX(${p})`;
    }
  };

  let scrollQueued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        onScroll();
      });
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    layoutTimeline();
    onScroll();
  });
  window.addEventListener("load", () => {
    layoutTimeline();
    onScroll();
  });
  layoutTimeline();
  onScroll();

  /* ------------------------------------------------------------------
   * 6) Özel imleç, manyetik butonlar, 3D eğilen kartlar
   * ------------------------------------------------------------------ */
  if (finePointer && !prefersReducedMotion) {
    const cursor = document.getElementById("cursor");
    const dot = cursor.querySelector(".cursor-dot");
    const ring = cursor.querySelector(".cursor-ring");
    const pos = { x: -100, y: -100 };
    const ringPos = { x: -100, y: -100 };

    window.addEventListener("pointermove", (event) => {
      pos.x = event.clientX;
      pos.y = event.clientY;
      dot.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    });

    const followRing = () => {
      ringPos.x += (pos.x - ringPos.x) * 0.18;
      ringPos.y += (pos.y - ringPos.y) * 0.18;
      ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
      requestAnimationFrame(followRing);
    };
    requestAnimationFrame(followRing);

    document.addEventListener("pointerover", (event) => {
      const interactive = event.target.closest("a, button, .tilt, .film-progress");
      cursor.classList.toggle("is-hover", Boolean(interactive));
    });
    document.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
    document.addEventListener("pointerup", () => cursor.classList.remove("is-down"));

    // Manyetik butonlar
    document.querySelectorAll(".magnetic").forEach((btn) => {
      btn.addEventListener("pointermove", (event) => {
        const rect = btn.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        btn.style.transform = `translate(${dx * 0.3}px, ${dy * 0.4}px)`;
        btn.firstElementChild.style.transform = `translate(${dx * 0.15}px, ${dy * 0.2}px)`;
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.transform = "";
        btn.firstElementChild.style.transform = "";
      });
    });

    // 3D eğilen kartlar + parlama
    document.querySelectorAll(".tilt").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        if (card.classList.contains("reveal-3d")) return;
        const rect = card.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        card.style.transition = "transform 0.08s linear";
        card.style.transform =
          `perspective(900px) rotateX(${(0.5 - py) * 16}deg) rotateY(${(px - 0.5) * 18}deg) translateZ(10px)`;
        card.style.setProperty("--gx", `${px * 100}%`);
        card.style.setProperty("--gy", `${py * 100}%`);
      });
      card.addEventListener("pointerleave", () => {
        card.style.transition = "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
        card.style.transform = "";
      });
    });

    // Hero ışığı imleci takip eder
    const hero = document.getElementById("hero");
    hero.addEventListener("pointermove", (event) => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
      hero.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
    });

    // 3D stadyum fareyle döner
    const stadiumVisual = document.getElementById("stadiumVisual");
    const stadium3d = document.getElementById("stadium3d");
    stadiumVisual?.addEventListener("pointermove", (event) => {
      const rect = stadiumVisual.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      stadium3d.style.setProperty("--rx", `${58 - py * 30}deg`);
      stadium3d.style.setProperty("--rz", `${-18 + px * 70}deg`);
    });
    stadiumVisual?.addEventListener("pointerleave", () => {
      stadium3d.style.removeProperty("--rx");
      stadium3d.style.removeProperty("--rz");
    });
  }

  // Efsane kartları dokunmatik ekranda dokununca döner
  if (!finePointer) {
    document.querySelectorAll(".legend-card").forEach((card) => {
      card.addEventListener("click", () => card.classList.toggle("is-flipped"));
    });
  }

  /* ------------------------------------------------------------------
   * 7) Kaydırırken 3D açılış (her öğe derinlikten dönerek gelir)
   * ------------------------------------------------------------------ */
  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    const groups = [
      { selector: ".section .section-eyebrow, .section .section-title, .section-lead, .fine-print", card: false },
      { selector: ".trophy-card", card: true },
      { selector: ".legend-card", card: true },
      { selector: ".stadyum-text, .stadyum-visual", card: true },
      { selector: ".branch-card", card: true },
      { selector: ".now-card", card: true },
      { selector: ".film-player", card: false },
      { selector: ".footer-col", card: true },
    ];

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );

    groups.forEach(({ selector, card }) => {
      document.querySelectorAll(selector).forEach((el, i) => {
        el.style.setProperty("--d", `${(i % 4) * 110}ms`);
        if (card) {
          el.style.setProperty("--rx", "12deg");
          el.style.setProperty("--ry", `${i % 2 === 0 ? -28 : 28}deg`);
        }
        el.classList.add("reveal-3d");

        // Animasyon bitince sınıfları kaldır; kartların kendi geçişleri geri gelsin
        el.addEventListener("transitionend", function done(event) {
          if (event.target !== el || event.propertyName !== "transform" || !el.classList.contains("is-in")) return;
          el.classList.remove("reveal-3d", "is-in");
          el.removeEventListener("transitionend", done);
        });

        revealObserver.observe(el);
      });
    });
  }

  /* ------------------------------------------------------------------
   * 8) Footer yılı
   * ------------------------------------------------------------------ */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
