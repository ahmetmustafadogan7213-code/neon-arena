"use strict";

const { Room } = require("colyseus");

// İstemci ile paylaşılan oyun verisi (tank dengeleri, haritalar, engeller)
const DATA = require("../../shared/arena-data.js");

// ---------------------------------------------------------------------------
// Oyun sabitleri (dengeler burada)
// ---------------------------------------------------------------------------
const TICK_MS = 50;              // sunucu güncelleme sıklığı (20 Hz)
const MAX_HP = 100;              // varsayılan can (tank sınıfları geçersizse)
const RESPAWN_MS = 3000;         // ölümden sonra yeniden doğma süresi
const ARENA_HALF = 30;           // arena 60x60 birim; koordinatlar -30..30
const TROPHY_KILL = 25;          // öldürme başına kazanılan kupa
const TROPHY_DEATH = -10;        // ölüm başına kaybedilen kupa (0'ın altına inmez)
const SKIN_COUNT = 12;

// Tank sınıfları — paylaşılan veriden türetilir (tek kaynak).
const TANK_TYPES = {};
const SUPER = {};
DATA.TANKS.forEach((t) => {
  TANK_TYPES[t.id] = { maxHp: t.hp, damage: t.damage, cooldown: t.cooldown, range: t.range };
  SUPER[t.id] = Object.assign({ id: t.super.kind, name: t.super.name }, t.super);
});
const DEFAULT_TANK = "striker";

// Harita kimlikleri — geçersiz/boş istek gelirse rastgele seçilir (hızlı oyna).
const MAP_IDS = DATA.MAP_IDS;

// Süper güçler — tank sınıfına göre tek yetenek, ortak bekleme süresi
const SUPER_COOLDOWN_MS = 14000;  // iki kullanım arası
const SUPER_DURATION_MS = 5500;   // etki süresi

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function clamp(v, min, max) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function randomSpawn() {
  const r = ARENA_HALF - 6;
  return {
    x: (Math.random() * 2 - 1) * r,
    z: (Math.random() * 2 - 1) * r,
  };
}

// ---------------------------------------------------------------------------
// Arena odası: bir maç = bir oda. Her oda bağımsız çalışır.
// ---------------------------------------------------------------------------
class ArenaRoom extends Room {
  onCreate(options) {
    const opts = options || {};

    this.maxClients = clamp(opts.maxClients || 8, 2, 24);
    this.displayName = String(opts.roomName || "Arena").slice(0, 24);
    // Geçersiz/boş harita isteği → rastgele harita (hızlı oyna akışı)
    const wantedMap = String(opts.map || "").slice(0, 16);
    this.mapId = MAP_IDS.indexOf(wantedMap) >= 0
      ? wantedMap
      : MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];
    // Haritanın çarpışma kutuları — mermilerin duvar arkasına geçmesini engeller
    this.mapColliders = DATA.mapColliders(DATA.MAPS[this.mapId], ARENA_HALF);
    this.players = new Map(); // sessionId -> oyuncu durumu

    // Lobide görünecek oda bilgisi
    this.setMetadata({
      name: this.displayName,
      mode: "Arena",
      map: this.mapId,
      arena: ARENA_HALF * 2,
      maxHp: MAX_HP,
    });

    // İstemciden gelen mesajlar
    this.onMessage("input", (client, msg) => this.handleInput(client, msg));
    this.onMessage("shoot", (client, msg) => this.handleShoot(client, msg));
    this.onMessage("super", (client) => this.handleSuper(client));

    // Oyun döngüsü
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    console.log(`[oda] "${this.displayName}" oluşturuldu (max ${this.maxClients})`);
  }

  // Takma ad doğrulama
  onAuth(_client, options) {
    const raw = options && options.name ? String(options.name) : "";
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 14);
    return { name: name || "Oyuncu" };
  }

  onJoin(client, options, auth) {
    const spawn = randomSpawn();
    const tankId = TANK_TYPES[options && options.tank] ? options.tank : DEFAULT_TANK;
    const spec = TANK_TYPES[tankId];
    this.players.set(client.sessionId, {
      id: client.sessionId,
      name: auth.name,
      x: spawn.x,
      z: spawn.z,
      a: 0,               // gövde açısı
      t: 0,               // taret açısı
      tank: tankId,       // tank sınıfı
      maxHp: spec.maxHp,
      hp: spec.maxHp,
      damage: spec.damage,
      cooldown: spec.cooldown,
      range: spec.range,
      alive: true,
      respawnAt: 0,
      lastShot: 0,
      superReadyAt: 0,    // süper güç tekrar hazır olma zamanı
      superEndAt: 0,      // süper güç etkisinin bitiş zamanı
      kills: 0,
      deaths: 0,
      trophies: clamp(Number(options && options.trophies) || 0, 0, 100000),
      skin: Math.floor(Math.random() * SKIN_COUNT),
    });

    client.send("welcome", {
      id: client.sessionId,
      arenaHalf: ARENA_HALF,
      map: this.mapId,
      tank: tankId,
      maxHp: spec.maxHp,
      respawnMs: RESPAWN_MS,
      damage: spec.damage,
      shootCooldown: spec.cooldown,
      superKind: SUPER[tankId].id,
      superName: SUPER[tankId].name,
      superCooldown: SUPER_COOLDOWN_MS,
      superDuration: SUPER_DURATION_MS,
    });

    this.broadcast("joined", { id: client.sessionId, name: auth.name });
    console.log(`[oda] ${auth.name} katıldı (${this.clients.length}/${this.maxClients})`);
  }

  onLeave(client) {
    const p = this.players.get(client.sessionId);
    this.players.delete(client.sessionId);
    if (p) this.broadcast("left", { id: p.id, name: p.name });
  }

  // Hareket: istemci bildirir, sunucu sınırlar içine kırpar
  handleInput(client, msg) {
    const p = this.players.get(client.sessionId);
    if (!p || !msg) return;
    p.x = clamp(msg.x, -ARENA_HALF, ARENA_HALF);
    p.z = clamp(msg.z, -ARENA_HALF, ARENA_HALF);
    if (Number.isFinite(msg.a)) p.a = msg.a;
    if (Number.isFinite(msg.t)) p.t = msg.t;
  }

  // Süper güç aktif mi? (tank sınıfına göre yetenek eşleşmesi + süre)
  superActive(p, kind) {
    if (!p || !p.alive) return false;
    const s = SUPER[p.tank];
    return !!s && s.id === kind && Date.now() < p.superEndAt;
  }

  // İki nokta arasında engel var mı? → mermiler duvardan geçemez
  segmentBlocked(x0, z0, x1, z1) {
    const r = 0.4; // mermi yarıçapı payı
    const dx = x1 - x0;
    const dz = z1 - z0;
    const cols = this.mapColliders || [];
    for (let i = 0; i < cols.length; i++) {
      const o = cols[i];
      const hw = o.hw + r;
      const hd = o.hd + r;
      let enter = -Infinity;
      let exit = Infinity;

      if (Math.abs(dx) < 1e-6) {
        if (Math.abs(x0 - o.x) > hw) continue;
      } else {
        let t1 = (o.x - hw - x0) / dx;
        let t2 = (o.x + hw - x0) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        enter = Math.max(enter, t1);
        exit = Math.min(exit, t2);
        if (enter > exit) continue;
      }

      if (Math.abs(dz) < 1e-6) {
        if (Math.abs(z0 - o.z) > hd) continue;
      } else {
        let t1 = (o.z - hd - z0) / dz;
        let t2 = (o.z + hd - z0) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        enter = Math.max(enter, t1);
        exit = Math.min(exit, t2);
        if (enter > exit) continue;
      }

      // Kaynak engelin içindeyse yoksay; engel hedefin ilerisindeyse yoksay
      if (enter <= 0 || exit < 0 || enter > 1) continue;
      return true;
    }
    return false;
  }

  // Süper güç kullanımı: bekleme süresi + etki penceresi sunucuda tutulur
  handleSuper(client) {
    const now = Date.now();
    const p = this.players.get(client.sessionId);
    if (!p || !p.alive) return;
    if (now < p.superReadyAt) return;      // henüz hazır değil
    const s = SUPER[p.tank];
    if (!s) return;
    p.superReadyAt = now + SUPER_COOLDOWN_MS;
    p.superEndAt = now + SUPER_DURATION_MS;
    this.broadcast("super", {
      id: p.id,
      kind: s.id,
      name: s.name,
      duration: SUPER_DURATION_MS,
    });
  }

  // Atış: istemci hedef bildirir, sunucu doğrulayıp hasarı uygular
  handleShoot(client, msg) {
    const now = Date.now();
    const shooter = this.players.get(client.sessionId);
    if (!shooter || !shooter.alive) return;

    // Atış bekleme süresi — HIZLI ATIŞ süper gücü bekleme süresini kısaltır
    const shooterSuper = SUPER[shooter.tank];
    const cdMul = this.superActive(shooter, "rapid") ? (shooterSuper.cooldownMul || 1) : 1;
    if (now - shooter.lastShot < shooter.cooldown * cdMul) return;
    shooter.lastShot = now;

    const targetId = msg && msg.targetId;
    const target = targetId ? this.players.get(targetId) : null;
    let hit = null;

    if (target && target.alive && target.id !== shooter.id) {
      const dx = target.x - shooter.x;
      const dz = target.z - shooter.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Menzil içinde VE arada engel yoksa isabet eder (duvar arkasına atış işlemez)
      if (dist <= shooter.range && !this.segmentBlocked(shooter.x, shooter.z, target.x, target.z)) {
        // Süper güç etkileri: şarjlı atış hasarı artırır, kalkan hasarı azaltır
        let dmg = shooter.damage;
        if (this.superActive(shooter, "charge")) dmg = Math.round(dmg * (shooterSuper.dmgMul || 1));
        const targetSuper = SUPER[target.tank];
        if (this.superActive(target, "shield")) dmg = Math.round(dmg * (targetSuper.dmgTaken || 1));
        dmg = Math.max(1, dmg);

        target.hp -= dmg;
        hit = target.id;
        this.broadcast("hit", {
          targetId: target.id,
          hp: Math.max(0, target.hp),
          byId: shooter.id,
          damage: dmg,
        });
        if (target.hp <= 0) this.killPlayer(shooter, target);
      }
    }

    // Mermi uçuşunu herkese yayınla (mermi görseli istemcide çizilir)
    this.broadcast("shot", {
      id: shooter.id,
      x: round2(shooter.x),
      z: round2(shooter.z),
      a: Number.isFinite(msg && msg.a) ? msg.a : shooter.t,
      charged: this.superActive(shooter, "charge") ? 1 : 0,
      hit,
    });
  }

  killPlayer(killer, victim) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths += 1;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    victim.trophies = Math.max(0, victim.trophies + TROPHY_DEATH);

    if (killer && killer.id !== victim.id) {
      killer.kills += 1;
      killer.trophies += TROPHY_KILL;
    }

    this.broadcast("kill", {
      killerId: killer ? killer.id : null,
      killerName: killer ? killer.name : null,
      victimId: victim.id,
      victimName: victim.name,
    });
  }

  // Sunucu döngüsü: yeniden doğma + durum yayını
  tick() {
    const now = Date.now();
    const list = [];

    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        const spawn = randomSpawn();
        p.x = spawn.x;
        p.z = spawn.z;
        p.a = 0;
        p.t = 0;
        p.hp = p.maxHp;
        p.alive = true;
        this.broadcast("respawn", { id: p.id, x: round2(p.x), z: round2(p.z) });
      }

      // ONARIM süper gücü: etki süresince can yenilenir
      if (p.alive && p.hp < p.maxHp && this.superActive(p, "heal")) {
        const perSec = (SUPER[p.tank] && SUPER[p.tank].healPerSec) || 0;
        p.hp = Math.min(p.maxHp, p.hp + perSec * (TICK_MS / 1000));
      }

      list.push({
        i: p.id,
        n: p.name,
        x: round2(p.x),
        z: round2(p.z),
        a: round2(p.a),
        t: round2(p.t),
        h: Math.max(0, p.hp),
        mh: p.maxHp,
        k: p.kills,
        d: p.deaths,
        tr: p.trophies,
        s: p.skin,
        tk: p.tank,
        al: p.alive ? 1 : 0,
        // Süper güç: kalan etki (sp) ve tekrar hazır olma (spr) ms cinsinden
        sp: Math.max(0, p.superEndAt - now),
        spr: Math.max(0, p.superReadyAt - now),
      });
    }

    this.broadcast("state", { p: list, t: now });
  }

  onDispose() {
    console.log(`[oda] "${this.displayName}" kapatıldı`);
  }
}

module.exports = { ArenaRoom, ARENA_HALF, MAX_HP };
