// Tarayıcı için "ws" paketi yerine boş stub.
// colyseus.js/lib/transport/WebSocketTransport.js modül seviyesinde require("ws")
// yapıyor; "ws" paketi Node'a özel API'ler (util.isUtf8, zlib, net...) kullandığı
// için tarayıcıda yüklenince patlıyor. Tarayıcıda zaten native WebSocket kullanılır.
module.exports = {};
