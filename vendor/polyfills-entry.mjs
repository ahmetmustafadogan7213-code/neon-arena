// Tarayıcı için Node polyfill'leri.
// Colyseus SDK'sı Node ortamını varsaydığı için Buffer / process / global global'leri
// colyseus-sdk.js dosyasından ÖNCE yüklenmelidir (index.html sıralamasına bakın).
import { Buffer } from "buffer";

window.Buffer = Buffer;
globalThis.Buffer = Buffer;
window.global = window.global || window;
window.process = window.process || {
  env: {},
  argv: [],
  version: "",
  versions: {},
  platform: "browser",
  browser: true,
  cwd: function () { return "/"; },
  nextTick: function (fn) {
    var args = [].slice.call(arguments, 1);
    setTimeout(function () { fn.apply(null, args); }, 0);
  },
};
