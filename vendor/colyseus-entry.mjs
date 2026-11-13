// colyseus.js SDK'sını tarayıcı için yeniden paketleyen giriş noktası.
// esbuild bu dosyayı "ws" stub'ı ile bundle edip window.Colyseus üretir.
import * as SDK from "colyseus.js";

window.Colyseus = SDK;
