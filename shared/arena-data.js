/* ==========================================================================
   arena-data.js — istemci ve sunucunun PAYLAŞTIĞI oyun verisi
   Tank dengeleri, haritalar ve çarpışma kutuları tek yerde tutulur; böylece
   istemci ile sunucu asla birbirinden ayrışmaz.
   Tarayıcıda: window.NA.ARENA_DATA / NA.TANK_TYPES / NA.MAPS
   Node'da:    require("../shared/arena-data")
   ========================================================================== */
(function () {
  "use strict";

  /* ---- Tank sınıfları ------------------------------------------------ */
  // hp/damage/cooldown/range → sunucu otoritesi; len/wid/hue → görsel gövde.
  // super.dmgMul / cooldownMul / healPerSec süper gücün etkisini belirler.
  const TANKS = [
    { id: "striker", name: "STRİKER", role: "Dengeli",
      hp: 100, damage: 22, cooldown: 280, range: 48, speed: 13.0, len: 2.0, wid: 1.5, hue: "#2ee6ff",
      super: { kind: "charge", name: "ŞARJLI ATIŞ", dmgMul: 2.2,
        desc: "5,5 sn boyunca atışlar 2,2x hasar verir." } },

    { id: "scout", name: "KEŞİFÇİ", role: "Hızlı",
      hp: 80, damage: 15, cooldown: 170, range: 40, speed: 17.5, len: 1.7, wid: 1.25, hue: "#7dff6b",
      super: { kind: "turbo", name: "TURBO", speedMul: 1.65,
        desc: "5,5 sn boyunca %65 daha hızlı hareket." } },

    { id: "heavy", name: "AĞIR", role: "Dayanıklı",
      hp: 145, damage: 34, cooldown: 540, range: 52, speed: 9.5, len: 2.4, wid: 1.85, hue: "#ff8a5e",
      super: { kind: "shield", name: "KALKAN", dmgTaken: 0.4,
        desc: "5,5 sn boyunca alınan hasar %60 azalır." } },

    { id: "sniper", name: "NİŞANCI", role: "Menzil",
      hp: 90, damage: 30, cooldown: 700, range: 62, speed: 12.0, len: 2.3, wid: 1.4, hue: "#c07bff",
      super: { kind: "charge", name: "ODAK", dmgMul: 2.4,
        desc: "5,5 sn boyunca atışlar 2,4x hasar verir." } },

    { id: "medic", name: "TAMİRCİ", role: "Destek",
      hp: 110, damage: 16, cooldown: 300, range: 44, speed: 13.5, len: 2.1, wid: 1.55, hue: "#5effd0",
      super: { kind: "heal", name: "ONARIM", healPerSec: 20,
        desc: "5,5 sn boyunca saniyede 20 can yeniler." } },

    { id: "gunner", name: "MAKİNELİ", role: "Baskı",
      hp: 95, damage: 11, cooldown: 110, range: 40, speed: 12.5, len: 1.9, wid: 1.45, hue: "#ffc24b",
      super: { kind: "rapid", name: "HIZLI ATIŞ", cooldownMul: 0.35,
        desc: "5,5 sn boyunca atış bekleme süresi %65 azalır." } },

    { id: "ram", name: "KOÇBAŞI", role: "Yıkıcı",
      hp: 130, damage: 27, cooldown: 470, range: 46, speed: 14.8, len: 2.35, wid: 1.75, hue: "#ff5e5e",
      super: { kind: "turbo", name: "ÖFKELİ HÜCUM", speedMul: 1.85,
        desc: "5,5 sn boyunca %85 daha hızlı hareket eder." } },

    { id: "tesla", name: "TESLA", role: "Alan",
      hp: 88, damage: 13, cooldown: 190, range: 47, speed: 13.2, len: 1.9, wid: 1.45, hue: "#4ad9ff",
      super: { kind: "rapid", name: "ZİNCİR ATIŞ", cooldownMul: 0.28,
        desc: "5,5 sn boyunca atış bekleme süresi %72 azalır." } },
  ];

  /* ---- Haritalar ----------------------------------------------------- */
  // floor: zemin deseni ("grid" | "sand" | "ice" | "lava" | "forest" | "metal" | "city")
  // obstacles[].shape: "box" (varsayılan) | "cyl"
  // decor: perde siluetleri (arena içindekiler aynı zamanda engeldir)
  const MAPS = {
    neon: {
      name: "NEON ARENA",
      tagline: "Neon ızgara · kare bloklar",
      floor: "grid",
      clear: [0.015, 0.02, 0.055, 1],
      fogColor: [0.02, 0.03, 0.08],
      fogDensity: 0.012,
      groundFill: "#070a18",
      gridMinor: "rgba(70,120,220,0.20)",
      gridMajor: "rgba(46,230,255,0.55)",
      ring1: "rgba(255,54,185,0.55)",
      ring2: "rgba(46,230,255,0.45)",
      wallDiff: [0.07, 0.09, 0.18], wallEmis: [0.06, 0.13, 0.24], wallH: 2.4,
      obsDiff: [0.08, 0.10, 0.20], obsEmis: [0.05, 0.10, 0.20],
      edge: "#2ee6ff",
      hemiGround: [0.16, 0.10, 0.30],
      obstacles: [
        { x: -14, z: -12, w: 5, d: 5, h: 3.4 },
        { x: 15, z: -13, w: 5, d: 5, h: 3.4 },
        { x: -15, z: 14, w: 6, d: 3, h: 2.6 },
        { x: 14, z: 15, w: 3, d: 6, h: 2.6 },
        { x: 0, z: -22, w: 10, d: 2, h: 2.2 },
        { x: 0, z: 22, w: 10, d: 2, h: 2.2 },
        { x: -24, z: 0, w: 2, d: 9, h: 2.2 },
        { x: 24, z: 0, w: 2, d: 9, h: 2.2 },
      ],
      decor: [
        { x: -27, z: -27, d: 2.0, h: 9.0, shape: "box" },
        { x: 27, z: -27, d: 2.0, h: 9.0, shape: "box" },
        { x: -27, z: 27, d: 2.0, h: 9.0, shape: "box" },
        { x: 27, z: 27, d: 2.0, h: 9.0, shape: "box" },
      ],
    },

    kanyon: {
      name: "KANYON",
      tagline: "Kum · dev silindir kayalar",
      floor: "sand",
      clear: [0.11, 0.06, 0.03, 1],
      fogColor: [0.16, 0.09, 0.05],
      fogDensity: 0.013,
      groundFill: "#3a2410",
      gridMinor: "rgba(255,190,120,0.10)",
      gridMajor: "rgba(255,170,70,0.30)",
      ring1: "rgba(255,120,60,0.45)",
      ring2: "rgba(255,210,140,0.35)",
      wallDiff: [0.28, 0.15, 0.07], wallEmis: [0.14, 0.07, 0.02], wallH: 3.2,
      obsDiff: [0.34, 0.19, 0.09], obsEmis: [0.10, 0.05, 0.02],
      edge: "#ffb057",
      hemiGround: [0.34, 0.18, 0.07],
      obstacles: [
        { x: 0, z: 0, w: 7, d: 7, h: 5.2, shape: "cyl" },
        { x: -20, z: -20, w: 7, d: 7, h: 3.8, shape: "cyl" },
        { x: 20, z: 20, w: 7, d: 7, h: 3.8, shape: "cyl" },
        { x: -20, z: 18, w: 4, d: 14, h: 2.6 },
        { x: 20, z: -18, w: 14, d: 4, h: 2.6 },
        { x: 0, z: -24, w: 16, d: 3, h: 2.2 },
        { x: 0, z: 24, w: 16, d: 3, h: 2.2 },
        { x: -25, z: 1, w: 3, d: 10, h: 2.0 },
        { x: 25, z: -1, w: 3, d: 10, h: 2.0 },
      ],
      decor: [
        { x: -8, z: -9, d: 3.8, h: 7.0, shape: "cone" },
        { x: 9, z: 8, d: 3.2, h: 6.2, shape: "cone" },
        { x: -19, z: 7, d: 2.8, h: 5.0, shape: "cone" },
        { x: 18, z: -8, d: 2.6, h: 4.6, shape: "cone" },
        { x: 0, z: -13, d: 2.2, h: 4.0, shape: "cone" },
      ],
    },

    buz: {
      name: "DONMUŞ LİMAN",
      tagline: "Buz · kristal kuleler",
      floor: "ice",
      clear: [0.02, 0.05, 0.09, 1],
      fogColor: [0.05, 0.10, 0.16],
      fogDensity: 0.016,
      groundFill: "#0b1c2b",
      gridMinor: "rgba(160,220,255,0.14)",
      gridMajor: "rgba(200,245,255,0.40)",
      ring1: "rgba(120,220,255,0.45)",
      ring2: "rgba(230,250,255,0.35)",
      wallDiff: [0.10, 0.19, 0.28], wallEmis: [0.12, 0.26, 0.36], wallH: 2.0,
      obsDiff: [0.16, 0.32, 0.44], obsEmis: [0.14, 0.30, 0.42],
      edge: "#a8f0ff",
      hemiGround: [0.14, 0.30, 0.42],
      obstacles: [
        { x: -11, z: 0, w: 4, d: 4, h: 3.8, shape: "cyl" },
        { x: 11, z: 0, w: 4, d: 4, h: 3.8, shape: "cyl" },
        { x: -11, z: 15, w: 2.4, d: 2.4, h: 2.8, shape: "cyl" },
        { x: 11, z: -15, w: 2.4, d: 2.4, h: 2.8, shape: "cyl" },
        { x: 0, z: -21, w: 18, d: 2, h: 2.8 },
        { x: 0, z: 21, w: 18, d: 2, h: 2.8 },
        { x: -23, z: -23, w: 6, d: 6, h: 4.2, shape: "cyl" },
        { x: 23, z: 23, w: 6, d: 6, h: 4.2, shape: "cyl" },
      ],
      decor: [
        { x: -7, z: -14, d: 2.6, h: 6.8, shape: "cone" },
        { x: 8, z: 13, d: 2.4, h: 6.0, shape: "cone" },
        { x: -20, z: 9, d: 2.2, h: 5.0, shape: "cone" },
        { x: 19, z: -7, d: 2.2, h: 5.0, shape: "cone" },
        { x: 0, z: 25, d: 2.8, h: 6.4, shape: "cone" },
      ],
    },

    volkan: {
      name: "VOLKAN",
      tagline: "Lav · kızıl bazalt sütunları",
      floor: "lava",
      clear: [0.07, 0.02, 0.02, 1],
      fogColor: [0.20, 0.06, 0.03],
      fogDensity: 0.015,
      groundFill: "#170806",
      gridMinor: "rgba(255,130,50,0.16)",
      gridMajor: "rgba(255,95,30,0.45)",
      ring1: "rgba(255,80,20,0.60)",
      ring2: "rgba(255,190,70,0.42)",
      wallDiff: [0.18, 0.06, 0.04], wallEmis: [0.34, 0.09, 0.02], wallH: 2.8,
      obsDiff: [0.13, 0.07, 0.06], obsEmis: [0.24, 0.06, 0.02],
      edge: "#ff6a2a",
      hemiGround: [0.30, 0.10, 0.04],
      obstacles: [
        { x: 0, z: 0, w: 9, d: 9, h: 2.2, shape: "cyl" },
        { x: -16, z: -15, w: 5, d: 5, h: 4.8, shape: "cyl" },
        { x: 16, z: 15, w: 5, d: 5, h: 4.8, shape: "cyl" },
        { x: -23, z: 11, w: 4, d: 12, h: 3.0 },
        { x: 23, z: -11, w: 12, d: 4, h: 3.0 },
        { x: 0, z: -23, w: 14, d: 3, h: 2.4 },
        { x: 0, z: 23, w: 14, d: 3, h: 2.4 },
        { x: -25, z: -2, w: 3, d: 11, h: 2.4 },
        { x: 25, z: 2, w: 3, d: 11, h: 2.4 },
      ],
      decor: [
        { x: -9, z: -8, d: 3.6, h: 8.2, shape: "cone" },
        { x: 10, z: 9, d: 3.0, h: 7.2, shape: "cone" },
        { x: -19, z: 19, d: 2.7, h: 6.2, shape: "cone" },
        { x: 19, z: -19, d: 2.7, h: 6.2, shape: "cone" },
        { x: 0, z: 13, d: 2.4, h: 5.2, shape: "cone" },
      ],
    },

    orman: {
      name: "ZÜMRÜT ORMAN",
      tagline: "Yosun · dev ağaç gövdeleri",
      floor: "forest",
      clear: [0.02, 0.06, 0.03, 1],
      fogColor: [0.04, 0.11, 0.06],
      fogDensity: 0.016,
      groundFill: "#0a1c0e",
      gridMinor: "rgba(120,255,150,0.10)",
      gridMajor: "rgba(90,230,120,0.32)",
      ring1: "rgba(90,255,140,0.42)",
      ring2: "rgba(190,255,200,0.30)",
      wallDiff: [0.08, 0.20, 0.10], wallEmis: [0.05, 0.21, 0.08], wallH: 2.6,
      obsDiff: [0.15, 0.28, 0.13], obsEmis: [0.04, 0.17, 0.06],
      edge: "#6bff8f",
      hemiGround: [0.10, 0.26, 0.12],
      obstacles: [
        { x: -13, z: -11, w: 2.8, d: 2.8, h: 5.8, shape: "cyl" },
        { x: 13, z: -11, w: 2.8, d: 2.8, h: 5.8, shape: "cyl" },
        { x: -13, z: 11, w: 2.8, d: 2.8, h: 5.8, shape: "cyl" },
        { x: 13, z: 11, w: 2.8, d: 2.8, h: 5.8, shape: "cyl" },
        { x: 0, z: -20, w: 4.4, d: 4.4, h: 3.4, shape: "cyl" },
        { x: 0, z: 20, w: 4.4, d: 4.4, h: 3.4, shape: "cyl" },
        { x: -22, z: 0, w: 13, d: 3, h: 2.4 },
        { x: 22, z: 0, w: 13, d: 3, h: 2.4 },
        { x: -8, z: 23, w: 11, d: 2.4, h: 2.0 },
        { x: 8, z: -23, w: 11, d: 2.4, h: 2.0 },
      ],
      decor: [
        { x: -25, z: -25, d: 3.6, h: 9.5, shape: "cone" },
        { x: 25, z: -25, d: 3.6, h: 9.5, shape: "cone" },
        { x: -25, z: 25, d: 3.6, h: 9.5, shape: "cone" },
        { x: 25, z: 25, d: 3.6, h: 9.5, shape: "cone" },
      ],
    },

    uzay: {
      name: "UZAY İSTASYONU",
      tagline: "Metal paneller · soğuk neon",
      floor: "metal",
      clear: [0.01, 0.02, 0.045, 1],
      fogColor: [0.03, 0.06, 0.11],
      fogDensity: 0.010,
      groundFill: "#0a1018",
      gridMinor: "rgba(150,180,220,0.14)",
      gridMajor: "rgba(120,225,255,0.40)",
      ring1: "rgba(120,200,255,0.45)",
      ring2: "rgba(225,240,255,0.35)",
      wallDiff: [0.16, 0.20, 0.27], wallEmis: [0.10, 0.17, 0.24], wallH: 2.6,
      obsDiff: [0.21, 0.25, 0.31], obsEmis: [0.10, 0.17, 0.25],
      edge: "#9fe6ff",
      hemiGround: [0.12, 0.18, 0.27],
      obstacles: [
        { x: 0, z: 0, w: 6.4, d: 6.4, h: 3.0, shape: "cyl" },
        { x: -18, z: -18, w: 5, d: 5, h: 3.6, shape: "cyl" },
        { x: 18, z: -18, w: 5, d: 5, h: 3.6, shape: "cyl" },
        { x: -18, z: 18, w: 5, d: 5, h: 3.6, shape: "cyl" },
        { x: 18, z: 18, w: 5, d: 5, h: 3.6, shape: "cyl" },
        { x: -12, z: 0, w: 4.4, d: 4.4, h: 2.8 },
        { x: 12, z: 0, w: 4.4, d: 4.4, h: 2.8 },
        { x: 0, z: -22, w: 15, d: 2.4, h: 2.4 },
        { x: 0, z: 22, w: 15, d: 2.4, h: 2.4 },
        { x: -24, z: 0, w: 2.4, d: 12, h: 2.4 },
        { x: 24, z: 0, w: 2.4, d: 12, h: 2.4 },
      ],
      decor: [
        { x: -27, z: -27, d: 2.4, h: 10.0, shape: "box" },
        { x: 27, z: -27, d: 2.4, h: 10.0, shape: "box" },
        { x: -27, z: 27, d: 2.4, h: 10.0, shape: "box" },
        { x: 27, z: 27, d: 2.4, h: 10.0, shape: "box" },
      ],
    },

    gokdelen: {
      name: "GÖKDELEN",
      tagline: "Asfalt · beton bloklar",
      floor: "city",
      clear: [0.03, 0.035, 0.05, 1],
      fogColor: [0.08, 0.09, 0.12],
      fogDensity: 0.013,
      groundFill: "#14161c",
      gridMinor: "rgba(230,230,240,0.10)",
      gridMajor: "rgba(255,205,60,0.34)",
      ring1: "rgba(255,205,60,0.40)",
      ring2: "rgba(240,240,255,0.28)",
      wallDiff: [0.20, 0.20, 0.23], wallEmis: [0.13, 0.13, 0.16], wallH: 2.4,
      obsDiff: [0.27, 0.27, 0.31], obsEmis: [0.10, 0.10, 0.13],
      edge: "#ffd45e",
      hemiGround: [0.19, 0.19, 0.22],
      obstacles: [
        { x: -16, z: -14, w: 8, d: 8, h: 6.0 },
        { x: 16, z: -14, w: 8, d: 8, h: 6.0 },
        { x: -16, z: 14, w: 8, d: 8, h: 6.0 },
        { x: 16, z: 14, w: 8, d: 8, h: 6.0 },
        { x: 0, z: 0, w: 5.2, d: 5.2, h: 3.2 },
        { x: 0, z: -25, w: 18, d: 2.4, h: 2.2 },
        { x: 0, z: 25, w: 18, d: 2.4, h: 2.2 },
        { x: -26, z: -1, w: 2.4, d: 10, h: 2.2 },
        { x: 26, z: 1, w: 2.4, d: 10, h: 2.2 },
      ],
      decor: [
        { x: -26, z: 26, d: 3.0, h: 12.0, shape: "box" },
        { x: 26, z: 26, d: 3.0, h: 12.0, shape: "box" },
        { x: -26, z: -26, d: 3.0, h: 12.0, shape: "box" },
        { x: 26, z: -26, d: 3.0, h: 12.0, shape: "box" },
      ],
    },
  };

  const MAP_IDS = Object.keys(MAPS);

  // Harita engellerini (kutu + arena içi dekor) tek biçimde çıkarır.
  // İstemci hareket/mermi çarpmasında, sunucu görüş hattı kontrolünde kullanır.
  function mapColliders(def, arenaHalf) {
    const out = [];
    if (!def) return out;
    (def.obstacles || []).forEach(function (o) {
      out.push({ x: o.x, z: o.z, hw: o.w / 2, hd: (o.d || o.w) / 2 });
    });
    (def.decor || []).forEach(function (o) {
      if (Math.abs(o.x) < arenaHalf - 2 && Math.abs(o.z) < arenaHalf - 2) {
        out.push({ x: o.x, z: o.z, hw: o.d / 2, hd: o.d / 2 });
      }
    });
    return out;
  }

  const DATA = { TANKS: TANKS, MAPS: MAPS, MAP_IDS: MAP_IDS, mapColliders: mapColliders };

  // Node tarafı
  if (typeof module !== "undefined" && module.exports) module.exports = DATA;

  // Tarayıcı tarafı
  if (typeof window !== "undefined") {
    const NA = (window.NA = window.NA || {});
    NA.ARENA_DATA = DATA;
    NA.TANK_TYPES = TANKS;
    NA.MAPS = MAPS;
    NA.MAP_IDS = MAP_IDS;
    NA.MAP_LIST = MAP_IDS.map(function (id) {
      return { id: id, name: MAPS[id].name, tagline: MAPS[id].tagline };
    });
  }
})();
