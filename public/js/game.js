/* ==========================================================================
   game.js — Babylon.js 3D arena istemcisi
   Low-poly tema, neon ışıma, yumuşak kamera, nişan/atış, interpolasyon.
   ========================================================================== */
(function () {
  "use strict";
  const NA = (window.NA = window.NA || {});

  /* ---- Ayarlar -------------------------------------------------------- */
  const CFG = {
    arenaHalf: 30,
    bodyTurn: 11,           // gövde dönüş hızı (lerp katsayısı)
    inputHz: 20,            // sunucuya girdi gönderme sıklığı
    projectileSpeed: 62,    // mermi uçuş hızı (birim/saniye)
    cam: { height: 26, back: 21, lookY: 1.2 },
    menu: { radius: 8.6, height: 3.7, speed: 0.28, lookY: 1.15 },
    maxHp: 100,
  };

  const SKIN_COLORS = [
    "#2ee6ff", "#ff36b9", "#8a6bff", "#7dff6b", "#ffc24b", "#ff5e5e",
    "#4ad9ff", "#c07bff", "#5effd0", "#ffe45e", "#ff8a5e", "#9aa7ff",
  ];

  /* ---- Paylaşılan oyun verisi (sunucuyla tek kaynak) ------------------- */
  // Tank dengeleri ve haritalar shared/arena-data.js içinde tanımlıdır.
  const DATA = NA.ARENA_DATA || { TANKS: [], MAPS: {}, MAP_IDS: [], mapColliders: () => [] };
  const TANK_TYPES = DATA.TANKS;
  const tankSpec = (id) => TANK_TYPES.find((t) => t.id === id) || TANK_TYPES[0];

  const SUPER_DURATION = 5.5;   // saniye (sunucuyla aynı)
  const SUPER_COOLDOWN = 14;    // saniye
  const TURBO_MUL = 1.65;       // turbo: hız çarpanı
  const RAPID_CD_MUL = 0.35;    // hızlı atış: bekleme süresi çarpanı

  /* ---- Haritalar (paylaşılan veriden) --------------------------------- */
  // floor: zemin deseni ("grid" | "sand" | "ice" | "lava" | "forest")
  const MAPS = DATA.MAPS;
  const MAP_LIST = DATA.MAP_IDS.map((id) => ({ id, name: MAPS[id].name, tagline: MAPS[id].tagline }));

  const HBAR_BASE = -0.52;

  /* ---- Yardımcılar ---------------------------------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function lerpAngle(from, to, t) {
    return from + shortestAngle(from, to) * t;
  }
  function hexToColor3(hex) {
    return BABYLON.Color3.FromHexString(hex);
  }

  /* ====================================================================== */
  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.engine = null;
      this.scene = null;
      this.mode = "menu";          // 'menu' | 'play'
      this.selfId = null;
      this.selfRoot = null;
      this.tanks = new Map();      // id -> tank kaydı
      this.local = { x: 0, z: 0, a: 0, t: 0, hp: 100, maxHp: 100, tankId: null };
      this.localInit = false;
      this.aimAngle = 0;
      this.alive = true;
      this.keys = Object.create(null);
      this.pointer = { x: 0, y: 0 };
      this.inputAccum = 0;
      this.menuAngle = 0;
      this.hitFx = [];
      this.projectiles = [];
      this.time = 0;
      this.mapId = "neon";
      this.mapDef = MAPS.neon;
      this.arenaNodes = [];
      this.obstacleBoxes = [];

      // Lobide sergilenen tank (giriş ekranı + ana menü arka planı)
      this.previewTankId = "striker";
      this.previewSkin = 0;
      this._preview = null;

      // Atış bekleme süresi (istemci) + süper güç durumu (sunucudan senkronlanır)
      this.shootReadyAt = 0;
      this.superState = {
        kind: null,
        name: null,
        readyRemain: 0,     // ms — hazır olmasına kalan
        activeRemain: 0,    // ms — etkinin kalanı
        cooldown: SUPER_COOLDOWN * 1000,
        duration: SUPER_DURATION * 1000,
      };
      this.abilityAccum = 0;
      this._auraMesh = null;
      this._shieldMesh = null;
    }

    /* ---- Kurulum ------------------------------------------------------ */
    init() {
      const engine = new BABYLON.Engine(this.canvas, true, {
        preserveDrawingBuffer: false,
        stencil: true,
        antialias: true,
        powerPreference: "high-performance",
      }, true);
      this.engine = engine;

      const scene = new BABYLON.Scene(engine);
      scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
      this.scene = scene;

      this._buildLights();
      this._buildArena(this.mapId);
      this._buildGlow();
      this._buildCamera();
      this._buildInput();

      // Lobi: seçili tankı sergile (giriş ekranı arka planı)
      this.showLobby();

      scene.onBeforeRenderObservable.add(() => this._update(engine.getDeltaTime()));

      engine.runRenderLoop(() => scene.render());
      window.addEventListener("resize", () => engine.resize());
    }

    _buildLights() {
      const scene = this.scene;
      const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
      hemi.intensity = 0.55;
      hemi.diffuse = new BABYLON.Color3(0.55, 0.65, 1);
      hemi.groundColor = new BABYLON.Color3(0.16, 0.1, 0.3);
      this.hemi = hemi;

      const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.5, -1, 0.42), scene);
      dir.position = new BABYLON.Vector3(24, 40, -30);
      dir.intensity = 0.85;
      dir.diffuse = new BABYLON.Color3(0.75, 0.82, 1);
      this.dirLight = dir;
    }

    _buildGlow() {
      const glow = new BABYLON.GlowLayer("glow", this.scene, { blurKernelSize: 32 });
      glow.intensity = 0.85;
      this.glow = glow;
    }

    _buildArena(mapId) {
      const scene = this.scene;
      const def = MAPS[mapId] || MAPS.neon;
      this.mapDef = def;
      this.mapId = MAPS[mapId] ? mapId : "neon";

      // Önceki haritanın düğümlerini temizle (harita değişiminde)
      this.arenaNodes.forEach((n) => n.dispose());
      this.arenaNodes = [];
      if (this.shadowGen) { this.shadowGen.dispose(); this.shadowGen = null; }
      this.obstacleBoxes = [];

      // Atmosfer: arka plan + sis + zemin ışığı haritaya göre
      scene.clearColor = new BABYLON.Color4(def.clear[0], def.clear[1], def.clear[2], def.clear[3]);
      scene.fogColor = new BABYLON.Color3(def.fogColor[0], def.fogColor[1], def.fogColor[2]);
      scene.fogDensity = def.fogDensity;
      if (this.hemi) this.hemi.groundColor = new BABYLON.Color3(def.hemiGround[0], def.hemiGround[1], def.hemiGround[2]);

      const S = CFG.arenaHalf;
      const size = S * 2;
      const track = (m) => { this.arenaNodes.push(m); return m; };

      // Zemin: koyu yüzey + neon ızgara (emissive doku)
      const ground = track(BABYLON.MeshBuilder.CreateGround("ground", { width: size, height: size }, scene));
      ground.isPickable = false;
      const gm = new BABYLON.StandardMaterial("groundMat", scene);
      gm.diffuseColor = new BABYLON.Color3(0.04, 0.05, 0.1);
      gm.specularColor = new BABYLON.Color3(0.05, 0.06, 0.12);
      track(gm);

      const tex = this._floorTexture(def);
      track(tex);

      gm.emissiveTexture = tex;
      gm.emissiveColor = new BABYLON.Color3(1, 1, 1);
      gm.diffuseTexture = tex;
      ground.material = gm;
      ground.receiveShadows = true;

      // Duvar malzemesi
      const wallMat = new BABYLON.StandardMaterial("wallMat", scene);
      wallMat.diffuseColor = new BABYLON.Color3(def.wallDiff[0], def.wallDiff[1], def.wallDiff[2]);
      wallMat.emissiveColor = new BABYLON.Color3(def.wallEmis[0], def.wallEmis[1], def.wallEmis[2]);
      wallMat.specularColor = new BABYLON.Color3(0.1, 0.15, 0.3);
      track(wallMat);

      const edgeMat = new BABYLON.StandardMaterial("edgeMat", scene);
      edgeMat.emissiveColor = hexToColor3(def.edge);
      edgeMat.diffuseColor = new BABYLON.Color3(0.05, 0.1, 0.16);
      track(edgeMat);

      const shadowGen = new BABYLON.ShadowGenerator(1024, this.dirLight);
      shadowGen.useBlurExponentialShadowMap = true;
      shadowGen.blurKernel = 24;
      this.shadowGen = shadowGen;

      // Arena sınır duvarları (yükseklik haritaya göre değişir)
      const wallH = def.wallH || 2.4;
      const mk = (w, d, x, z) => {
        const b = track(BABYLON.MeshBuilder.CreateBox("wall", { width: w, height: wallH, depth: d }, scene));
        b.position.set(x, wallH / 2, z);
        b.material = wallMat;
        b.isPickable = false;
        shadowGen.addShadowCaster(b);
        const strip = track(BABYLON.MeshBuilder.CreateBox("strip", { width: w * 1.001, height: 0.1, depth: d * 1.001 }, scene));
        strip.position.set(x, wallH + 0.02, z);
        strip.material = edgeMat;
        strip.isPickable = false;
        return b;
      };
      const lim = S + 0.6;
      mk(size + 1.2, 1.2, 0, lim);
      mk(size + 1.2, 1.2, 0, -lim);
      mk(1.2, size + 1.2, lim, 0);
      mk(1.2, size + 1.2, -lim, 0);

      // Engeller (low-poly) — haritaya özel yerleşim; kutu veya silindir
      const obsMat = new BABYLON.StandardMaterial("obsMat", scene);
      obsMat.diffuseColor = new BABYLON.Color3(def.obsDiff[0], def.obsDiff[1], def.obsDiff[2]);
      obsMat.emissiveColor = new BABYLON.Color3(def.obsEmis[0], def.obsEmis[1], def.obsEmis[2]);
      obsMat.specularColor = new BABYLON.Color3(0.1, 0.14, 0.26);
      track(obsMat);

      const decorMat = new BABYLON.StandardMaterial("decorMat", scene);
      decorMat.diffuseColor = new BABYLON.Color3(def.obsDiff[0] * 1.25, def.obsDiff[1] * 1.25, def.obsDiff[2] * 1.25);
      decorMat.emissiveColor = new BABYLON.Color3(def.obsEmis[0], def.obsEmis[1], def.obsEmis[2]).scale(2.4);
      decorMat.specularColor = new BABYLON.Color3(0.22, 0.28, 0.45);
      track(decorMat);

      const isCyl = (o) => o.shape === "cyl";

      def.obstacles.forEach((o) => {
        const w = o.w;
        const d = o.d || o.w;
        const b = track(isCyl(o)
          ? BABYLON.MeshBuilder.CreateCylinder("obs", { diameter: w, height: o.h, tessellation: 9 }, scene)
          : BABYLON.MeshBuilder.CreateBox("obs", { width: w, height: o.h, depth: d }, scene));
        if (isCyl(o)) b.rotation.y = (o.x * 1.7 + o.z * 2.3) % (Math.PI / 5);
        b.position.set(o.x, o.h / 2, o.z);
        b.material = obsMat;
        b.isPickable = false;
        shadowGen.addShadowCaster(b);

        const top = track(isCyl(o)
          ? BABYLON.MeshBuilder.CreateCylinder("obsTop", { diameter: w * 1.02, height: 0.1, tessellation: 9 }, scene)
          : BABYLON.MeshBuilder.CreateBox("obsTop", { width: w * 1.001, height: 0.08, depth: d * 1.001 }, scene));
        top.position.set(o.x, o.h + 0.02, o.z);
        top.material = edgeMat;
        top.isPickable = false;
        this.obstacleBoxes.push({ x: o.x, z: o.z, hw: w / 2, hd: d / 2 });
      });

      // Dekor siluetleri: neon kule / kaya sütunu / buz kristali (perde hissi verir)
      (def.decor || []).forEach((o) => {
        const cone = o.shape === "cone";
        const m = track(cone
          ? BABYLON.MeshBuilder.CreateCylinder("decor", { diameterTop: o.d * 0.14, diameterBottom: o.d, height: o.h, tessellation: 7 }, scene)
          : BABYLON.MeshBuilder.CreateBox("decor", { width: o.d, height: o.h, depth: o.d }, scene));
        m.position.set(o.x, o.h / 2, o.z);
        m.material = decorMat;
        m.isPickable = false;
        shadowGen.addShadowCaster(m);

        const tip = track(cone
          ? BABYLON.MeshBuilder.CreateCylinder("decorTip", { diameter: o.d * 0.34, height: 0.16, tessellation: 7 }, scene)
          : BABYLON.MeshBuilder.CreateBox("decorTip", { width: o.d * 1.03, height: 0.12, depth: o.d * 1.03 }, scene));
        tip.position.set(o.x, o.h + 0.03, o.z);
        tip.material = edgeMat;
        tip.isPickable = false;

        // Arena içindeki dekora çarpma (duvar dibindekiler zaten duvarın ardında)
        if (Math.abs(o.x) < S - 2 && Math.abs(o.z) < S - 2) {
          this.obstacleBoxes.push({ x: o.x, z: o.z, hw: o.d / 2, hd: o.d / 2 });
        }
      });

      this.groundPlane = new BABYLON.Plane(0, 1, 0, 0);
    }

    // Harita zemin dokusu: ızgara / kum / buz deseni
    _floorTexture(def) {
      const tex = new BABYLON.DynamicTexture("floor", { width: 1024, height: 1024 }, this.scene, true);
      const g = tex.getContext();
      g.fillStyle = def.groundFill;
      g.fillRect(0, 0, 1024, 1024);
      const type = def.floor || "grid";

      if (type === "sand") {
        // Kum: benekli gürültü + dalga çizgileri + kaya halkaları
        for (let i = 0; i < 2600; i++) {
          const x = Math.random() * 1024;
          const y = Math.random() * 1024;
          g.fillStyle = "rgba(255,200,130," + (0.03 + Math.random() * 0.09).toFixed(3) + ")";
          g.beginPath();
          g.arc(x, y, 0.5 + Math.random() * 2.2, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = def.gridMinor;
        g.lineWidth = 2;
        for (let i = 0; i < 13; i++) {
          const y0 = i * (1024 / 13);
          g.beginPath();
          for (let x = 0; x <= 1024; x += 16) {
            const y = y0 + Math.sin((x / 1024) * Math.PI * 3 + i * 0.7) * 13;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        g.strokeStyle = def.ring1; g.lineWidth = 7;
        g.beginPath(); g.arc(512, 512, 168, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 248, 0, Math.PI * 2); g.stroke();
      } else if (type === "ice") {
        // Buz: kırık çatlaklar + don noktaları + halkalar
        g.strokeStyle = def.gridMinor;
        g.lineWidth = 2;
        for (let i = 0; i < 46; i++) {
          let x = Math.random() * 1024;
          let y = Math.random() * 1024;
          g.beginPath(); g.moveTo(x, y);
          const segs = 2 + Math.floor(Math.random() * 3);
          for (let s = 0; s < segs; s++) {
            x += (Math.random() * 2 - 1) * 150;
            y += (Math.random() * 2 - 1) * 150;
            g.lineTo(x, y);
          }
          g.stroke();
        }
        for (let i = 0; i < 1500; i++) {
          g.fillStyle = "rgba(220,250,255," + (0.04 + Math.random() * 0.11).toFixed(3) + ")";
          g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
        }
        g.strokeStyle = def.gridMajor; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 190, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 2;
        g.beginPath(); g.arc(512, 512, 272, 0, Math.PI * 2); g.stroke();
      } else if (type === "lava") {
        // Lav: akkor çatlaklar + sıcak közler (volkanik zemin)
        const rg = g.createRadialGradient(512, 512, 40, 512, 512, 700);
        rg.addColorStop(0, "rgba(255,130,40,0.34)");
        rg.addColorStop(0.55, "rgba(200,60,10,0.16)");
        rg.addColorStop(1, "rgba(120,20,0,0)");
        g.fillStyle = rg;
        g.fillRect(0, 0, 1024, 1024);

        g.lineCap = "round";
        for (let i = 0; i < 26; i++) {
          let x = Math.random() * 1024;
          let y = Math.random() * 1024;
          const pts = [[x, y]];
          const segs = 3 + Math.floor(Math.random() * 4);
          for (let s = 0; s < segs; s++) {
            x += (Math.random() * 2 - 1) * 170;
            y += (Math.random() * 2 - 1) * 170;
            pts.push([x, y]);
          }
          // Dış alev halesi
          g.strokeStyle = "rgba(255,110,20,0.32)";
          g.lineWidth = 12;
          g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) g.lineTo(pts[p][0], pts[p][1]);
          g.stroke();
          // Akkor çekirdek
          g.strokeStyle = "rgba(255,225,130,0.85)";
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) g.lineTo(pts[p][0], pts[p][1]);
          g.stroke();
        }

        for (let i = 0; i < 1200; i++) {
          g.fillStyle = "rgba(255," + (120 + Math.floor(Math.random() * 120)) + ",60," + (0.05 + Math.random() * 0.2).toFixed(3) + ")";
          g.beginPath();
          g.arc(Math.random() * 1024, Math.random() * 1024, 0.6 + Math.random() * 2.4, 0, Math.PI * 2);
          g.fill();
        }

        g.strokeStyle = def.ring1; g.lineWidth = 8;
        g.beginPath(); g.arc(512, 512, 172, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 250, 0, Math.PI * 2); g.stroke();
      } else if (type === "forest") {
        // Orman: yaprak gölgeleri + yosun benekleri + kök çizgileri
        for (let i = 0; i < 220; i++) {
          g.fillStyle = "rgba(0,0,0," + (0.06 + Math.random() * 0.12).toFixed(3) + ")";
          g.beginPath();
          g.arc(Math.random() * 1024, Math.random() * 1024, 14 + Math.random() * 46, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 2400; i++) {
          g.fillStyle = "rgba(" + (60 + Math.floor(Math.random() * 90)) + "," + (170 + Math.floor(Math.random() * 80)) + ",90," + (0.04 + Math.random() * 0.12).toFixed(3) + ")";
          g.beginPath();
          g.arc(Math.random() * 1024, Math.random() * 1024, 0.7 + Math.random() * 2.6, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = def.gridMinor; g.lineWidth = 2; g.lineCap = "round";
        for (let i = 0; i < 30; i++) {
          let x = Math.random() * 1024;
          let y = Math.random() * 1024;
          g.beginPath(); g.moveTo(x, y);
          const segs = 2 + Math.floor(Math.random() * 3);
          for (let s = 0; s < segs; s++) {
            x += (Math.random() * 2 - 1) * 130;
            y += (Math.random() * 2 - 1) * 130;
            g.lineTo(x, y);
          }
          g.stroke();
        }
        g.strokeStyle = def.ring1; g.lineWidth = 6;
        g.beginPath(); g.arc(512, 512, 165, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 244, 0, Math.PI * 2); g.stroke();
      } else if (type === "metal") {
        // Uzay istasyonu: metal panel derzleri + perçinler + neon şeritler
        const step = 128;
        for (let i = 0; i <= 8; i++) {
          g.strokeStyle = "rgba(150,190,230,0.10)";
          g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 1024); g.stroke();
          g.beginPath(); g.moveTo(0, i * step); g.lineTo(1024, i * step); g.stroke();
        }
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            g.strokeStyle = "rgba(190,215,245,0.06)";
            g.lineWidth = 1;
            g.strokeRect(px * step + 10, py * step + 10, step - 20, step - 20);
            // Perçinler (panel köşeleri)
            for (let c = 0; c < 4; c++) {
              const rx = px * step + (c % 2 ? step - 16 : 16);
              const ry = py * step + (c > 1 ? step - 16 : 16);
              g.fillStyle = "rgba(200,225,255,0.16)";
              g.beginPath(); g.arc(rx, ry, 2.2, 0, Math.PI * 2); g.fill();
            }
          }
        }
        // Soğuk neon şeritler
        for (let i = 0; i < 10; i++) {
          const horiz = i % 2 === 0;
          g.strokeStyle = def.gridMajor;
          g.lineWidth = 3;
          g.beginPath();
          const at = 40 + i * 100;
          if (horiz) { g.moveTo(0, at); g.lineTo(1024, at); }
          else { g.moveTo(at, 0); g.lineTo(at, 1024); }
          g.stroke();
        }
        for (let i = 0; i < 900; i++) {
          g.fillStyle = "rgba(170,210,255," + (0.03 + Math.random() * 0.07).toFixed(3) + ")";
          g.beginPath();
          g.arc(Math.random() * 1024, Math.random() * 1024, 0.5 + Math.random() * 1.8, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = def.ring1; g.lineWidth = 6;
        g.beginPath(); g.arc(512, 512, 168, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 246, 0, Math.PI * 2); g.stroke();
      } else if (type === "city") {
        // Gökdelen: asfalt + sarı şerit çizgileri + yaya geçidi
        for (let i = 0; i < 3200; i++) {
          g.fillStyle = "rgba(190,195,210," + (0.02 + Math.random() * 0.06).toFixed(3) + ")";
          g.beginPath();
          g.arc(Math.random() * 1024, Math.random() * 1024, 0.5 + Math.random() * 2.0, 0, Math.PI * 2);
          g.fill();
        }
        // Asfalt yamaları
        for (let i = 0; i < 40; i++) {
          g.fillStyle = "rgba(0,0,0," + (0.05 + Math.random() * 0.10).toFixed(3) + ")";
          g.beginPath();
          g.ellipse(Math.random() * 1024, Math.random() * 1024, 26 + Math.random() * 70, 18 + Math.random() * 50, Math.random() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        // Kesikli sarı yol çizgileri
        g.strokeStyle = def.gridMajor;
        g.lineWidth = 5;
        for (let d = 0; d < 1024; d += 88) {
          g.beginPath(); g.moveTo(d, 512 - 4); g.lineTo(d + 46, 512 - 4); g.stroke();
          g.beginPath(); g.moveTo(512 - 4, d); g.lineTo(512 - 4, d + 46); g.stroke();
        }
        // Yaya geçidi (kenarlarda)
        g.fillStyle = "rgba(235,235,245,0.16)";
        for (let s = 0; s < 7; s++) {
          g.fillRect(s * 26 + 8, 40, 15, 84);
          g.fillRect(s * 26 + 8, 1024 - 124, 15, 84);
        }
        g.strokeStyle = def.ring1; g.lineWidth = 6;
        g.beginPath(); g.arc(512, 512, 170, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2; g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 248, 0, Math.PI * 2); g.stroke();
      } else {
        // Neon ızgara
        const step = 1024 / 20;
        for (let i = 0; i <= 20; i++) {
          const major = i % 5 === 0;
          g.strokeStyle = major ? def.gridMajor : def.gridMinor;
          g.lineWidth = major ? 3 : 1.4;
          g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 1024); g.stroke();
          g.beginPath(); g.moveTo(0, i * step); g.lineTo(1024, i * step); g.stroke();
        }
        g.strokeStyle = def.ring1;
        g.lineWidth = 5;
        g.beginPath(); g.arc(512, 512, 150, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = def.ring2;
        g.lineWidth = 3;
        g.beginPath(); g.arc(512, 512, 230, 0, Math.PI * 2); g.stroke();
      }

      tex.update();
      return tex;
    }

    _buildCamera() {
      const cam = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, CFG.menu.height, -CFG.menu.radius), this.scene);
      cam.setTarget(new BABYLON.Vector3(0, 1, 0));
      cam.minZ = 0.5;
      cam.maxZ = 400;
      cam.fov = 0.85;
      this.scene.activeCamera = cam;
      this.camera = cam;
    }

    _buildInput() {
      window.addEventListener("keydown", (e) => {
        this.keys[e.code] = true;
        if (!e.repeat && (e.code === "Space" || e.code === "KeyQ")) this._trySuper();
        if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyQ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) {
          e.preventDefault();
        }
      });
      window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
      window.addEventListener("blur", () => { this.keys = Object.create(null); });

      const scene = this.scene;
      scene.onPointerObservable.add((pi) => {
        const evt = pi.event;
        if (evt) { this.pointer.x = scene.pointerX; this.pointer.y = scene.pointerY; }
        if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
          if (evt && evt.button === 2) { this._trySuper(); return; }   // sağ tık: süper güç
          if (evt && evt.button !== undefined && evt.button !== 0) return; // sadece sol tık
          this._tryShoot();
        }
      });
      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      this.canvas.addEventListener("pointermove", (e) => {
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
      });
    }

    /* ---- Tank görseli -------------------------------------------------- */
    _createTank(id, name, skin, tankId) {
      const scene = this.scene;
      const spec = tankSpec(tankId);
      const color = hexToColor3(SKIN_COLORS[skin % SKIN_COLORS.length]);
      const dark = color.scale(0.22);
      const darkC3 = new BABYLON.Color3(dark.r + 0.04, dark.g + 0.05, dark.b + 0.09);

      const root = new BABYLON.TransformNode("tank_" + id, scene);

      const hullMat = new BABYLON.StandardMaterial("hull_" + id, scene);
      hullMat.diffuseColor = darkC3;
      hullMat.emissiveColor = color.scale(0.12);
      hullMat.specularColor = color.scale(0.35);

      const accentMat = new BABYLON.StandardMaterial("acc_" + id, scene);
      accentMat.diffuseColor = color;
      accentMat.emissiveColor = color;
      accentMat.specularColor = new BABYLON.Color3(0, 0, 0);

      // Namlu/metal için hafif parlak çelik görünümü
      const metalMat = new BABYLON.StandardMaterial("metal_" + id, scene);
      metalMat.diffuseColor = new BABYLON.Color3(0.26, 0.30, 0.38);
      metalMat.emissiveColor = color.scale(0.06);
      metalMat.specularColor = new BABYLON.Color3(0.85, 0.9, 1);

      const meshes = [];
      const add = (m) => { m.metadata = { tankId: id }; meshes.push(m); return m; };

      const W = spec.wid;                 // gövde genişliği
      const L = spec.len;                 // gövde uzunluğu
      const trackW = Math.max(0.3, W * 0.22);
      const tx = W / 2 + trackW / 2 - 0.02;

      // Gövde
      const body = BABYLON.MeshBuilder.CreateBox("body", { width: W, height: 0.55, depth: L }, scene);
      body.material = hullMat; body.parent = root; body.position.y = 0.62; add(body);

      // Paletler
      const trackL = BABYLON.MeshBuilder.CreateBox("tL", { width: trackW, height: 0.42, depth: L + 0.2 }, scene);
      trackL.material = accentMat; trackL.parent = root; trackL.position.set(-tx, 0.3, 0); add(trackL);
      const trackR = BABYLON.MeshBuilder.CreateBox("tR", { width: trackW, height: 0.42, depth: L + 0.2 }, scene);
      trackR.material = accentMat; trackR.parent = root; trackR.position.set(tx, 0.3, 0); add(trackR);

      // Palet dişli tekerlek izi (ince çizgi şeritleri)
      const stripL = BABYLON.MeshBuilder.CreateBox("sL", { width: trackW * 1.05, height: 0.06, depth: (L + 0.2) * 0.92 }, scene);
      stripL.material = hullMat; stripL.parent = root; stripL.position.set(-tx, 0.53, 0); add(stripL);
      const stripR = BABYLON.MeshBuilder.CreateBox("sR", { width: trackW * 1.05, height: 0.06, depth: (L + 0.2) * 0.92 }, scene);
      stripR.material = hullMat; stripR.parent = root; stripR.position.set(tx, 0.53, 0); add(stripR);

      // Eğimli ön zırh plakası
      const plate = BABYLON.MeshBuilder.CreateBox("plate", { width: W * 0.95, height: 0.34, depth: 0.25 }, scene);
      plate.material = hullMat; plate.parent = root; plate.position.set(0, 0.62, L / 2 + 0.02);
      plate.rotation.x = -0.35; add(plate);

      // Arka egzoz ızgarası
      const exhaust = BABYLON.MeshBuilder.CreateBox("exh", { width: W * 0.6, height: 0.28, depth: 0.12 }, scene);
      exhaust.material = accentMat; exhaust.parent = root; exhaust.position.set(0, 0.72, -L / 2 - 0.02); add(exhaust);

      // Taret (ayrı döner)
      const turret = new BABYLON.TransformNode("turret_" + id, scene);
      turret.parent = root; turret.position.y = 1.05;

      const turretMesh = BABYLON.MeshBuilder.CreateCylinder("tm", { diameterTop: W * 0.62, diameterBottom: W * 0.78, height: 0.5, tessellation: 10 }, scene);
      turretMesh.material = hullMat; turretMesh.parent = turret; turretMesh.position.y = 0.2; add(turretMesh);

      // Taret arka sandık (hacim hissi)
      const bustle = BABYLON.MeshBuilder.CreateBox("bustle", { width: W * 0.66, height: 0.26, depth: 0.4 }, scene);
      bustle.material = hullMat; bustle.parent = turret; bustle.position.set(0, 0.24, -W * 0.5); add(bustle);

      // Top kalkanı (mantlet)
      const mantlet = BABYLON.MeshBuilder.CreateBox("mantlet", { width: W * 0.46, height: 0.4, depth: 0.28 }, scene);
      mantlet.material = metalMat; mantlet.parent = turret; mantlet.position.set(0, 0.28, W * 0.36); add(mantlet);

      // Namlu grubu (geri tepme bu düğümde oynar)
      const barrelPivot = new BABYLON.TransformNode("bp_" + id, scene);
      const baseZ = W * 0.34;
      barrelPivot.parent = turret;
      barrelPivot.position.set(0, 0.28, baseZ);

      const bl = L * 0.82;                 // namlu uzunluğu
      const gr = W * 0.055 + 0.03;         // namlu yarıçapı

      // Namlu dip bileziği
      const collar = BABYLON.MeshBuilder.CreateCylinder("collar", { diameter: gr * 3.4, height: 0.22, tessellation: 12 }, scene);
      collar.material = metalMat; collar.parent = barrelPivot;
      collar.rotation.x = Math.PI / 2; collar.position.z = 0.05; add(collar);

      // Ana namlu
      const barrel = BABYLON.MeshBuilder.CreateCylinder("barrel", { diameter: gr * 2, height: bl, tessellation: 12 }, scene);
      barrel.material = metalMat; barrel.parent = barrelPivot;
      barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.1 + bl / 2; add(barrel);

      // Namlu ucu freni (muzzle brake)
      const muzzle = BABYLON.MeshBuilder.CreateCylinder("muzzle", { diameter: gr * 2.5, height: bl * 0.16, tessellation: 12 }, scene);
      muzzle.material = accentMat; muzzle.parent = barrelPivot;
      muzzle.rotation.x = Math.PI / 2; muzzle.position.z = 0.1 + bl + bl * 0.08; add(muzzle);

      // İsim etiketi
      const plate2 = this._makeNameplate(id, name, color);
      plate2.parent = root; plate2.position.y = 2.5;

      // Gölge
      meshes.forEach((m) => this.shadowGen.addShadowCaster(m));

      const record = {
        id, name, skin,
        tank: spec.id, spec,
        root, turret, meshes, nameplate: plate2,
        tracks: [trackL, trackR],
        accentMat, accentBase: color.clone(),
        metalMat, metalBase: metalMat.emissiveColor.clone(),
        barrelPivot, barrelBaseZ: baseZ, recoil: 0,
        muzzleReach: baseZ + 0.1 + bl + bl * 0.16,
        target: { x: 0, z: 0, a: 0, t: 0 },
        cur: { x: 0, z: 0, a: 0, t: 0 },
        alive: true,
        kills: 0,
        isSelf: id === this.selfId,
      };
      this.tanks.set(id, record);
      return record;
    }

    _makeNameplate(id, name, color) {
      const dt = new BABYLON.DynamicTexture("np_" + id, { width: 256, height: 64 }, this.scene, true);
      dt.hasAlpha = true;
      const ctx = dt.getContext();
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = "bold 30px Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, 128, 34);
      dt.update();

      const plane = BABYLON.MeshBuilder.CreatePlane("npp", { width: 3.2, height: 0.8 }, this.scene);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      const mat = new BABYLON.StandardMaterial("npm_" + id, this.scene);
      mat.diffuseTexture = dt;
      mat.emissiveTexture = dt;
      mat.opacityTexture = dt;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      plane.material = mat;
      return plane;
    }

    /* ---- Oyun kontrolü -------------------------------------------------- */
    // Lobi: seçili tankı neon arenada sergiler (giriş ekranı + ana menü arka planı)
    showLobby() {
      this.mode = "menu";
      this.alive = false;
      this.keys = Object.create(null);
      if (this.mapId !== "neon" || !this.arenaNodes.length) this._buildArena("neon");
      this.menuAngle = Math.PI * 0.5;
      this.camera.position.set(CFG.menu.radius, CFG.menu.height, 0);
      this.camera.setTarget(new BABYLON.Vector3(0, CFG.menu.lookY, 0));
      this.setPreviewTank(this.previewTankId);
    }

    // Lobi sergi tankını ayarla (seçim değişince çağrılır)
    setPreviewTank(tankId) {
      if (tankId) this.previewTankId = tankId;
      if (!this.scene || this.mode !== "menu") return;   // sahne hazır değilse showLobby uygular
      this._clearPreview();

      const rec = this._createTank("__preview__", "", this.previewSkin, this.previewTankId);
      if (rec.nameplate) rec.nameplate.setEnabled(false);
      rec.root.position.set(0, 0, 0);

      // Gövde rengini tankın kendi rengine uydur (kart rengiyle bütünlük)
      const hue = hexToColor3(tankSpec(this.previewTankId).hue);
      rec.accentMat.diffuseColor = hue;
      rec.accentMat.emissiveColor = hue;
      rec.accentBase = hue.clone();
      rec.metalMat.emissiveColor = hue.scale(0.06);
      rec.metalBase = rec.metalMat.emissiveColor.clone();

      this._preview = rec;
    }

    _clearPreview() {
      const p = this._preview;
      if (!p) return;
      p.meshes.forEach((m) => m.dispose());
      if (p.barrelPivot) p.barrelPivot.dispose();
      if (p.nameplate) p.nameplate.dispose();
      p.root.dispose();
      this.tanks.delete(p.id);
      this._preview = null;
    }

    enterPlay(roomName, mapId) {
      this._clearPreview();      // sergi tankı maça taşınmasın
      this.mode = "play";
      this.roomName = roomName;
      if (mapId && MAPS[mapId] && mapId !== this.mapId) this._buildArena(mapId);
      this.keys = Object.create(null);
      this.localInit = false;
      this.alive = true;
      this.shootReadyAt = 0;
      this._resetSuper();
      if (NA.UI) NA.UI.updateAbilities(null);
    }

    // Sunucudan gelen karşılama: tank sınıfı + süper güç bilgisi
    handleWelcome(msg) {
      if (!msg) return;
      if (msg.tank) this.local.tankId = msg.tank;
      if (msg.superKind) this.superState.kind = msg.superKind;
      if (msg.superName) this.superState.name = msg.superName;
      if (msg.superCooldown) this.superState.cooldown = msg.superCooldown;
      if (msg.superDuration) this.superState.duration = msg.superDuration;
      if (msg.map && MAPS[msg.map] && msg.map !== this.mapId) this._buildArena(msg.map);
      if (!this.superState.name) this._resetSuper();
    }

    // Yerel süper güç durumunu tank sınıfına göre başlat
    _resetSuper() {
      const s = tankSpec(this.local.tankId).super;
      this.superState.kind = s ? s.kind : null;
      this.superState.name = s ? s.name : "SÜPER";
      this.superState.readyRemain = 0;
      this.superState.activeRemain = 0;
    }

    exitToMenu() {
      this.clearAllTanks();
      this.selfId = null;
      this.selfRoot = null;
      this.shootReadyAt = 0;
      if (NA.UI) NA.UI.updateAbilities(null);
      this.showLobby();
    }

    clearAllTanks() {
      this.tanks.forEach((t) => {
        t.meshes.forEach((m) => m.dispose());
        if (t.barrelPivot) t.barrelPivot.dispose();
        if (t.nameplate) t.nameplate.dispose();
        t.root.dispose();
      });
      this.tanks.clear();
      this.hitFx.forEach((f) => f.mesh.dispose());
      this.hitFx = [];
      this.projectiles.forEach((p) => p.mesh.dispose());
      this.projectiles = [];
      this._auraMesh = null;
      this._shieldMesh = null;
      this._preview = null;
    }

    setSelf(id, name, skin) {
      this.selfId = id;
      let tank = this.tanks.get(id);
      if (!tank) tank = this._createTank(id, name, skin);
      tank.isSelf = true;
      tank.root.setEnabled(true);
      this.selfRoot = tank.root;
    }

    /* ---- Ağ olayları ---------------------------------------------------- */
    handleState(msg) {
      if (this.mode !== "play" || !msg || !msg.p) return;
      const seen = Object.create(null);

      for (let k = 0; k < msg.p.length; k++) {
        const p = msg.p[k];
        seen[p.i] = true;
        let tank = this.tanks.get(p.i);

        if (!tank) {
          tank = this._createTank(p.i, p.n, p.s, p.tk);
          tank.target.x = p.x; tank.target.z = p.z;
          tank.cur.x = p.x; tank.cur.z = p.z;
          tank.root.position.set(p.x, 0, p.z);
        }

        tank.target.x = p.x;
        tank.target.z = p.z;
        tank.target.a = p.a;
        tank.target.t = p.t;
        tank.kills = p.k;
        tank.alive = p.al !== 0;
        tank.isSelf = (p.i === this.selfId);
        tank.root.setEnabled(tank.alive);

        if (p.i === this.selfId) {
          // Kendi konumumuz yerel simülasyondan gelir; ilk durumda buradan başlat.
          if (!this.localInit) {
            this.local.x = p.x;
            this.local.z = p.z;
            this.local.a = p.a;
            this.local.t = p.t;
            this.localInit = true;
          }
          this.local.hp = p.h;
          this.local.maxHp = p.mh || 100;
          this.local.tankId = p.tk || this.local.tankId;
          this.selfTrophies = p.tr;
          this.selfKills = p.k;
          this.selfDeaths = p.d;
          this.selfName = p.n;
          this.selfSkin = p.s;

          // Süper güç: sunucu otoritesinden senkronla (ms)
          if (!this.superState.kind) {
            const ss = tankSpec(this.local.tankId).super;
            this.superState.kind = ss ? ss.kind : null;
            this.superState.name = ss ? ss.name : "SÜPER";
          }
          if (Number.isFinite(p.spr)) this.superState.readyRemain = Math.max(0, p.spr);
          if (Number.isFinite(p.sp)) this.superState.activeRemain = Math.max(0, p.sp);
        }
      }

      // Artık olmayan tankları kaldır
      this.tanks.forEach((t, id) => {
        if (!seen[id]) {
          t.meshes.forEach((m) => m.dispose());
          if (t.barrelPivot) t.barrelPivot.dispose();
          if (t.nameplate) t.nameplate.dispose();
          t.root.dispose();
          this.tanks.delete(id);
        }
      });

      // HUD'u güncelle
      if (NA.UI) NA.UI.updateHud(this._hudData(msg));
    }

    _hudData(msg) {
      const list = msg.p.slice().sort((a, b) => (b.k - a.k) || (a.d - b.d)).slice(0, 6);
      return {
        roomName: this.roomName || "Arena",
        self: {
          hp: this.local.hp,
          maxHp: this.local.maxHp || 100,
          kills: this.selfKills || 0,
          deaths: this.selfDeaths || 0,
          trophies: this.selfTrophies || 0,
        },
        players: list.map((p) => ({ name: p.n, kills: p.k, me: p.i === this.selfId })),
      };
    }

    handleShot(msg) {
      if (this.mode !== "play") return;
      if (msg.id === this.selfId) return; // kendi atışımızı yerelde zaten çizdik
      const tank = this.tanks.get(msg.id);
      if (!tank) return;
      const a = Number.isFinite(msg.a) ? msg.a : tank.cur.t;
      const reach = tank.muzzleReach || 1.7;
      const origin = new BABYLON.Vector3(msg.x + Math.sin(a) * reach, 1.35, msg.z + Math.cos(a) * reach);
      const dir = new BABYLON.Vector3(Math.sin(a), 0, Math.cos(a));
      const host = this.tanks.get(msg.hit);
      const to = host
        ? new BABYLON.Vector3(host.cur.x, 1.2, host.cur.z)
        : origin.add(dir.scale(42));
      const color = hexToColor3(SKIN_COLORS[tank.skin % SKIN_COLORS.length]);
      this._spawnProjectile(origin, to, color, !!host, !!msg.charged);
      this._muzzleFlash(tank, reach);
      tank.recoil = 1;
    }

    handleHit(msg) {
      if (this.mode !== "play") return;
      // İsabet görseli merminin varışında çizilir; burada yalnızca arayüz tepkisi verilir.
      if (msg.byId === this.selfId && NA.UI) NA.UI.showHitmarker();
      if (msg.targetId === this.selfId && NA.UI) NA.UI.flashDamage();
    }

    handleKill(msg) {
      if (NA.UI) NA.UI.pushKillFeed(msg);
      if (msg.victimId === this.selfId) {
        this.alive = false;
        if (NA.UI) NA.UI.showRespawn(msg.killerName);
      }
      if (msg.killerId === this.selfId && msg.victimId !== this.selfId) {
        if (NA.UI) NA.UI.showKillConfirm(msg.victimName);
      }
    }

    handleRespawn(msg) {
      if (msg.id === this.selfId) {
        this.local.x = msg.x;
        this.local.z = msg.z;
        this.alive = true;
        this.shootReadyAt = 0;
        if (this.selfRoot) this.selfRoot.position.set(msg.x, 0, msg.z);
        if (NA.UI) NA.UI.hideRespawn();
      }
      const tank = this.tanks.get(msg.id);
      if (tank) { tank.target.x = msg.x; tank.target.z = msg.z; tank.cur.x = msg.x; tank.cur.z = msg.z; }
    }

    /* ---- Girdi & simülasyon -------------------------------------------- */
    // Geçerli atış bekleme süresi (HIZLI ATIŞ süper gücü kısaltır)
    _shootCooldown() {
      const spec = tankSpec(this.local.tankId);
      const rapid = this.superState.activeRemain > 0 && this.superState.kind === "rapid";
      return spec.cooldown * (rapid ? RAPID_CD_MUL : 1);
    }

    _tryShoot() {
      if (this.mode !== "play" || !this.alive) return;
      const now = performance.now();
      if (now < this.shootReadyAt) return;      // mermi başı bekleme süresi
      this.shootReadyAt = now + this._shootCooldown();

      const charged = this.superState.activeRemain > 0 && this.superState.kind === "charge";
      const scene = this.scene;
      const ray = scene.createPickingRay(this.pointer.x, this.pointer.y, BABYLON.Matrix.Identity(), this.camera);
      const pick = scene.pickWithRay(ray, (m) => !!(m.metadata && m.metadata.tankId));
      let targetId = null;
      if (pick && pick.hit && pick.pickedMesh && pick.pickedMesh.metadata) {
        const tid = pick.pickedMesh.metadata.tankId;
        if (tid !== this.selfId) targetId = tid;
      }

      const self = this.tanks.get(this.selfId);
      const reach = self ? self.muzzleReach : 1.7;
      const origin = new BABYLON.Vector3(
        this.local.x + Math.sin(this.aimAngle) * reach,
        1.35,
        this.local.z + Math.cos(this.aimAngle) * reach
      );
      const dir = new BABYLON.Vector3(Math.sin(this.aimAngle), 0, Math.cos(this.aimAngle));
      const target = targetId ? this.tanks.get(targetId) : null;
      const to = target
        ? new BABYLON.Vector3(target.cur.x, 1.2, target.cur.z)
        : origin.add(dir.scale(42));

      const color = self ? hexToColor3(SKIN_COLORS[self.skin % SKIN_COLORS.length]) : hexToColor3("#2ee6ff");
      this._spawnProjectile(origin, to, color, !!target, charged);
      if (self) { this._muzzleFlash(self, reach); self.recoil = 1; }

      NA.net.send("shoot", { targetId, a: this.aimAngle });
    }

    // Süper güç kullan: sunucu otoritesi onaylar, geri bildirim "super" mesajıyla gelir
    _trySuper() {
      if (this.mode !== "play" || !this.alive) return;
      if (this.superState.readyRemain > 0) {
        if (NA.UI) NA.UI.toast(this.superState.name + " henüz hazır değil", "err");
        return;
      }
      NA.net.send("super");
    }

    // Sunucudan gelen süper güç aktivasyonu (kendimiz veya rakip)
    handleSuper(msg) {
      if (this.mode !== "play" || !msg) return;
      const tank = this.tanks.get(msg.id);
      if (tank) this._superBurst(tank);
      if (msg.id === this.selfId) {
        this.superState.kind = msg.kind || this.superState.kind;
        this.superState.name = msg.name || this.superState.name;
        this.superState.activeRemain = msg.duration || this.superState.duration;
        this.superState.readyRemain = this.superState.cooldown;
        if (NA.UI) NA.UI.showSuperUsed(this.superState.name);
      } else if (NA.UI) {
        const who = tank ? tank.name : "Rakip";
        NA.UI.toast(who + " → " + (msg.name || "SÜPER"), "ok");
      }
    }

    // Süper güç patlama efekti (kısa süreli halka)
    _superBurst(tank) {
      if (!tank) return;
      const s = BABYLON.MeshBuilder.CreateTorus("superBurst", { diameter: 3.2, thickness: 0.22, tessellation: 24 }, this.scene);
      s.parent = tank.root;
      s.position.y = 0.9;
      s.isPickable = false;
      const m = new BABYLON.StandardMaterial("superBurstMat", this.scene);
      m.emissiveColor = hexToColor3(this._superColor(tank.spec.id));
      m.disableLighting = true;
      s.material = m;
      this.hitFx.push({ mesh: s, life: 0.45, max: 0.45 });
    }

    _superColor(tankId) {
      switch (tankSpec(tankId).super && tankSpec(tankId).super.kind) {
        case "turbo": return "#7dff6b";
        case "shield": return "#ff8a5e";
        case "heal": return "#5effd0";
        case "rapid": return "#ffc24b";
        default: return "#ffd166";
      }
    }

    // Mermi yolundaki ilk engelin kesişim oranı (yoksa null) — mermiler duvardan geçmez
    _segmentHit(x0, z0, x1, z1) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      let best = null;
      for (let i = 0; i < this.obstacleBoxes.length; i++) {
        const o = this.obstacleBoxes[i];
        const minX = o.x - o.hw, maxX = o.x + o.hw;
        const minZ = o.z - o.hd, maxZ = o.z + o.hd;
        let t0 = 0, t1 = 1;

        if (Math.abs(dx) < 1e-6) {
          if (x0 < minX || x0 > maxX) continue;
        } else {
          let ta = (minX - x0) / dx, tb = (maxX - x0) / dx;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }
        if (Math.abs(dz) < 1e-6) {
          if (z0 < minZ || z0 > maxZ) continue;
        } else {
          let ta = (minZ - z0) / dz, tb = (maxZ - z0) / dz;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }

        if (t0 > t1) continue;
        if (t0 > 0.0001 && t0 < 1 && (best === null || t0 < best)) best = t0;
      }
      return best;
    }

    // Gerçek uçuşan mermi: parlak, uçuş yönünde uzatılmış küre + varışta isabet efekti
    _spawnProjectile(from, to, color, hit, charged) {
      // Yolda engel varsa mermi duvarda durur ve isabet sayılmaz
      let end = to;
      let hitNow = hit;
      const tHit = this._segmentHit(from.x, from.z, to.x, to.z);
      if (tHit !== null) {
        end = BABYLON.Vector3.Lerp(from, to, tHit);
        hitNow = false;
      }

      const dir = end.subtract(from);
      const dist = Math.max(0.001, dir.length());
      const mesh = BABYLON.MeshBuilder.CreateSphere("proj", { diameter: charged ? 0.62 : 0.34, segments: 6 }, this.scene);
      mesh.position.copyFrom(from);
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      mesh.scaling.set(1, 1, charged ? 3.2 : 2.4);
      mesh.isPickable = false;
      const col = charged ? hexToColor3("#ffd166") : color;
      const m = new BABYLON.StandardMaterial("projMat", this.scene);
      m.emissiveColor = col;
      m.diffuseColor = col.scale(0.4);
      m.disableLighting = true;
      mesh.material = m;
      this.projectiles.push({
        mesh, from: from.clone(), to: end.clone(), color: col, hit: hitNow,
        dur: Math.max(0.09, dist / CFG.projectileSpeed), t: 0,
      });
    }

    _spawnImpact(pos, color) {
      const s = BABYLON.MeshBuilder.CreateSphere("impact", { diameter: 0.5, segments: 6 }, this.scene);
      s.position.copyFrom(pos);
      s.isPickable = false;
      const m = new BABYLON.StandardMaterial("impMat", this.scene);
      m.emissiveColor = color;
      m.disableLighting = true;
      s.material = m;
      this.hitFx.push({ mesh: s, life: 0.3, max: 0.3 });
    }

    _muzzleFlash(tank, reach) {
      if (!tank) return;
      const turret = tank.turret;
      const s = BABYLON.MeshBuilder.CreateSphere("flash", { diameter: 0.7, segments: 6 }, this.scene);
      s.parent = turret;
      s.position.set(0, 0.28, reach || 1.8);
      s.isPickable = false;
      const m = new BABYLON.StandardMaterial("flashMat", this.scene);
      m.emissiveColor = hexToColor3("#fff3b0");
      m.disableLighting = true;
      s.material = m;
      this.hitFx.push({ mesh: s, life: 0.12, max: 0.12 });
    }

    _resolveObstacles(x, z) {
      const r = 1.05;
      for (let i = 0; i < this.obstacleBoxes.length; i++) {
        const o = this.obstacleBoxes[i];
        const dx = x - o.x;
        const dz = z - o.z;
        const ox = o.hw + r - Math.abs(dx);
        const oz = o.hd + r - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) x = o.x + Math.sign(dx || 1) * (o.hw + r);
          else z = o.z + Math.sign(dz || 1) * (o.hd + r);
        }
      }
      return { x, z };
    }

    /* ---- Ana güncelleme ------------------------------------------------ */
    _update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      this.time += dt;

      // Tracer / impact efektlerini sönümle
      this._updateFx(dt);

      if (this.mode === "menu") {
        // Lobide kamera, sergilenen tankın çevresinde yavaşça döner
        this.menuAngle += dt * CFG.menu.speed;
        const r = CFG.menu.radius;
        this.camera.position.set(Math.sin(this.menuAngle) * r, CFG.menu.height, Math.cos(this.menuAngle) * r);
        this.camera.setTarget(new BABYLON.Vector3(0, CFG.menu.lookY, 0));
        if (this._preview) {
          this._preview.root.rotation.y = Math.sin(this.time * 0.6) * 0.22;
          this._preview.root.position.y = Math.sin(this.time * 1.4) * 0.025;
        }
        return;
      }

      // --- Yerel hareket ---
      let mx = 0, mz = 0;
      const k = this.keys;
      if (k["KeyW"] || k["ArrowUp"]) mz += 1;
      if (k["KeyS"] || k["ArrowDown"]) mz -= 1;
      if (k["KeyD"] || k["ArrowRight"]) mx += 1;
      if (k["KeyA"] || k["ArrowLeft"]) mx -= 1;

      const moving = (mx !== 0 || mz !== 0) && this.alive;
      if (moving) {
        const len = Math.hypot(mx, mz) || 1;
        mx /= len; mz /= len;
        const spec = tankSpec(this.local.tankId);
        const turbo = this.superState.activeRemain > 0 && this.superState.kind === "turbo";
        const spd = spec.speed * (turbo ? ((spec.super && spec.super.speedMul) || TURBO_MUL) : 1);
        let nx = this.local.x + mx * spd * dt;
        let nz = this.local.z + mz * spd * dt;
        const solved = this._resolveObstacles(nx, nz);
        this.local.x = clamp(solved.x, -CFG.arenaHalf + 1, CFG.arenaHalf - 1);
        this.local.z = clamp(solved.z, -CFG.arenaHalf + 1, CFG.arenaHalf - 1);

        const targetA = Math.atan2(mx, mz);
        this.local.a = lerpAngle(this.local.a, targetA, Math.min(1, dt * CFG.bodyTurn));
      }

      // --- Nişan alma ---
      const ray = this.scene.createPickingRay(this.pointer.x, this.pointer.y, BABYLON.Matrix.Identity(), this.camera);
      const d = ray.intersectsPlane(this.groundPlane);
      if (d && d > 0) {
        const px = ray.origin.x + ray.direction.x * d;
        const pz = ray.origin.z + ray.direction.z * d;
        const dx = px - this.local.x;
        const dz = pz - this.local.z;
        if (dx * dx + dz * dz > 0.01) this.aimAngle = Math.atan2(dx, dz);
      }
      this.local.t = this.aimAngle;

      // --- Kendi tankını uygula ---
      const self = this.tanks.get(this.selfId);
      if (self) {
        self.cur.x = self.target.x = this.local.x;
        self.cur.z = self.target.z = this.local.z;
        self.cur.a = self.target.a = this.local.a;
        self.cur.t = self.target.t = this.local.t;
        self.root.position.set(this.local.x, 0, this.local.z);
        self.root.rotation.y = this.local.a;
        // Taret, gövdeye GÖRE döner: dünya açısı = gövde + taret → imleci tam izler
        self.turret.rotation.y = shortestAngle(this.local.a, this.local.t);
      }

      // --- Diğer tankları enterpole et ---
      const lerp = Math.min(1, dt * 14);
      this.tanks.forEach((t) => {
        if (t.isSelf) return;
        t.cur.x += (t.target.x - t.cur.x) * lerp;
        t.cur.z += (t.target.z - t.cur.z) * lerp;
        t.cur.a = lerpAngle(t.cur.a, t.target.a, lerp);
        t.cur.t = lerpAngle(t.cur.t, t.target.t, lerp);
        t.root.position.set(t.cur.x, 0, t.cur.z);
        t.root.rotation.y = t.cur.a;
        t.turret.rotation.y = shortestAngle(t.cur.a, t.cur.t);
      });

      // --- Namlu geri tepmesi (tüm tanklar) ---
      this.tanks.forEach((t) => {
        if (t.barrelPivot && t.recoil > 0) {
          t.recoil = Math.max(0, t.recoil - dt * 6);
          t.barrelPivot.position.z = t.barrelBaseZ - t.recoil * 0.32;
        }
      });

      // --- Kamera takibi ---
      const cam = this.camera;
      cam.position.set(this.local.x, CFG.cam.height, this.local.z - CFG.cam.back);
      cam.setTarget(new BABYLON.Vector3(this.local.x, CFG.cam.lookY, this.local.z));

      // --- Süper güç zamanlayıcıları ve görsel efekt ---
      this.superState.readyRemain = Math.max(0, this.superState.readyRemain - dtMs);
      this.superState.activeRemain = Math.max(0, this.superState.activeRemain - dtMs);
      this._updateSuperFx();

      // --- Yetenek HUD'u (atış bekleme + süper güç) ---
      this.abilityAccum += dtMs;
      if (this.abilityAccum >= 50 && NA.UI) {
        this.abilityAccum = 0;
        NA.UI.updateAbilities(this._abilityData());
      }

      // --- Sunucuya girdi gönder ---
      this.inputAccum += dt;
      const step = 1 / CFG.inputHz;
      if (this.inputAccum >= step) {
        this.inputAccum = 0;
        NA.net.send("input", {
          x: this.local.x,
          z: this.local.z,
          a: this.local.a,
          t: this.local.t,
        });
      }
    }

    _updateFx(dt) {
      // Uçuşan mermiler
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.mesh.position.copyFrom(BABYLON.Vector3.Lerp(p.from, p.to, k));
        if (k >= 1) {
          this._spawnImpact(p.to, p.hit ? hexToColor3("#ffd166") : p.color);
          p.mesh.material.dispose();
          p.mesh.dispose();
          this.projectiles.splice(i, 1);
        }
      }
      // İsabet/namlu efektleri
      for (let i = this.hitFx.length - 1; i >= 0; i--) {
        const f = this.hitFx[i];
        f.life -= dt;
        if (f.life <= 0) { f.mesh.dispose(); this.hitFx.splice(i, 1); }
        else {
          const k = f.life / f.max;
          f.mesh.alpha = k;
          f.mesh.scaling.setAll(1 + (1 - k) * 1.6);
        }
      }
    }

    // Yetenek HUD verisi: atış bekleme oranı + süper güç durumu
    _abilityData() {
      const s = this.superState;
      const now = performance.now();
      return {
        shootPct: clamp(1 - (this.shootReadyAt - now) / (this._shootCooldown() || 1), 0, 1),
        superPct: clamp(1 - s.readyRemain / (s.cooldown || 1), 0, 1),
        superActivePct: clamp(s.activeRemain / (s.duration || 1), 0, 1),
        superReady: s.readyRemain <= 0,
        superActive: s.activeRemain > 0,
        superName: s.name || "SÜPER",
        superKind: s.kind,
      };
    }

    // Aktif süper gücün görsel etkileri (kendi tankımız)
    _updateSuperFx() {
      const self = this.tanks.get(this.selfId);
      if (!self) return;
      const active = this.superState.activeRemain > 0 && !!this.superState.kind;
      const kind = this.superState.kind;
      const c = hexToColor3(this._superColor(self.spec.id));

      // Zemin halkası (aura)
      if (active) {
        if (!this._auraMesh) {
          const t = BABYLON.MeshBuilder.CreateTorus("aura", { diameter: self.spec.wid * 2.8, thickness: 0.1, tessellation: 26 }, this.scene);
          t.isPickable = false;
          const m = new BABYLON.StandardMaterial("auraMat", this.scene);
          m.disableLighting = true;
          t.material = m;
          this._auraMesh = t;
        }
        if (this._auraMesh.parent !== self.root) this._auraMesh.parent = self.root;
        this._auraMesh.setEnabled(true);
        this._auraMesh.position.set(0, 0.16, 0);
        this._auraMesh.rotation.y = this.time * 3.4;
        this._auraMesh.material.emissiveColor = c;
        this._auraMesh.material.alpha = 0.55 + Math.sin(this.time * 9) * 0.25;
      } else if (this._auraMesh) {
        this._auraMesh.setEnabled(false);
      }

      // Kalkan küresi (AĞIR)
      if (kind === "shield") {
        if (!this._shieldMesh) {
          const sp = BABYLON.MeshBuilder.CreateSphere("shield", { diameter: self.spec.wid * 3.8, segments: 10 }, this.scene);
          sp.isPickable = false;
          const m = new BABYLON.StandardMaterial("shieldMat", this.scene);
          m.emissiveColor = c;
          m.diffuseColor = c.scale(0.3);
          m.backFaceCulling = false;
          sp.material = m;
          this._shieldMesh = sp;
        }
        if (this._shieldMesh.parent !== self.root) this._shieldMesh.parent = self.root;
        this._shieldMesh.setEnabled(active);
        this._shieldMesh.position.set(0, 1.0, 0);
        if (active) this._shieldMesh.material.alpha = 0.14 + (Math.sin(this.time * 8) + 1) * 0.05;
      } else if (this._shieldMesh) {
        this._shieldMesh.setEnabled(false);
      }

      // Süper güce göre aksan/metal parlaması
      if (self.accentMat) {
        if (active && kind === "turbo") {
          self.accentMat.emissiveColor = self.accentBase.scale(1.2 + (Math.sin(this.time * 12) + 1) * 1.4);
        } else if (active && kind === "heal") {
          self.accentMat.emissiveColor = hexToColor3("#5effd0").scale(0.8 + (Math.sin(this.time * 6) + 1) * 0.7);
        } else {
          self.accentMat.emissiveColor = self.accentBase;
        }
      }
      if (self.metalMat) {
        if (active && kind === "charge") {
          self.metalMat.emissiveColor = hexToColor3("#ffd166").scale(0.5 + (Math.sin(this.time * 14) + 1) * 0.45);
        } else if (active && kind === "rapid") {
          self.metalMat.emissiveColor = hexToColor3("#ffc24b").scale(0.4 + (Math.sin(this.time * 26) + 1) * 0.6);
        } else {
          self.metalMat.emissiveColor = self.metalBase;
        }
      }
    }
  }

  NA.Game = Game;
  NA.TANK_TYPES = TANK_TYPES;
  NA.MAPS = MAPS;
  NA.MAP_LIST = MAP_LIST;
})();
