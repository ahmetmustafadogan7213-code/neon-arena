/* ==========================================================================
   main.js — uygulama akışı: yükleme, oda katılımı, maç sonu
   ========================================================================== */
(function () {
  "use strict";
  const NA = window.NA;

  const canvas = document.getElementById("renderCanvas");
  const net = new NA.Net();
  const game = new NA.Game(canvas);
  NA.net = net;
  NA.game = game;

  const match = {
    active: false,
    finished: false,
    startedAt: 0,
    baseKills: 0,
    baseDeaths: 0,
    baseTrophies: 0,
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ==================== Yükleme ==================== */
  async function boot() {
    const profile = NA.UI.init({
      game,
      net,
      // Hızlı oyna: harita boş gönderilir → sunucu rastgele harita seçer
      onQuickPlay: () => joinRoom(() => net.quickPlay(playerOptions())),
      onJoinRoom: (roomId) => joinRoom(() => net.joinById(roomId, playerOptions())),
      onCreateRoom: (opts) => joinRoom(() => net.createRoom(Object.assign(playerOptions(), opts))),
      onLeaveMatch: () => leaveMatch(),
    });

    NA.UI.setLoading(0.15, "3D motor başlatılıyor…");
    game.init();
    await delay(250);

    NA.UI.setLoading(0.55, "Arena hazırlanıyor…");
    await delay(250);

    NA.UI.setLoading(0.85, "Işıklar ve neonlar…");
    await delay(250);

    NA.UI.setLoading(1, "Hazır!");
    await delay(300);

    NA.UI.setScreen("login");
    NA.UI.toast("Hoş geldin, " + profile.name + "!", "ok");
  }

  function playerOptions() {
    return {
      name: NA.UI.profile.name,
      trophies: NA.UI.profile.trophies,
      tank: NA.UI.profile.tank,
      map: "", // harita seçimi yok → sunucu her maç rastgele harita seçer
    };
  }

  /* ==================== Oda katılımı ==================== */
  async function joinRoom(joinFn) {
    if (match.active) return;
    try {
      NA.UI.toast("Bağlanılıyor…");
      const room = await joinFn();
      attachRoom(room);
      startMatch(room);
    } catch (e) {
      console.error(e);
      NA.UI.toast("Bağlanılamadı: " + (e && e.message ? e.message : "bilinmeyen hata"), "err");
    }
  }

  function startMatch(room) {
    match.active = true;
    match.finished = false;
    match.startedAt = Date.now();
    match.baseKills = NA.UI.profile.kills;
    match.baseDeaths = NA.UI.profile.deaths;
    match.baseTrophies = NA.UI.profile.trophies;

    const meta = room.metadata || {};
    game.enterPlay(meta.name || "Arena", meta.map || game.mapId);
    NA.UI.hideRespawn();
    NA.UI.setScreen("__none__"); // ekranları kapat, HUD'u aç
    NA.UI.toast("Maça girdin!", "ok");
  }

  function attachRoom(room) {
    // sessionId her zaman elimizde; 'welcome' mesajını beklemeye gerek yok
    game.selfId = room.sessionId;

    room.onMessage("welcome", (msg) => {
      game.selfId = msg.id;
      game.handleWelcome(msg);
    });

    room.onMessage("state", (msg) => game.handleState(msg));
    room.onMessage("shot", (msg) => game.handleShot(msg));
    room.onMessage("hit", (msg) => game.handleHit(msg));
    room.onMessage("kill", (msg) => game.handleKill(msg));
    room.onMessage("respawn", (msg) => game.handleRespawn(msg));
    room.onMessage("super", (msg) => game.handleSuper(msg));

    room.onMessage("joined", (msg) => {
      if (msg.id !== game.selfId) NA.UI.toast(msg.name + " katıldı");
    });
    room.onMessage("left", (msg) => {
      NA.UI.toast(msg.name + " ayrıldı");
    });

    room.onError((code, message) => {
      NA.UI.toast("Oda hatası: " + (message || code), "err");
    });

    room.onLeave((code) => {
      if (!match.active) return;
      let reason = "";
      if (code === 1000) reason = "";                          // normal ayrılma
      else if (code === 1006) reason = "Sunucu bağlantısı koptu.";
      else reason = "Bağlantı kapandı (kod " + code + ").";
      finishMatch(reason);
    });
  }

  /* ==================== Maç sonu ==================== */
  async function leaveMatch() {
    if (!match.active) return;
    await net.leave();
    // onLeave tetiklenir; ama güvenlik için burada da bitir
    if (match.active) finishMatch("");
  }

  function finishMatch(reason) {
    if (match.finished) return;
    match.finished = true;
    match.active = false;

    const p = NA.UI.profile;
    const kills = game.selfKills || 0;
    const deaths = game.selfDeaths || 0;
    const trophies = typeof game.selfTrophies === "number" ? game.selfTrophies : p.trophies;

    const before = match.baseTrophies;
    p.kills = match.baseKills + kills;
    p.deaths = match.baseDeaths + deaths;
    p.trophies = trophies;
    p.matches += 1;
    NA.UI.saveProfile();

    const delta = trophies - before;
    const secs = Math.round((Date.now() - match.startedAt) / 1000);

    document.getElementById("result-kills").textContent = kills;
    document.getElementById("result-deaths").textContent = deaths;
    document.getElementById("result-time").textContent = secs + "s";
    document.getElementById("result-trophies").textContent = trophies;
    const dEl = document.getElementById("result-trophy-delta");
    dEl.textContent = (delta >= 0 ? "+" : "") + delta + " kupa";
    dEl.className = "result-trophy-delta " + (delta >= 0 ? "pos" : "neg");
    document.getElementById("result-title").textContent = reason ? "BAĞLANTI KAPANDI" : "MAÇ BİTTİ";
    document.getElementById("result-sub").textContent = reason || "İyi oyundu!";

    game.exitToMenu();
    game.selfKills = 0;
    game.selfDeaths = 0;
    NA.UI.setScreen("result");
    NA.UI.setHudVisible(false);
  }

  /* ==================== Başlat ==================== */
  window.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();
})();
