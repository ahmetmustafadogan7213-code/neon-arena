"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { ArenaRoom } = require("./rooms/ArenaRoom");

const PORT = Number(process.env.PORT) || 2567;
const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// HTTP sunucusu: hem oyun istemcisini hem kütüphaneleri hem de Colyseus
// eşleştirme (matchmaking) uç noktalarını aynı porttan servis eder.
// Böylece tek komutla çalışır.
// ---------------------------------------------------------------------------
const app = express();

// İstemci dosyaları
app.use(express.static(path.join(ROOT, "public")));

// İstemci ve sunucunun paylaştığı oyun verisi (tank/harita/çarpışma)
app.use("/shared", express.static(path.join(ROOT, "shared")));

// Kütüphaneler npm'den servis edilir (CDN bağımlılığı yok, sürüm sabit)
app.use("/vendor/babylon", express.static(path.join(ROOT, "node_modules", "babylonjs")));
app.use("/vendor/colyseus", express.static(path.join(ROOT, "node_modules", "colyseus.js", "dist")));

app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const httpServer = http.createServer(app);

// ---------------------------------------------------------------------------
// Oyun sunucusu
// ---------------------------------------------------------------------------
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Oda tiplerini tanımla. "arena" tipi lobide listelenir.
gameServer.define("arena", ArenaRoom);

gameServer.listen(PORT).then(() => {
  console.log("");
  console.log("  +------------------------------------------+");
  console.log("  |        NEON ARENA  -  hazir              |");
  console.log("  +------------------------------------------+");
  console.log(`  Oyunu tarayicida ac:  http://localhost:${PORT}`);
  console.log("");
});
