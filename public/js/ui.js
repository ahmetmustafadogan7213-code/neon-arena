/* ==========================================================================
   ui.js — ekranlar, geçişler, profil/kupa sistemi, oda listesi, HUD
   ========================================================================== */
(function () {
  "use strict";
  const NA = (window.NA = window.NA || {});

  /* ---- Rütbeler -------------------------------------------------------- */
  const RANKS = [
    { name: "Bronz", min: 0, emblem: "B", color: ["#c98a4b", "#8a5a2b"] },
    { name: "Gümüş", min: 100, emblem: "G", color: ["#c9d6e2", "#7d8fa3"] },
    { name: "Altın", min: 250, emblem: "A", color: ["#ffd45e", "#d99a1e"] },
    { name: "Platin", min: 500, emblem: "P", color: ["#7df0ff", "#3aa8c9"] },
    { name: "Elmas", min: 900, emblem: "E", color: ["#8ab4ff", "#4a5cff"] },
    { name: "Efsane", min: 1500, emblem: "EF", color: ["#ff6bd6", "#a13bff"] },
  ];

  const STORE_KEY = "na_profile_v1";

  const $ = (id) => document.getElementById(id);

  const UI = {
    profile: null,
    game: null,
    net: null,
    onQuickPlay: null,
    onJoinRoom: null,
    onCreateRoom: null,
    onLeaveMatch: null,
    currentScreen: "loading",

    /* ==================== Kurulum ==================== */
    init(opts) {
      this.game = opts.game;
      this.net = opts.net;
      this.onQuickPlay = opts.onQuickPlay;
      this.onJoinRoom = opts.onJoinRoom;
      this.onCreateRoom = opts.onCreateRoom;
      this.onLeaveMatch = opts.onLeaveMatch;

      this.profile = this._loadProfile();
      this._bindEvents();
      this._bindCrosshair();
      this.renderProfile();
      this.renderGarage();
      this._syncNames();
      if (this.game && this.game.setPreviewTank) this.game.setPreviewTank(this.profile.tank);
      this._startPingMeter();
      return this.profile;
    },

    _loadProfile() {
      let p = { name: "", trophies: 0, kills: 0, deaths: 0, matches: 0, tank: "striker" };
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) p = Object.assign(p, JSON.parse(raw));
      } catch (e) { /* bozuk kayıt */ }
      if (!p.name) p.name = "Oyuncu" + Math.floor(1000 + Math.random() * 9000);
      if (!p.tank) p.tank = "striker";
      return p;
    },

    saveProfile() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.profile)); } catch (e) { /* yoksay */ }
    },

    rankFor(trophies) {
      let r = RANKS[0];
      for (let i = 0; i < RANKS.length; i++) if (trophies >= RANKS[i].min) r = RANKS[i];
      return r;
    },

    nextRank(trophies) {
      for (let i = 0; i < RANKS.length; i++) if (trophies < RANKS[i].min) return RANKS[i];
      return null;
    },

    renderProfile() {
      const p = this.profile;
      const rank = this.rankFor(p.trophies);
      $("input-name").value = p.name;
      $("profile-trophies").textContent = p.trophies;
      $("profile-kills").textContent = p.kills;
      $("profile-deaths").textContent = p.deaths;
      $("profile-matches").textContent = p.matches;
      $("profile-rank-name").textContent = rank.name;
      $("profile-rank-emblem").textContent = rank.emblem;

      const emblem = $("profile-rank-emblem");
      emblem.style.background = "linear-gradient(135deg, " + rank.color[0] + ", " + rank.color[1] + ")";
      emblem.style.color = "#06121c";

      const nxt = this.nextRank(p.trophies);
      if (nxt) {
        const span = nxt.min - rank.min;
        const done = p.trophies - rank.min;
        $("profile-progress-fill").style.width = Math.round((done / span) * 100) + "%";
        $("profile-progress-text").textContent = nxt.name + " rütbesine " + (nxt.min - p.trophies) + " kupa";
      } else {
        $("profile-progress-fill").style.width = "100%";
        $("profile-progress-text").textContent = "En üst rütbedesin!";
      }
    },

    /* ==================== Garaj: Brawl Stars tarzı tank seçimi ==================== */
    renderGarage() {
      const self = this;
      const tanks = NA.TANK_TYPES || [];

      const countEl = $("tank-count");
      if (countEl) countEl.textContent = tanks.length;
      const loginTanks = $("login-tank-count");
      if (loginTanks) loginTanks.textContent = tanks.length;
      const loginMaps = $("login-map-count");
      if (loginMaps) loginMaps.textContent = (NA.MAP_IDS || []).length;

      const tw = $("tank-select");
      if (tw) {
        tw.innerHTML = "";
        tanks.forEach((t) => {
          const on = self.profile.tank === t.id;
          const el = document.createElement("button");
          el.type = "button";
          el.className = "select-card" + (on ? " is-on" : "");
          el.style.setProperty("--c", t.hue);
          el.title = t.name + " · " + (t.role || "");
          el.innerHTML =
            '<span class="bs-portrait" style="background:' + t.hue + '">' +
              '<span class="bs-glyph">' + glyphFor(t) + '</span>' +
            '</span>' +
            '<span class="bs-name">' + escapeHtml(t.name) + '</span>' +
            '<span class="bs-role">' + escapeHtml(t.role || "") + '</span>' +
            '<span class="bs-stats">' +
              '<span class="bs-stat bs-hp">❤ ' + t.hp + '</span>' +
              '<span class="bs-stat bs-dmg">⚔ ' + t.damage + '</span>' +
            '</span>';
          el.addEventListener("click", () => {
            self.profile.tank = t.id;
            self.saveProfile();
            if (self.game && self.game.setPreviewTank) self.game.setPreviewTank(t.id);
            self.renderGarage();
          });
          tw.appendChild(el);
        });
      }

      // Seçili tankın detay kartı
      const dw = $("tank-detail");
      if (dw) {
        const t = tanks.find((x) => x.id === self.profile.tank) || tanks[0];
        if (t) {
          const sup = t.super || {};
          dw.innerHTML =
            '<div class="detail-head">' +
              '<span class="detail-swatch" style="background:' + t.hue + '"></span>' +
              '<div class="detail-titles">' +
                '<div class="detail-name">' + escapeHtml(t.name) + '</div>' +
                '<div class="detail-role">' + escapeHtml(t.role || "") + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="detail-stats">' +
              '<div class="detail-stat"><b>' + t.hp + '</b><small>CAN</small></div>' +
              '<div class="detail-stat"><b>' + t.damage + '</b><small>HASAR</small></div>' +
              '<div class="detail-stat"><b>' + t.speed.toFixed(1) + '</b><small>HIZ</small></div>' +
              '<div class="detail-stat"><b>' + (t.cooldown / 1000).toFixed(2) + 's</b><small>BEKLEME</small></div>' +
            '</div>' +
            '<div class="detail-super">' +
              '<div class="detail-super-title"><span class="detail-super-icon">⚡</span>' + escapeHtml(sup.name || "SÜPER GÜÇ") + '</div>' +
              '<div class="detail-super-desc">' + escapeHtml(sup.desc || "") + '</div>' +
            '</div>';
        }
      }
    },

    /* ==================== Giriş ekranı ==================== */
    // Adı kaydedip ana menüye geç
    enterMenu() {
      const el = $("input-login-name");
      const v = el ? el.value.trim() : "";
      if (v) this.profile.name = v.slice(0, 14);
      this.saveProfile();
      this._syncNames();
      this.renderProfile();
      this.setScreen("menu");
    },

    // İki ad alanını (giriş + menü) aynı tut
    _syncNames() {
      const a = $("input-login-name");
      const b = $("input-name");
      if (a) a.value = this.profile.name;
      if (b) b.value = this.profile.name;
    },

    /* ==================== Ekran geçişleri ==================== */
    setScreen(name) {
      const screens = document.querySelectorAll(".screen");
      for (let i = 0; i < screens.length; i++) {
        screens[i].classList.toggle("is-active", screens[i].getAttribute("data-screen") === name);
      }
      this.currentScreen = name;
      const inGame = name === "__none__";
      this.setHudVisible(inGame);
    },

    setHudVisible(v) {
      const hud = $("hud");
      hud.classList.toggle("is-hidden", !v);
      hud.setAttribute("aria-hidden", v ? "false" : "true");
      this.game.canvas.style.cursor = v ? "none" : "default";
    },

    setLoading(pct, text) {
      $("loader-fill").style.width = Math.round(pct * 100) + "%";
      if (text) $("loader-text").textContent = text;
    },

    /* ==================== Olaylar ==================== */
    _bindEvents() {
      const self = this;

      $("input-name").addEventListener("input", (e) => {
        self.profile.name = e.target.value.trim().slice(0, 14) || "Oyuncu";
        self.saveProfile();
      });

      // Giriş ekranı: ad + OYNA
      const loginName = $("input-login-name");
      if (loginName) {
        loginName.addEventListener("input", (e) => {
          self.profile.name = e.target.value.trim().slice(0, 14) || "Oyuncu";
          self.saveProfile();
        });
        loginName.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); self.enterMenu(); }
        });
      }
      const loginBtn = $("btn-login-play");
      if (loginBtn) loginBtn.addEventListener("click", () => self.enterMenu());

      $("btn-quickplay").addEventListener("click", () => self.onQuickPlay && self.onQuickPlay());
      $("btn-open-rooms").addEventListener("click", () => { self.setScreen("rooms"); self.refreshRooms(); });
      $("btn-open-create").addEventListener("click", () => { self.setScreen("rooms"); });
      $("btn-rooms-back").addEventListener("click", () => self.setScreen("menu"));
      $("btn-rooms-refresh").addEventListener("click", () => self.refreshRooms());

      $("create-max").addEventListener("input", (e) => { $("create-max-label").textContent = e.target.value; });
      $("btn-create-room").addEventListener("click", () => {
        const name = $("create-name").value.trim() || (self.profile.name + " Arena");
        const max = parseInt($("create-max").value, 10) || 8;
        self.onCreateRoom && self.onCreateRoom({ roomName: name, maxClients: max });
      });

      $("btn-result-again").addEventListener("click", () => self.onQuickPlay && self.onQuickPlay());
      $("btn-result-menu").addEventListener("click", () => self.setScreen("menu"));

      $("btn-hud-leave").addEventListener("click", () => self.onLeaveMatch && self.onLeaveMatch());
      $("btn-hud-fullscreen").addEventListener("click", () => self.toggleFullscreen());
      $("btn-menu-fullscreen").addEventListener("click", () => self.toggleFullscreen());

      // F kısayolu: tam ekran
      window.addEventListener("keydown", (e) => {
        if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) self.toggleFullscreen();
      });

      document.addEventListener("fullscreenchange", () => {
        const on = !!document.fullscreenElement;
        $("btn-hud-fullscreen").textContent = on ? "Pencere" : "Tam Ekran";
        $("btn-menu-fullscreen").textContent = on ? "Pencere" : "Tam Ekran";
      });
    },

    toggleFullscreen() {
      try {
        if (!document.fullscreenElement) {
          const el = document.documentElement;
          const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
          if (req) req.call(el);
        } else {
          const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
          if (exit) exit.call(document);
        }
      } catch (e) { this.toast("Tam ekran açılamadı", "err"); }
    },

    _bindCrosshair() {
      const ch = $("crosshair");
      const move = (e) => {
        ch.style.left = e.clientX + "px";
        ch.style.top = e.clientY + "px";
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerdown", move);
    },

    _startPingMeter() {
      const self = this;
      const tick = () => {
        const t0 = performance.now();
        fetch("/health", { cache: "no-store" })
          .then(() => { self.net.latency = Math.round(performance.now() - t0); })
          .catch(() => { self.net.latency = -1; })
          .finally(() => {
            const el = $("hud-ping");
            if (el) el.textContent = self.net.latency >= 0 ? self.net.latency + " ms" : "— ms";
          });
      };
      tick();
      setInterval(tick, 3000);
    },

    /* ==================== Odalar ==================== */
    async refreshRooms() {
      const list = $("room-list");
      const empty = $("rooms-empty");
      try {
        const rooms = await this.net.listRooms();
        $("rooms-count").textContent = rooms.length;
        list.innerHTML = "";
        if (!rooms.length) {
          empty.classList.remove("is-hidden");
          return;
        }
        empty.classList.add("is-hidden");

        const self = this;
        rooms.forEach((r) => {
          const meta = r.metadata || {};
          const li = document.createElement("li");
          li.className = "room-item" + (r.clients >= r.maxClients ? " full" : "");

          const info = document.createElement("div");
          info.className = "room-item-info";
          const nm = document.createElement("div");
          nm.className = "room-item-name";
          nm.textContent = meta.name || "Arena";
          const mt = document.createElement("div");
          mt.className = "room-item-meta";
          const mapName = (NA.MAPS && NA.MAPS[meta.map] && NA.MAPS[meta.map].name) || "Neon Arena";
          mt.textContent = mapName + " · " + (meta.arena || 60) + "x" + (meta.arena || 60) + " birim";
          info.appendChild(nm); info.appendChild(mt);

          const pc = document.createElement("div");
          pc.className = "room-players";
          pc.textContent = r.clients + " / " + r.maxClients;

          li.appendChild(info); li.appendChild(pc);

          if (r.clients < r.maxClients) {
            li.addEventListener("click", () => self.onJoinRoom && self.onJoinRoom(r.roomId));
          }
          list.appendChild(li);
        });
      } catch (e) {
        empty.classList.remove("is-hidden");
        empty.textContent = "Odalar alınamadı. Sunucu çalışıyor mu?";
        this.toast("Oda listesi alınamadı", "err");
      }
    },

    /* ==================== HUD ==================== */
    updateHud(data) {
      if (!data) return;
      $("hud-trophies").textContent = data.self.trophies;
      $("hud-kills").textContent = data.self.kills;
      $("hud-deaths").textContent = data.self.deaths;
      $("hud-room-name").textContent = data.roomName;

      const hp = Math.max(0, data.self.hp);
      const maxHp = data.self.maxHp || 100;
      const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      const fill = $("hud-health-fill");
      fill.style.width = pct + "%";
      fill.classList.toggle("low", pct <= 35);
      $("hud-health-num").textContent = Math.round(hp);

      const ul = $("hud-leaderboard-list");
      ul.innerHTML = "";
      data.players.forEach((p, i) => {
        const li = document.createElement("li");
        if (p.me) li.className = "me";
        const r = document.createElement("span"); r.className = "lb-rank"; r.textContent = (i + 1);
        const n = document.createElement("span"); n.className = "lb-name"; n.textContent = p.name;
        const k = document.createElement("span"); k.className = "lb-kills"; k.textContent = p.kills;
        li.appendChild(r); li.appendChild(n); li.appendChild(k);
        ul.appendChild(li);
      });
    },

    // Alt HUD yetenek göstergeleri: atış bekleme + süper güç (null → gizle)
    updateAbilities(data) {
      const wrap = document.querySelector(".abilities");
      if (!wrap) return;
      if (!data) {
        wrap.classList.add("is-hidden");
        const sup0 = $("ab-super");
        if (sup0) sup0.classList.remove("ready", "active");
        return;
      }
      wrap.classList.remove("is-hidden");

      const shootCd = $("ab-shoot-cd");
      if (shootCd) {
        const remain = Math.max(0, Math.min(1, 1 - (data.shootPct || 0)));
        shootCd.style.height = Math.round(remain * 100) + "%";
      }

      const supName = $("ab-super-name");
      if (supName && data.superName) supName.textContent = data.superName;

      const sup = $("ab-super");
      const supCd = $("ab-super-cd");
      if (sup && supCd) {
        sup.classList.toggle("ready", !!data.superReady && !data.superActive);
        sup.classList.toggle("active", !!data.superActive);
        if (data.superActive) {
          const remain = Math.max(0, Math.min(1, 1 - (data.superActivePct || 0)));
          supCd.style.height = Math.round(remain * 100) + "%";
        } else if (data.superReady) {
          supCd.style.height = "0%";
        } else {
          const remain = Math.max(0, Math.min(1, 1 - (data.superPct || 0)));
          supCd.style.height = Math.round(remain * 100) + "%";
        }
      }
    },

    // Süper güç kullanıldığında görsel geri bildirim
    showSuperUsed(name) {
      this.toast((name || "SÜPER GÜÇ") + " aktif!", "ok");
      const sup = $("ab-super");
      if (sup) {
        sup.classList.remove("used");
        void sup.offsetWidth;
        sup.classList.add("used");
        setTimeout(() => sup.classList.remove("used"), 600);
      }
    },

    pushKillFeed(msg) {
      const wrap = $("hud-killfeed");
      const el = document.createElement("div");
      el.className = "killfeed-item";
      const killer = msg.killerName || "Arena";
      el.innerHTML = "<b>" + escapeHtml(killer) + "</b> ▸ <span class='victim'>" + escapeHtml(msg.victimName || "?") + "</span>";
      wrap.appendChild(el);
      while (wrap.children.length > 5) wrap.removeChild(wrap.firstChild);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
    },

    showHitmarker() {
      const hm = $("hitmarker");
      hm.classList.remove("show");
      void hm.offsetWidth;
      hm.classList.add("show");
      const ch = $("crosshair");
      ch.classList.add("hit");
      setTimeout(() => ch.classList.remove("hit"), 140);
    },

    flashDamage() {
      const dv = $("damage-vignette");
      dv.classList.add("show");
      clearTimeout(this._dvT);
      this._dvT = setTimeout(() => dv.classList.remove("show"), 120);
    },

    showKillConfirm(name) {
      this.toast(escapeHtml(name) + " elendi!", "ok");
    },

    showRespawn(killerName) {
      const ov = $("respawn-overlay");
      ov.classList.remove("is-hidden");
      $("respawn-killer").textContent = killerName ? (killerName + " tarafından elendin") : "Elendin";
      let n = 3;
      $("respawn-count").textContent = n;
      clearInterval(this._respT);
      this._respT = setInterval(() => {
        n -= 1;
        if (n <= 0) { clearInterval(this._respT); $("respawn-count").textContent = "0"; }
        else $("respawn-count").textContent = n;
      }, 1000);
    },

    hideRespawn() {
      clearInterval(this._respT);
      $("respawn-overlay").classList.add("is-hidden");
    },

    /* ==================== Toast ==================== */
    toast(text, kind) {
      const wrap = $("toast-wrap");
      const el = document.createElement("div");
      el.className = "toast" + (kind ? " " + kind : "");
      el.textContent = text;
      wrap.appendChild(el);
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Süper güç türüne göre kart simgesi (Brawl Stars tarzı portre)
  const SUPER_GLYPHS = { charge: "◈", turbo: "»", shield: "⬢", heal: "✚", rapid: "⋙" };
  function glyphFor(t) {
    return SUPER_GLYPHS[(t.super && t.super.kind) || ""] || "◆";
  }

  NA.UI = UI;
  NA.RANKS = RANKS;
})();
