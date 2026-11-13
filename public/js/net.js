/* ==========================================================================
   net.js — Colyseus istemci sarmalayıcısı
   Oda listeleme, oda oluşturma, hızlı oyun ve mesajlaşmayı yönetir.
   ========================================================================== */
(function () {
  "use strict";
  const NA = (window.NA = window.NA || {});

  // Sunucu aynı kökten servis edildiği için adresi tarayıcıdan türetiyoruz.
  function serverEndpoint() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  }

  const ROOM_NAME = "arena";

  class Net {
    constructor() {
      this.endpoint = serverEndpoint();
      this.client = new Colyseus.Client(this.endpoint);
      this.room = null;
      this.latency = 0;
    }

    /* ---- Oda listesi --------------------------------------------------- */
    async listRooms() {
      const rooms = await this.client.getAvailableRooms(ROOM_NAME);
      // Boş odaları en sona at, dolu odaları üste al
      return rooms.sort((a, b) => b.clients - a.clients);
    }

    /* ---- Katılma yolları ----------------------------------------------- */
    async quickPlay(options) {
      const room = await this.client.joinOrCreate(ROOM_NAME, options);
      return this._attach(room);
    }

    async joinById(roomId, options) {
      const room = await this.client.joinById(roomId, options);
      return this._attach(room);
    }

    async createRoom(options) {
      const room = await this.client.create(ROOM_NAME, options);
      return this._attach(room);
    }

    _attach(room) {
      this.room = room;
      return room;
    }

    /* ---- Mesajlaşma ---------------------------------------------------- */
    send(type, data) {
      if (this.room) {
        try { this.room.send(type, data); } catch (e) { /* bağlantı koptuysa yut */ }
      }
    }

    async leave() {
      const room = this.room;
      this.room = null;
      if (!room) return;
      try { await room.leave(true); } catch (e) { /* yoksay */ }
    }
  }

  NA.Net = Net;
  NA.serverEndpoint = serverEndpoint;
})();
