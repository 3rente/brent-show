/*! brent-show.js —
 *  Copyright (c) 2026 Brent Eliason. All rights reserved. Not open source: no permission is granted to copy, modify,
 *  redistribute or reuse this code or its assets, or to use them to train or improve AI/machine-learning models.
 *  See LICENSE. Third-party map data in assets/earth.json keeps its own license (see LICENSE, section 4).
 *  Mount: <div id="brent-show"></div><script src=".../brent-show.js" defer></script>
 *  Options on the div: data-accent="#FF5B1F"  data-hide-header="true"  data-hide-footer="true"  data-takeover="true"
 *  While Squarespace is in edit mode (or with ?brentshow=off in the URL) the show steps aside and the code block
 *  shows a placeholder, so the block stays easy to find and edit.
 */
(function () {
'use strict';
var SCRIPT = document.currentScript;
var BASE = (SCRIPT && SCRIPT.src) ? SCRIPT.src.replace(/[^\/?#]*([?#].*)?$/, '') + 'assets/' : 'assets/';
function DCLogic(props) { this.props = props || {}; this.state = {}; }
DCLogic.prototype.setState = function (p) { for (var k in p) this.state[k] = p[k]; if (this._apply) this._apply(); };

// ===================== component (exported from the design canvas) =====================

var TAU = Math.PI * 2;
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function ease(u) { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function easeOut(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }
function easeIn(u) { u = clamp01(u); return u * u * u; }
function smooth(e0, e1, x) { var t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function mixRGB(a, b, t) { return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]; }
function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }

// ================= Spatial photo (cursor-driven 2.5D portrait), drawn into the full stage =================
// Beyond the depth parallax, the shader takes the sunset with it: a warm tint, a rim light on the edge facing the sun,
// and a fade to a backlit silhouette as the sun goes behind the head.
var PHOTO_URL = BASE + 'portrait.webp';
var DEPTH_URL = BASE + 'portrait-depth.png';
var SPATIAL_MAX_X = 0.036, SPATIAL_MAX_Y = 0.026;
var SPATIAL_VS = 'attribute vec2 a;varying vec2 v;void main(){v=vec2((a.x+1.0)*0.5,1.0-(a.y+1.0)*0.5);gl_Position=vec4(a,0.0,1.0);}';
var SPATIAL_FS = 'precision mediump float;varying vec2 v;uniform sampler2D uImg;uniform sampler2D uDep;uniform vec2 uOff;uniform float uZoom;' +
  'uniform vec3 uTint;uniform float uDark;uniform vec2 uSun;uniform float uRim;uniform vec3 uRimCol;' +
  'void main(){vec2 uv=(v-0.5)/uZoom+0.5;float d=texture2D(uDep,uv).r;' +
  'for(int i=0;i<6;i++){d=texture2D(uDep,uv-uOff*(d-0.45)).r;}' +
  'vec2 p=uv-uOff*(d-0.45);' +
  'if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0){gl_FragColor=vec4(0.0);return;}' +
  'vec4 c=texture2D(uImg,p);' +
  'vec3 col=c.rgb*uTint;col=mix(col,vec3(0.03,0.035,0.05)*c.a,uDark);' +
  'float a1=texture2D(uImg,p+uSun).a;float a2=texture2D(uImg,p+uSun*2.4).a;' +
  'float rim=clamp(c.a-0.55*a1-0.45*a2,0.0,1.0)*uRim;' +
  'col+=uRimCol*rim*c.a;' +
  'gl_FragColor=vec4(col,c.a);}';
function initSpatial(cv, onReady) {
  var gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
  var vs = sh(gl.VERTEX_SHADER, SPATIAL_VS), fs = sh(gl.FRAGMENT_SHADER, SPATIAL_FS);
  if (!vs || !fs) return null;
  var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = function (n) { return gl.getUniformLocation(prog, n); };
  var S = { gl: gl, uOff: U('uOff'), uZoom: U('uZoom'), uTint: U('uTint'), uDark: U('uDark'), uSun: U('uSun'), uRim: U('uRim'), uRimCol: U('uRimCol'), ready: false };
  var loaded = 0;
  function tex(unit, url, uniform) {
    var t = gl.createTexture(), img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, uniform), unit);
      if (++loaded === 2) { S.ready = true; onReady(); }
    };
    img.src = url;
  }
  tex(0, PHOTO_URL, 'uImg'); tex(1, DEPTH_URL, 'uDep');
  return S;
}
// P = portrait square {x, y, S} in stage px; clip = visible rect {x, y, w, h}; L = look (tint, dark, sun, rim, rimCol)
function drawSpatialStage(Sp, cv, W, H, P, clip, ox, oy, L) {
  var gl = Sp.gl, dpr = Math.min(2, window.devicePixelRatio || 1);
  var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (!pw || !ph) return;
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, pw, ph);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  var x0 = Math.max(0, clip.x), y0 = Math.max(0, clip.y), x1 = Math.min(W, clip.x + clip.w), y1 = Math.min(H, clip.y + clip.h);
  if (x1 <= x0 || y1 <= y0 || P.S <= 1) return;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(Math.round(x0 * dpr), Math.round((H - y1) * dpr), Math.round((x1 - x0) * dpr), Math.round((y1 - y0) * dpr));
  gl.viewport(Math.round(P.x * dpr), Math.round((H - P.y - P.S) * dpr), Math.round(P.S * dpr), Math.round(P.S * dpr));
  gl.uniform2f(Sp.uOff, ox, oy); gl.uniform1f(Sp.uZoom, 1.03);
  gl.uniform3f(Sp.uTint, L.tint[0], L.tint[1], L.tint[2]); gl.uniform1f(Sp.uDark, L.dark);
  gl.uniform2f(Sp.uSun, L.sun[0], L.sun[1]); gl.uniform1f(Sp.uRim, L.rim);
  gl.uniform3f(Sp.uRimCol, L.rimCol[0] / 255, L.rimCol[1] / 255, L.rimCol[2] / 255);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ================= Scroll timeline (p = 0..1 through the pinned stage) =================
// 0.02–0.42 sunset: sky warms, the sun sinks behind the head, warm tint and rim light on the face
// 0.18–0.34 collapse: the full-bleed hero shrinks into a centred card; the page goes dark; marquee lines slide behind it
// 0.32–0.46 the face becomes a backlit silhouette
// 0.46–0.62 the silhouette sets below the horizon like the sun while the card opens back out to full night
// 0.56–0.66 the airfield arms on the horizon · 0.64–0.9 scroll scrubs the launch · 0.9–0.96 the name locks
function keyed(keys, p) {
  if (p <= keys[0][0]) return keys[0][1].slice();
  for (var i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) { var a = keys[i - 1], b = keys[i], f = (p - a[0]) / (b[0] - a[0]); return a[1].map(function (v, k) { return v + (b[1][k] - v) * f; }); }
  }
  return keys[keys.length - 1][1].slice();
}
var SKY_TOP = [[0, [242, 241, 237]], [0.1, [240, 228, 206]], [0.2, [182, 156, 172]], [0.3, [96, 76, 112]], [0.4, [36, 36, 64]], [0.5, [12, 14, 27]], [0.62, [6, 8, 13]]];
var SKY_BOT = [[0, [242, 241, 237]], [0.1, [250, 214, 166]], [0.2, [255, 170, 104]], [0.3, [246, 122, 78]], [0.4, [172, 80, 70]], [0.5, [70, 40, 54]], [0.62, [20, 24, 36]]];
var OUTER = [[0.18, [44, 34, 40]], [0.34, [22, 20, 30]], [0.5, [11, 14, 19]]];
var SUN_COL = [[0.04, [255, 246, 226]], [0.18, [255, 214, 150]], [0.3, [255, 152, 92]], [0.42, [255, 112, 70]]];
var TINT = [[0, [1, 1, 1]], [0.12, [1.03, 0.97, 0.88]], [0.26, [0.98, 0.82, 0.72]], [0.36, [0.8, 0.62, 0.6]]];
var GROUND = [8, 10, 14];
var MARQUEE_1 = 'When the sun goes down · ', MARQUEE_2 = 'THE SHOW GOES UP · ';
function stageLayout(W, H, p, S0, y0) {
  var c = ease(smooth(0.18, 0.34, p)), e = ease(smooth(0.5, 0.64, p)), k = ease(smooth(0.46, 0.62, p));
  var cw = Math.min(W * 0.48, 720), ch = cw * 0.66, ccx = W / 2, ccy = H * 0.5;
  var C1 = { x: ccx - cw / 2, y: ccy - ch / 2, w: cw, h: ch };
  var S1 = ch * 1.45, P1 = { x: ccx - 0.505 * S1, y: ccy - 0.36 * S1 + ch * 0.05, S: S1 };
  var P0 = { x: (W - S0) / 2, y: y0, S: S0 };
  var Cc = { x: lerp(0, C1.x, c), y: lerp(0, C1.y, c), w: lerp(W, C1.w, c), h: lerp(H, C1.h, c) };
  // the card opens out to full-bleed night; it keeps the hero card's rounded corners while it grows and only
  // squares off in the last moment as it meets the screen edges
  var C = { x: lerp(Cc.x, 0, e), y: lerp(Cc.y, 0, e), w: lerp(Cc.w, W, e), h: lerp(Cc.h, H, e), r: 14 * c * (1 - smooth(0.88, 1, e)) };
  var P = { x: lerp(P0.x, P1.x, c), y: lerp(P0.y, P1.y, c), S: lerp(P0.S, P1.S, c) };
  var horizon = H * HORIZON;
  P.y += k * (horizon - (P1.y + 0.09 * S1) + 40);
  var hl = lerp(Cc.y + Cc.h, horizon, e);
  return { c: c, e: e, k: k, C: C, P: P, hl: e > 0 ? hl : C.y + C.h, horizon: horizon };
}

// ================= Delivery: drone flies in, winches a box down, box unfolds into the Next Show card =================
// The drone flies in from the right at one fixed altitude (just above the head), winches the package down, then exits left.
var DLV = { enterStart: 0.3, enterEnd: 2.4, lowerStart: 2.6, lowerEnd: 4.4, release: 4.45, retractEnd: 5.1, exitStart: 5.0, exitEnd: 6.4,
  flapStart: 4.65, flapEnd: 5.25, morphStart: 5.25, morphEnd: 5.95, cardAt: 5.85, done: 6.8 };
// package in the page palette: off-white panels, ink-grey edges, accent tape
var KRAFT = { front: [230, 228, 222], top: [239, 237, 232], side: [212, 209, 202], edge: [96, 100, 104] };
var INK = '#15171A';
var BOX_W = 40, BOX_H = 32, BOX_DX = 8, BOX_DY = 6;   // smaller than the drone's ~130 px span, like a real delivery
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
function roundRectPathAppend(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
// ---- the hangar: an airliner hangar front whose two great doors roll apart, revealing a lit interior
function drawHangar(f, W, H, h, s, accent) {
  var a = smooth(0, 0.14, h), open = ease(smooth(0.2, 0.52, h)), pull = ease(smooth(0, 0.22, h));
  if (a < 0.01) return;
  f.save(); f.globalAlpha = a;
  // camera pulls back from the map to frame the hangar front
  var sc = lerp(1.22, 1, pull);
  f.translate(W / 2, H * 0.55); f.scale(sc, sc); f.translate(-W / 2, -H * 0.55);
  var top = H * 0.07, bot = H * 0.93, vpx = W / 2, vpy = H * 0.46;
  // --- interior, seen through the opening
  var ig = f.createLinearGradient(0, top, 0, bot);
  ig.addColorStop(0, '#07090C'); ig.addColorStop(0.55, '#10131A'); ig.addColorStop(1, '#1A1E25');
  f.fillStyle = ig; f.fillRect(-W * 0.2, top, W * 1.4, bot - top);
  var bw = W * 0.44, bh = H * 0.34, bx = vpx - bw / 2, by = vpy - bh * 0.62;   // back wall
  f.strokeStyle = 'rgba(237,238,233,0.1)'; f.lineWidth = 1;
  f.strokeRect(bx, by, bw, bh);
  var bwg = f.createRadialGradient(vpx, by + bh * 0.5, 0, vpx, by + bh * 0.5, bw * 0.8);   // soft light on the back wall
  bwg.addColorStop(0, 'rgba(255,232,200,0.08)'); bwg.addColorStop(1, 'rgba(255,232,200,0)'); f.fillStyle = bwg; f.fillRect(bx - bw * 0.3, by - bh * 0.3, bw * 1.6, bh * 1.6);
  // roof trusses converging to the back wall
  for (var k = 0; k <= 12; k++) {
    var ux = k / 12, tx = -W * 0.1 + ux * W * 1.2, ex = bx + ux * bw;
    f.beginPath(); f.moveTo(tx, top); f.lineTo(ex, by); f.stroke();
  }
  for (k = 1; k <= 6; k++) {   // cross members receding
    var d = Math.pow(k / 7, 1.6), yy = lerp(top, by, d), xl = lerp(-W * 0.1, bx, d), xr = lerp(W * 1.1, bx + bw, d);
    f.beginPath(); f.moveTo(xl, yy); f.lineTo(xr, yy); f.stroke();
    // overhead lights along each bay
    f.fillStyle = 'rgba(255,236,206,' + (0.5 - k * 0.05) + ')';
    for (var q = 1; q < 6; q++) { var lx = lerp(xl, xr, q / 6); f.beginPath(); f.ellipse(lx, yy + 6, 10 * (1 - d * 0.7), 2.4 * (1 - d * 0.7), 0, 0, TAU); f.fill(); }
  }
  // floor: expansion joints to the vanishing point, warm pools of light, and a centre guide line
  var fy = by + bh;
  for (k = 0; k <= 10; k++) { var fx = -W * 0.2 + k / 10 * W * 1.4; f.beginPath(); f.moveTo(fx, bot); f.lineTo(bx + k / 10 * bw, fy); f.stroke(); }
  for (k = 1; k <= 5; k++) { var dy = Math.pow(k / 6, 1.8), y2 = lerp(fy, bot, dy); f.beginPath(); f.moveTo(lerp(bx, -W * 0.2, dy), y2); f.lineTo(lerp(bx + bw, W * 1.2, dy), y2); f.stroke(); }
  [[0.5, 0.82, 0.32], [0.24, 0.74, 0.18], [0.76, 0.74, 0.18]].forEach(function (L) {
    var lg = f.createRadialGradient(W * L[0], H * L[1], 0, W * L[0], H * L[1], W * L[2]);
    lg.addColorStop(0, 'rgba(255,226,186,0.10)'); lg.addColorStop(1, 'rgba(255,226,186,0)');
    f.fillStyle = lg; f.fillRect(0, top, W, bot - top);
  });
  f.strokeStyle = rgb(hexRGB(accent), 0.55); f.lineWidth = 3; f.setLineDash([22, 16]);
  f.beginPath(); f.moveTo(vpx, bot); f.lineTo(vpx, fy); f.stroke(); f.setLineDash([]);
  drawWorks(f, W, H, s, accent, top, fy);
  // --- the doors: two corrugated steel panels that roll apart along the top rail
  var half = W / 2 + 2, slide = open * (W * 0.56);
  var door = function (x0, dir) {
    var dg = f.createLinearGradient(x0, 0, x0 + half, 0);
    dg.addColorStop(0, dir < 0 ? '#2B3038' : '#353B44'); dg.addColorStop(1, dir < 0 ? '#353B44' : '#2B3038');
    f.fillStyle = dg; f.fillRect(x0, top, half, bot - top);
    for (var r = x0 + 7; r < x0 + half; r += 14) {   // corrugation
      f.fillStyle = 'rgba(255,255,255,0.045)'; f.fillRect(r, top, 3, bot - top);
      f.fillStyle = 'rgba(0,0,0,0.18)'; f.fillRect(r + 5, top, 2, bot - top);
    }
    for (r = x0; r < x0 + half; r += half / 4) { f.fillStyle = 'rgba(0,0,0,0.38)'; f.fillRect(r, top, 2, bot - top); }   // panel seams
    f.fillStyle = 'rgba(0,0,0,0.3)'; f.fillRect(x0, bot - H * 0.05, half, H * 0.05);   // kick plate
    f.save(); f.beginPath(); f.rect(x0, bot - H * 0.05, half, H * 0.05); f.clip();   // hazard chevrons on the leading edge
    f.fillStyle = rgb(hexRGB(accent), 0.55);
    for (var c = x0 - 40; c < x0 + half + 40; c += 26) { f.beginPath(); f.moveTo(c, bot); f.lineTo(c + 12, bot); f.lineTo(c + 12 + H * 0.05, bot - H * 0.05); f.lineTo(c + H * 0.05, bot - H * 0.05); f.closePath(); f.fill(); }
    f.restore();
  };
  door(-slide - 2, -1);
  door(W / 2 + slide, 1);
  // light spilling through the gap as the doors part
  if (open > 0.001 && open < 0.98) {
    var gx0 = W / 2 - slide, gx1 = W / 2 + slide, glow = f.createLinearGradient(gx0 - 40, 0, gx1 + 40, 0);
    glow.addColorStop(0, 'rgba(255,230,190,0)'); glow.addColorStop(0.5, 'rgba(255,230,190,' + (0.22 * (1 - open)) + ')'); glow.addColorStop(1, 'rgba(255,230,190,0)');
    f.fillStyle = glow; f.fillRect(gx0 - 40, top, gx1 - gx0 + 80, bot - top);
  }
  // header beam, rail and stencil
  f.fillStyle = '#14171C'; f.fillRect(-W * 0.2, 0, W * 1.4, top + 4);
  f.fillStyle = 'rgba(255,255,255,0.06)'; f.fillRect(-W * 0.2, top - 3, W * 1.4, 2);
  // stencil: HANGAR followed by the 3E monogram
  var th = Math.round(top * 0.5), lh = th * 1.02, lw = lh * 330 / 254, gap = th * 0.45;
  f.font = '900 ' + th + 'px "Big Shoulders Display", Impact, sans-serif';
  var tw = f.measureText('HANGAR').width, sx0 = W / 2 - (tw + gap + lw) / 2, base = top * 0.72;
  f.fillStyle = 'rgba(237,238,233,0.6)'; f.fillText('HANGAR', sx0, base);
  f.save(); f.translate(sx0 + tw + gap, base - lh * 0.86); f.scale(lh / 254, lh / 254); f.translate(62, 20); f.transform(1, 0, -0.2, 1, 0, 0);
  f.lineWidth = 34; f.lineCap = 'butt';
  f.strokeStyle = accent; f.stroke(LOGO_3); f.strokeStyle = 'rgba(237,238,233,0.6)'; f.stroke(LOGO_E);
  f.restore();
  // apron in front of the doors
  var ag = f.createLinearGradient(0, bot, 0, H);
  ag.addColorStop(0, '#1D2128'); ag.addColorStop(1, '#0B0E13');
  f.fillStyle = ag; f.fillRect(-W * 0.2, bot, W * 1.4, H - bot + H * 0.3);
  f.restore(); f.globalAlpha = 1;
}
// hangar interior as a construction site: work lights, a gantry crane swinging the next crate in, barricades with rotating beacons
function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function drawWorks(f, W, H, s, accent, top, fy) {
  var A = hexRGB(accent), u = H / 900, floor = H * 0.83;
  var ln = function (x0, y0, x1, y1) { f.beginPath(); f.moveTo(x0, y0); f.lineTo(x1, y1); f.stroke(); };
  // warm work floods on the build and the two towers
  [[0.5, 0.62, 0.34], [0.15, 0.7, 0.2], [0.85, 0.7, 0.2]].forEach(function (L) {
    var g = f.createRadialGradient(W * L[0], H * L[1], 0, W * L[0], H * L[1], W * L[2]);
    g.addColorStop(0, 'rgba(255,214,160,0.10)'); g.addColorStop(1, 'rgba(255,214,160,0)'); f.fillStyle = g; f.fillRect(0, top, W, H - top);
  });
  // gantry crane: a rail under the trusses, a trolley drifting, a crate swaying on the hook
  var ry = top + H * 0.012;
  f.fillStyle = '#1E232B'; f.fillRect(W * 0.08, ry, W * 0.84, 10 * u);
  f.fillStyle = rgb(A, 0.55); for (var x = W * 0.08; x < W * 0.92; x += 36 * u) f.fillRect(x, ry + 10 * u, 18 * u, 3 * u);
  var tx = W * (0.79 + 0.03 * Math.sin(s * 0.3)), sw = 0.06 * Math.sin(s * 1.25 + 0.6) - 0.03 * Math.cos(s * 0.3), len = H * 0.2;
  f.fillStyle = '#2B313A'; f.fillRect(tx - 24 * u, ry + 10 * u, 48 * u, 14 * u);
  var hx = tx + Math.sin(sw) * len, hy = ry + 24 * u + Math.cos(sw) * len;
  f.strokeStyle = 'rgba(200,206,214,0.45)'; f.lineWidth = 1.3 * u; ln(tx - 4 * u, ry + 24 * u, hx - 4 * u, hy); ln(tx + 4 * u, ry + 24 * u, hx + 4 * u, hy);
  f.save(); f.translate(hx, hy); f.rotate(-sw);
  f.fillStyle = rgb(A, 0.9); f.fillRect(-7 * u, 0, 14 * u, 9 * u);
  f.strokeStyle = 'rgba(200,206,214,0.4)'; f.lineWidth = 1.2 * u; ln(0, 9 * u, -34 * u, 30 * u); ln(0, 9 * u, 34 * u, 30 * u);
  f.fillStyle = '#4A3B28'; f.fillRect(-40 * u, 30 * u, 80 * u, 54 * u);
  f.fillStyle = 'rgba(0,0,0,0.25)'; for (var pk = 1; pk < 4; pk++) f.fillRect(-40 * u, 30 * u + pk * 13.5 * u, 80 * u, 1.5 * u);
  f.fillStyle = 'rgba(237,238,233,0.65)'; f.font = '700 ' + Math.max(8, Math.round(10 * u)) + 'px "JetBrains Mono", monospace'; f.textAlign = 'center';
  f.fillText('NEXT BUILD', 0, 61 * u); f.textAlign = 'left';
  f.restore();
  // front line: barricades with rotating amber beacons, cones, caution tape across the aisle
  var fb = H * 0.9, posts = [];
  var cone = function (x, y, h) {
    f.fillStyle = rgb(A, 0.95); f.beginPath(); f.moveTo(x - h * 0.32, y); f.lineTo(x - h * 0.08, y - h); f.lineTo(x + h * 0.08, y - h); f.lineTo(x + h * 0.32, y); f.closePath(); f.fill();
    f.fillStyle = 'rgba(237,238,233,0.85)'; f.fillRect(x - h * 0.2, y - h * 0.58, h * 0.4, h * 0.13);
    f.fillStyle = '#15181D'; f.fillRect(x - h * 0.42, y - 3 * u, h * 0.84, 4 * u);
  };
  var barricade = function (x, y, w, id) {
    var bh = 42 * u;
    f.strokeStyle = '#2A3038'; f.lineWidth = 4 * u; ln(x - w / 2 + 6 * u, y, x - w / 2 + 14 * u, y - bh); ln(x + w / 2 - 6 * u, y, x + w / 2 - 14 * u, y - bh);
    f.save(); f.beginPath(); f.rect(x - w / 2, y - bh - 14 * u, w, 14 * u); f.clip();
    f.fillStyle = 'rgba(237,238,233,0.9)'; f.fillRect(x - w / 2, y - bh - 14 * u, w, 14 * u);
    f.fillStyle = rgb(A, 1);
    for (var c = x - w / 2 - 20 * u; c < x + w / 2; c += 22 * u) { f.beginPath(); f.moveTo(c, y - bh); f.lineTo(c + 11 * u, y - bh); f.lineTo(c + 25 * u, y - bh - 14 * u); f.lineTo(c + 14 * u, y - bh - 14 * u); f.closePath(); f.fill(); }
    f.restore();
    var bx = x + (id ? -1 : 1) * (w / 2 - 12 * u), by = y - bh - 20 * u, rot = Math.pow(Math.max(0, Math.cos(s * 4.2 + id * 2.1)), 3);
    var g = f.createRadialGradient(bx, by, 0, bx, by, 80 * u); g.addColorStop(0, 'rgba(255,170,40,' + (0.55 * rot).toFixed(2) + ')'); g.addColorStop(1, 'rgba(255,170,40,0)');
    f.fillStyle = g; f.fillRect(bx - 80 * u, by - 80 * u, 160 * u, 160 * u);
    f.fillStyle = 'rgba(255,' + Math.round(150 + 60 * rot) + ',40,' + (0.55 + 0.45 * rot).toFixed(2) + ')';
    f.beginPath(); f.arc(bx, by + 6 * u, 6 * u, Math.PI, 0); f.fill(); f.fillRect(bx - 6 * u, by + 6 * u, 12 * u, 3 * u);
    posts.push([x - w / 2, y - bh * 0.5], [x + w / 2, y - bh * 0.5]);
  };
  barricade(W * 0.24, fb, 120 * u, 0);
  barricade(W * 0.76, fb, 120 * u, 1);
  var tl = posts[1], tr = posts[2];
  var sag = 26 * u + 3 * u * Math.sin(s * 1.1), midx = (tl[0] + tr[0]) / 2, midy = (tl[1] + tr[1]) / 2 + sag * 2;
  f.lineWidth = 6 * u; f.strokeStyle = rgb(A, 0.9); f.beginPath(); f.moveTo(tl[0], tl[1]); f.quadraticCurveTo(midx, midy, tr[0], tr[1]); f.stroke();
  f.strokeStyle = 'rgba(20,22,26,0.9)'; f.setLineDash([12 * u, 12 * u]); f.stroke(); f.setLineDash([]);
  cone(W * 0.36, fb + 6 * u, 34 * u); cone(W * 0.64, fb + 6 * u, 34 * u);
}
// where each project is parked: a row of stands across the hangar floor
function hangarLayout(W, H, n) {
  // two displays down each side of the hangar, the inner pair set further back, all angled toward the centre aisle
  var slots = [[0.15, 0.8, 0.9, 24], [0.31, 0.735, 0.76, 16], [0.69, 0.735, 0.76, -16], [0.85, 0.8, 0.9, -24]];
  return slots.slice(0, n).map(function (q) { return { x: W * q[0], y: H * q[1], sc: q[2], ry: q[3] }; });
}
// the centre stage a project is brought to for reading
function hangarStage(W, H) { return { x: W / 2, y: H * 0.86, sc: 1.16 }; }
var HANGAR_CARDS = 4, HANGAR_LIFT = null;
var LOGO_3 = typeof Path2D !== 'undefined' ? new Path2D('M0 0H55A50 50 0 0 1 55 100H25M55 100A50 50 0 0 1 55 200H0') : null;
var LOGO_E = typeof Path2D !== 'undefined' ? new Path2D('M245 0H155V200H245M155 100H227') : null;
function hexRGB(h) { h = (h || '#FF5B1F').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
// ---- daytime backdrop: a minimal UTM picture — delivery hubs, the planned routes as faint dotted arcs, and aircraft
// moving along them with operator/altitude tags. No ground detail: the flight network itself is the texture. The city is drawn once to an offscreen
// canvas; only the aircraft are redrawn each frame.
var UTM_CACHE = null;
function utmRand(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function buildUTM(W, H) {
  var R = utmRand(4242), i, j, dpr = Math.min(2, window.devicePixelRatio || 1);
  var cv = document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // flights: two per operator, each a long sweeping arc that crosses the frame edge to edge, flown out and back.
  // The overlapping arcs read like a topographic web of routes; Flytrex in the accent colour.
  var ops = ['AMZ', 'WNG', 'FTX', 'ZIP'], flights = [];
  var ROUTES = [
    [[-0.06, 0.18], [0.5, -0.06], [1.06, 0.42]], [[-0.06, 0.8], [0.28, 0.52], [0.64, 1.06]],
    [[0.18, -0.06], [0.86, 0.08], [1.06, 0.74]], [[-0.06, 0.46], [0.14, 0.12], [0.56, -0.06]],
    [[1.06, 0.14], [0.56, 0.66], [-0.06, 0.62]], [[1.06, 0.96], [1.0, 0.32], [0.36, -0.06]],
    [[0.4, 1.06], [0.72, 0.78], [1.06, 0.54]], [[-0.06, 0.3], [0.02, 0.86], [0.3, 1.06]]
  ];
  for (i = 0; i < ROUTES.length; i++) {
    var rt = ROUTES[i], op = ops[Math.floor(i / 2)];
    flights.push({ a: [rt[0][0] * W, rt[0][1] * H], c: [rt[1][0] * W, rt[1][1] * H], b: [rt[2][0] * W, rt[2][1] * H],
      speed: 46 + R() * 18, off: R() * 400, tag: op + '-' + (100 + Math.floor(R() * 800)),
      alt: [120, 150, 200, 250, 300, 350][Math.floor(R() * 6)] + ' FT', hot: op === 'FTX' });
  }
  flights.forEach(function (F) {   // approximate route length for constant ground speed
    var L = 0, px = F.a[0], py = F.a[1];
    for (var k = 1; k <= 24; k++) { var t = k / 24, qx = (1 - t) * (1 - t) * F.a[0] + 2 * (1 - t) * t * F.c[0] + t * t * F.b[0], qy = (1 - t) * (1 - t) * F.a[1] + 2 * (1 - t) * t * F.c[1] + t * t * F.b[1]; L += Math.hypot(qx - px, qy - py); px = qx; py = qy; }
    F.L = L;
  });
  return { W: W, H: H, dpr: dpr, city: cv, flights: flights };
}
function bez(F, t) {
  var u = 1 - t;
  return [u * u * F.a[0] + 2 * u * t * F.c[0] + t * t * F.b[0], u * u * F.a[1] + 2 * u * t * F.c[1] + t * t * F.b[1]];
}
function drawUTM(ctx, W, H, s, a, accent) {
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!UTM_CACHE || UTM_CACHE.W !== W || UTM_CACHE.H !== H || UTM_CACHE.dpr !== dpr) UTM_CACHE = buildUTM(W, H);
  var U = UTM_CACHE;
  ctx.save(); ctx.globalAlpha = a;
  ctx.drawImage(U.city, 0, 0, W, H);
  // planned routes: faint dotted arcs from hub to drop — the network is the background
  ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(21,23,26,0.19)';
  for (var r = 0; r < U.flights.length; r++) {
    var FR = U.flights[r]; ctx.beginPath(); ctx.moveTo(FR.a[0], FR.a[1]); ctx.quadraticCurveTo(FR.c[0], FR.c[1], FR.b[0], FR.b[1]); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(FR.b[0], FR.b[1], 2, 0, TAU); ctx.fillStyle = 'rgba(21,23,26,0.16)'; ctx.fill(); ctx.setLineDash([1.5, 6]);
  }
  ctx.setLineDash([]);
  for (var i = 0; i < U.flights.length; i++) {
    var F = U.flights[i], d = ((s + F.off) * F.speed) % (2 * F.L), out = d < F.L, t = (out ? d : 2 * F.L - d) / F.L;
    var P = bez(F, t), tl = Math.min(80 / F.L, out ? t : 1 - t);
    var col = F.hot ? [255, 91, 31] : [21, 23, 26];
    // fading trail along the curve behind the aircraft
    ctx.lineWidth = 1.2;
    for (var k = 0; k < 8; k++) {
      var ta = out ? t - tl * (k + 1) / 8 : t + tl * (k + 1) / 8, tb = out ? t - tl * k / 8 : t + tl * k / 8;
      var A = bez(F, Math.max(0, Math.min(1, ta))), B = bez(F, Math.max(0, Math.min(1, tb)));
      ctx.strokeStyle = rgb(col, 0.3 * (1 - k / 8)); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    var N = bez(F, Math.max(0, Math.min(1, t + (out ? 0.01 : -0.01))));
    ctx.save(); ctx.translate(P[0], P[1]); ctx.rotate(Math.atan2(N[1] - P[1], N[0] - P[0]));
    ctx.fillStyle = rgb(col, 0.55); ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, 3.2); ctx.lineTo(-1.8, 0); ctx.lineTo(-3.5, -3.2); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = rgb(col, 0.4); ctx.font = '500 8px "JetBrains Mono", monospace';
    ctx.fillText(F.tag, P[0] + 8, P[1] - 6); ctx.fillText(F.alt, P[0] + 8, P[1] + 4);
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
// background traffic: two more drones cross behind the head at their own altitudes, each slinging a different payload.
// They only pass through (no drop) and loop on their own clock from page load, so the hero is alive even without scrolling.
// dur = seconds to cross the frame, period = seconds between departures, off = where in its loop each starts
var TRAFFIC = [
  { dur: 3, period: 5, off: 3.5, dir: 1, k: 0.74, a: 0.8, kind: 'tube' },    // left → right
  { dur: 3.8, period: 6.3, off: 0.6, dir: -1, k: 0.6, a: 0.66, kind: 'case' }  // right → left, farther away
];
function drawPayload(ctx, kind, accent) {
  ctx.lineWidth = 1.5; ctx.strokeStyle = rgb(KRAFT.edge);
  ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, 30); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = rgb(KRAFT.edge);
  if (kind === 'tube') {
    // a long capsule, like a medical sample tube, with an accent band
    roundRectPath(ctx, -26, 30, 52, 16, 8); ctx.fillStyle = rgb(KRAFT.front); ctx.fill(); ctx.stroke();
    ctx.fillStyle = accent; ctx.fillRect(-4, 30.8, 8, 14.4);
    ctx.beginPath(); ctx.moveTo(-18, 30); ctx.lineTo(-18, 46); ctx.moveTo(18, 30); ctx.lineTo(18, 46); ctx.stroke();
  } else {
    // a hard case with a handle
    ctx.beginPath(); ctx.moveTo(-7, 30); ctx.lineTo(-7, 26); ctx.lineTo(7, 26); ctx.lineTo(7, 30); ctx.strokeStyle = INK; ctx.stroke();
    roundRectPath(ctx, -22, 30, 44, 26, 4); ctx.fillStyle = '#5E6266'; ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
    ctx.strokeStyle = '#8A8F96'; ctx.beginPath(); ctx.moveTo(-22, 40); ctx.lineTo(22, 40); ctx.stroke();
    ctx.fillStyle = accent; ctx.fillRect(-3, 38, 6, 4);
  }
}
function drawTraffic(ctx, s, accent, P, W) {
  for (var i = 0; i < TRAFFIC.length; i++) {
    var T = TRAFFIC[i];
    var tt = s + T.off, pass = Math.floor(tt / T.period);
    var u = (tt - pass * T.period) / T.dur;                     // constant cruise speed across the frame, then a gap
    if (u >= 1) continue;
    // every pass picks a new altitude, anywhere from above the head to shoulder height
    var r = Math.sin(pass * 12.9898 + i * 78.233) * 43758.5453; r -= Math.floor(r);
    var alt = 0.06 + 0.5 * r;
    var x = T.dir > 0 ? lerp(-140, W + 140, u) : lerp(W + 140, -140, u);
    var y = P.y + alt * P.S + 2.5 * Math.sin(s * 1.3 + i * 2);
    // at this speed a crisp copy every frame strobes; two faint trailing copies read as motion blur instead
    var step = T.dir * (W + 280) / T.dur / 120;               // half a 60 Hz frame of travel
    for (var g = 2; g >= 0; g--) {
      ctx.save(); ctx.globalAlpha = T.a * (g === 0 ? 1 : g === 1 ? 0.3 : 0.12);
      ctx.translate(x - step * g, y); ctx.scale(T.k, T.k);
      ctx.save(); ctx.scale(T.dir, 1); ctx.rotate(0.14 + 0.015 * Math.sin(s * 1.7 + i)); drawPayload(ctx, T.kind, accent); ctx.restore();
      drawDrone(ctx, 0, 0, 0.14, s + i * 0.37, accent, T.dir);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
// ---- the Flatirons: Boulder's skyline as a low silhouette on the horizon (kept short so the show flies above it)
// x is 0..1 across the frame, y is 0..1 of the range's max height. Back ridge: South Boulder Peak, Bear Peak, Green
// Mountain, then Flagstaff tapering to the plains. Front: the tilted slabs, Third Flatiron the largest.
var RIDGE_BACK = [[0, 0.5], [0.035, 0.74], [0.065, 0.9], [0.085, 0.78], [0.115, 0.98], [0.14, 0.76], [0.175, 0.8], [0.215, 0.9], [0.245, 0.95],
  [0.285, 0.93], [0.33, 0.84], [0.38, 0.72], [0.43, 0.62], [0.47, 0.6], [0.52, 0.5], [0.56, 0.46], [0.6, 0.53], [0.64, 0.43], [0.7, 0.31],
  [0.78, 0.23], [0.88, 0.17], [1, 0.14]];
// far range to the north-west, hazier: the Indian Peaks rising to Mount Meeker and Longs Peak's flat summit — balances the frame
var RIDGE_FAR = [[0.56, 0], [0.62, 0.22], [0.67, 0.33], [0.71, 0.47], [0.745, 0.6], [0.77, 0.57], [0.79, 0.7], [0.805, 0.73], [0.83, 0.72],
  [0.85, 0.62], [0.88, 0.5], [0.92, 0.4], [0.96, 0.32], [1, 0.28], [1, 0]];
var MTN_FAR = [[0.06, [178, 152, 168]], [0.2, [152, 114, 132]], [0.32, [98, 74, 100]], [0.45, [40, 36, 54]], [0.6, [14, 16, 25]]];
// slabs south → north: [left base, right base, tip x, tip height] — long south face, steep north edge, like an iron on its heel
var SLABS = [[0.07, 0.158, 0.143, 0.56], [0.138, 0.236, 0.218, 0.72], [0.2, 0.334, 0.307, 0.93], [0.298, 0.402, 0.383, 0.79], [0.372, 0.468, 0.449, 0.65]];
var MTN_SLAB = [[0.06, [178, 146, 154]], [0.2, [156, 110, 118]], [0.32, [108, 74, 92]], [0.45, [58, 50, 68]], [0.6, [34, 36, 50]]];
var MTN_BACK = [[0.06, [150, 128, 146]], [0.2, [122, 92, 112]], [0.32, [72, 54, 78]], [0.45, [28, 26, 40]], [0.6, [11, 13, 19]]];
var MTN_FRONT = [[0.06, [118, 100, 120]], [0.2, [90, 64, 84]], [0.32, [44, 33, 50]], [0.45, [19, 19, 29]], [0.6, [9, 11, 16]]];
function drawFlatirons(ctx, C, hl, p, rimCol) {
  var a = smooth(0.06, 0.16, p);
  if (a < 0.01) return;
  var mh = Math.min(C.h * 0.12, 120), X = function (u) { return C.x + u * C.w; }, Y = function (v) { return hl - v * mh; };
  ctx.save(); ctx.globalAlpha = a;
  // far peaks
  ctx.fillStyle = rgb(keyed(MTN_FAR, p).map(Math.round));
  ctx.beginPath(); ctx.moveTo(X(RIDGE_FAR[0][0]), hl + 1);
  for (var f = 0; f < RIDGE_FAR.length; f++) ctx.lineTo(X(RIDGE_FAR[f][0]), Y(RIDGE_FAR[f][1]));
  ctx.closePath(); ctx.fill();
  // back ridge
  ctx.fillStyle = rgb(keyed(MTN_BACK, p).map(Math.round));
  ctx.beginPath(); ctx.moveTo(X(0), hl + 1);
  for (var i = 0; i < RIDGE_BACK.length; i++) ctx.lineTo(X(RIDGE_BACK[i][0]), Y(RIDGE_BACK[i][1]));
  ctx.lineTo(X(1), hl + 1); ctx.closePath(); ctx.fill();
  // the slabs, leaning slightly north, and the forested foothills they rise from
  // the rock faces catch a little more light than the ridge behind, so the slabs read as slabs, not more mountain
  var front = rgb(keyed(MTN_FRONT, p).map(Math.round)), slab = keyed(MTN_SLAB, p).map(Math.round);
  for (i = 0; i < SLABS.length; i++) {
    var S = SLABS[i], g = ctx.createLinearGradient(0, Y(S[3]), 0, hl);
    g.addColorStop(0, rgb(slab)); g.addColorStop(1, front);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(X(S[0]), hl + 1); ctx.lineTo(X(S[2]), Y(S[3])); ctx.lineTo(X(S[1]), hl + 1); ctx.closePath(); ctx.fill();
    // the shadowed north edge
    ctx.fillStyle = front; ctx.beginPath(); ctx.moveTo(X(S[2]), Y(S[3])); ctx.lineTo(X(S[1]), hl + 1); ctx.lineTo(X(S[2] + (S[1] - S[2]) * 0.1), hl + 1); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = front;
  ctx.beginPath(); ctx.moveTo(X(0), hl + 1);
  for (var u = 0; u <= 1.0001; u += 0.01) {
    var hill = 0.17 + 0.06 * Math.sin(u * 11 + 1.3) + 0.03 * Math.sin(u * 37) - 0.13 * smooth(0.45, 0.85, u);
    ctx.lineTo(X(u), Y(Math.max(0.03, hill) + 0.012 * Math.sin(u * 230)));   // a fine tree-line texture
  }
  ctx.lineTo(X(1), hl + 1); ctx.closePath(); ctx.fill();
  // sunset rim light along the slab tops while the sun is still up
  var rim = smooth(0.1, 0.2, p) * (1 - smooth(0.36, 0.46, p));
  if (rim > 0.01) {
    ctx.strokeStyle = rgb(rimCol, 0.55 * rim); ctx.lineWidth = 1.2; ctx.beginPath();
    for (i = 0; i < SLABS.length; i++) { S = SLABS[i]; ctx.moveTo(X(S[2]), Y(S[3])); ctx.lineTo(X(S[2] + (S[1] - S[2]) * 0.45), Y(S[3] * 0.55)); }
    ctx.stroke();
  }
  ctx.restore();
}
// line-art quadcopter, side view; dir = -1 faces left; tilt in radians (positive = nose down in the direction of travel)
function drawDrone(ctx, x, y, tilt, s, accent, dir) {
  var A0 = ctx.globalAlpha;   // respect the caller's opacity (used for distance and motion-blur copies)
  ctx.save(); ctx.translate(x, y); ctx.scale(dir || 1, 1); ctx.rotate(tilt);
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.fillStyle = '#F2F1ED';
  // arms and motor pods
  ctx.beginPath(); ctx.moveTo(-22, -3); ctx.lineTo(-44, -9); ctx.moveTo(22, -3); ctx.lineTo(44, -9); ctx.stroke();
  [-44, 44].forEach(function (mx) { ctx.fillStyle = INK; ctx.fillRect(mx - 4, -15, 8, 9); });
  // spinning rotors: a blurred disc plus one blade at its current angle
  [-44, 44].forEach(function (mx, i) {
    ctx.globalAlpha = A0 * 0.28; ctx.beginPath(); ctx.ellipse(mx, -17, 21, 2.6, 0, 0, TAU); ctx.fillStyle = INK; ctx.fill();
    ctx.globalAlpha = A0 * 0.9; var bl = 21 * Math.cos(s * 47 + i * 1.7);
    ctx.beginPath(); ctx.moveTo(mx - bl, -17); ctx.lineTo(mx + bl, -17); ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = A0;
  });
  // body
  roundRectPath(ctx, -26, -10, 52, 19, 9); ctx.fillStyle = '#F2F1ED'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(-10, -15); ctx.lineTo(10, -15); ctx.lineTo(14, -10); ctx.stroke();
  // landing legs and winch
  ctx.beginPath(); ctx.moveTo(-12, 9); ctx.lineTo(-19, 21); ctx.moveTo(-24, 21); ctx.lineTo(-14, 21);
  ctx.moveTo(12, 9); ctx.lineTo(19, 21); ctx.moveTo(14, 21); ctx.lineTo(24, 21); ctx.stroke();
  ctx.fillStyle = INK; ctx.fillRect(-5, 9, 10, 6);
  // nav light
  ctx.globalAlpha = A0 * (0.5 + 0.5 * Math.sin(s * 9)); ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(24, -2, 2.6, 0, TAU); ctx.fill(); ctx.globalAlpha = A0;
  ctx.restore();
}
// the kraft box: front face, lid and side in a light isometric, with a tape stripe in the accent colour.
// flap 0..1 opens the lid flaps; morph 0..1 flattens the front face into the card's exact rectangle.
function drawBox(ctx, bx, by, flap, morph, card, accent) {
  var w = BOX_W, h = BOX_H, dx = BOX_DX, dy = BOX_DY;
  var fx = lerp(bx, card.x, ease(morph)), fy = lerp(by, card.y, ease(morph));
  var fw = lerp(w, card.w, ease(morph)), fh = lerp(h, card.h, ease(morph));
  var solid = 1 - smooth(0.0, 0.6, morph);
  var tw = Math.max(2.5, w * 0.08);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.5;
  if (solid > 0.01) {
    ctx.globalAlpha = solid;
    // side face
    ctx.beginPath(); ctx.moveTo(bx + w, by); ctx.lineTo(bx + w + dx, by - dy); ctx.lineTo(bx + w + dx, by + h - dy); ctx.lineTo(bx + w, by + h); ctx.closePath();
    ctx.fillStyle = rgb(KRAFT.side); ctx.fill(); ctx.strokeStyle = rgb(KRAFT.edge); ctx.stroke();
    var ef = ease(flap);
    // back flap stands up and leans back
    var bTip = by - dy - ef * h * 0.5;
    ctx.beginPath(); ctx.moveTo(bx + dx, by - dy); ctx.lineTo(bx + w + dx, by - dy); ctx.lineTo(bx + w + dx + ef * 4, bTip); ctx.lineTo(bx + dx + ef * 4, bTip); ctx.closePath();
    ctx.fillStyle = rgb(KRAFT.top); ctx.fill(); ctx.stroke();
    if (ef < 0.05) {
      // closed lid with tape
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dx, by - dy); ctx.lineTo(bx + w + dx, by - dy); ctx.lineTo(bx + w, by); ctx.closePath();
      ctx.fillStyle = rgb(KRAFT.top); ctx.fill(); ctx.stroke();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(bx + w / 2 - tw, by); ctx.lineTo(bx + w / 2 - tw + dx, by - dy); ctx.lineTo(bx + w / 2 + tw + dx, by - dy); ctx.lineTo(bx + w / 2 + tw, by); ctx.closePath(); ctx.fill();
    }
  }
  // front face → card
  ctx.globalAlpha = 1;
  var fill = mixRGB(KRAFT.front, [10, 102, 194], ease(morph));   // unfolds into the LinkedIn tile
  var edge = mixRGB(KRAFT.edge, [10, 102, 194], ease(morph));
  roundRectPath(ctx, fx, fy, fw, fh, lerp(1, 9, ease(morph)));
  ctx.fillStyle = rgb(fill); ctx.fill(); ctx.strokeStyle = rgb(edge); ctx.lineWidth = lerp(1.5, 1, morph); ctx.stroke();
  if (solid > 0.01) {
    ctx.globalAlpha = solid;
    ctx.fillStyle = accent; ctx.fillRect(fx + fw / 2 - tw, fy, 2 * tw, Math.min(h * 0.3, fh * 0.3));
    // front flap swings forward and down over the face as the box opens
    var ef2 = ease(flap);
    if (ef2 >= 0.05) {
      var tipY = by + lerp(-dy, h * 0.42, ef2), tipX = lerp(dx, -2, ef2);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + w, by); ctx.lineTo(bx + w + tipX, tipY); ctx.lineTo(bx + tipX, tipY); ctx.closePath();
      ctx.fillStyle = rgb(KRAFT.top); ctx.fill(); ctx.strokeStyle = rgb(KRAFT.edge); ctx.stroke();
    }
  }
  ctx.restore();
}

// ================= Night show: scroll scrubs a separation-scheduled launch into the crisp name =================
// Formation: BRENT in the accent orange over ELIASON in cool white, every drone on a square grid like real show
// lettering. A real 3D object: a full front face plus two recessed outline layers that form the extruded sides.
// Seen from slightly below, it reveals with the left side nearer, then scroll turns it so the right side comes forward.
var NAME_URL = BASE + 'formation.json';
var NAME_ASPECT = 2.7647, NAME_SPACING = 0.00993;
var POSE_PITCH = 0.17, YAW_IN = 0.22, YAW_OUT = -0.22;
function poseProject(X, Y, Z, yaw, F, pitch) {
  if (pitch == null) pitch = POSE_PITCH;
  var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  var X1 = X * cy + Z * sy, Z1 = -X * sy + Z * cy;
  var Y2 = Y * cp - Z1 * sp, Z2 = Y * sp + Z1 * cp;
  var k = F / (F - Z2);
  return { x: X1 * k, y: Y2 * k, k: k };
}
var ROWS = 12, PAD_SPACING = 0.5, SEP = 1.3, SPEED = 6, ACCEL_T = 0.6, LAUNCH_RATE = 320, HORIZON = 0.84;
var FIELD = { cx: 0.5, half: 0.43 };
var SKY = { day: [242, 241, 237], duskTop: [62, 70, 108], duskHor: [232, 168, 118], nightTop: [9, 12, 18], nightHor: [24, 28, 42] };
var LIGHT = [255, 244, 232];
function buildPlan(pts) {
  var cols = Math.ceil(pts.length / ROWS);
  var byX = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var plan = [];
  for (var c = 0; c < cols; c++) {
    var chunk = byX.slice(c * ROWS, c * ROWS + ROWS).sort(function (a, b) { return a[1] - b[1]; });
    for (var r = 0; r < chunk.length; r++) {
      var q = chunk[r], i = c * ROWS + r;
      plan.push({ ci: c, ri: r, col: c / Math.max(1, cols - 1), depth: r / (ROWS - 1), tx: q[0], ty: q[1],
        rgb: q.length >= 5 ? [q[2], q[3], q[4]] : LIGHT, tz: q[5] || 0,
        climb: ((i * 53) % 17) / 17, ph: (i * 2.399) % TAU });
    }
  }
  plan.cols = cols;
  return plan;
}
function fieldPt(colFrac, depth, w, h) {
  var half = FIELD.half * (0.93 + 0.14 * depth);
  return { x: w * (FIELD.cx + (colFrac - 0.5) * 2 * half), y: h * (HORIZON + 0.022 * depth), s: 0.8 + 0.3 * depth };
}
function timeToAlt(a, v) { var acc = 0.5 * v * ACCEL_T; return a <= acc ? Math.sqrt(2 * a * ACCEL_T / v) : ACCEL_T + (a - acc) / v; }
// a pad may lift only once every neighbour within SEP that launched earlier has climbed sqrt(SEP² − d²);
// longest flights are scheduled first, each at the earliest legal moment, with a capped release rate
function scheduleLaunches(plan, lengths) {
  var R = Math.floor(SEP / PAD_SPACING + 1e-6), offs = [];
  for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
    if (!dx && !dy) continue;
    var d = Math.sqrt(dx * dx + dy * dy) * PAD_SPACING;
    if (d < SEP) offs.push({ dx: dx, dy: dy, wait: timeToAlt(Math.sqrt(SEP * SEP - d * d), SPEED) });
  }
  var grid = {}, i;
  for (i = 0; i < plan.length; i++) grid[plan[i].ci + ',' + plan[i].ri] = i;
  var order = plan.map(function (_, k) { return k; });
  order.sort(function (a, b) { return (lengths[b] - lengths[a]) || (((a * 7919) % 104729) - ((b * 7919) % 104729)); });
  var times = new Array(plan.length);
  for (var n = 0; n < order.length; n++) {
    var idx = order[n], p = plan[idx], iv = [];
    for (var o = 0; o < offs.length; o++) {
      var j = grid[(p.ci + offs[o].dx) + ',' + (p.ri + offs[o].dy)];
      if (j !== undefined && times[j] !== undefined) iv.push([times[j] - offs[o].wait, times[j] + offs[o].wait]);
    }
    iv.sort(function (a, b) { return a[0] - b[0]; });
    var t = n / LAUNCH_RATE;
    for (var q = 0; q < iv.length; q++) { if (iv[q][1] <= t) continue; if (iv[q][0] >= t) break; t = iv[q][1]; }
    for (var g = 0; g < 4; g++) { var moved = false; for (q = 0; q < iv.length; q++) if (iv[q][0] < t && iv[q][1] > t) { t = iv[q][1]; moved = true; } if (!moved) break; }
    times[idx] = t;
  }
  return times;
}
function profile(L, v) {
  if (L >= v * ACCEL_T) return { L: L, v: v, ta: ACCEL_T, T: L / v + ACCEL_T };
  var vp = Math.sqrt(L * v / ACCEL_T), ta = vp * ACCEL_T / v; return { L: L, v: vp, ta: ta, T: 2 * ta };
}
function distAt(pf, tau) {
  if (tau <= 0) return 0; if (tau >= pf.T) return pf.L;
  var a = pf.v / pf.ta;
  if (tau < pf.ta) return 0.5 * a * tau * tau;
  if (tau > pf.T - pf.ta) { var r = pf.T - tau; return pf.L - 0.5 * a * r * r; }
  return 0.5 * pf.v * pf.ta + pf.v * (tau - pf.ta);
}


// ================= Transition: follow the Starlink train up into orbit, then drop onto the career map =================
// q 0–0.34 the camera tilts up (the world falls away below) · 0.28–0.56 Earth's limb rises with city lights ·
// 0.56–0.8 the view dives toward the surface · 0.72–1 a dot map of the US resolves and the sites light up in order
var DELIVERY_PX = 1600, STAGE_SHOW = 5400, TRANS_PX = 3400, STORY_PX = 4600, HANGAR_PX = 3600, SPACE = [4, 6, 10];
var US_POLY = [-124.7,48.4,-122.8,49.0,-95.2,49.0,-94.8,49.4,-89.6,48.0,-84.8,46.5,-82.5,45.3,-82.4,43.0,-79.0,43.3,-76.5,44.2,-75.0,45.0,-71.5,45.0,-70.0,46.7,-67.8,47.1,-67.0,44.8,-70.0,43.7,-70.6,42.0,-71.9,41.3,-74.0,40.6,-74.4,39.4,-75.5,38.5,-76.0,37.0,-75.5,35.3,-76.5,34.7,-78.5,33.8,-80.8,32.0,-81.4,30.7,-80.0,26.8,-80.4,25.2,-81.8,26.0,-82.8,28.0,-82.6,29.8,-84.0,30.1,-86.0,30.4,-88.0,30.4,-89.6,30.2,-89.4,29.0,-91.0,29.3,-93.8,29.7,-95.0,29.2,-97.2,27.6,-97.4,26.0,-99.1,26.4,-100.6,29.0,-101.4,29.8,-102.4,29.8,-103.3,29.0,-104.5,29.6,-106.5,31.8,-108.2,31.8,-108.2,31.3,-111.1,31.3,-114.8,32.5,-117.1,32.5,-118.5,34.0,-120.6,34.6,-121.9,36.6,-122.5,37.8,-123.8,39.8,-124.4,42.0,-124.1,46.2];
var US_LAT0 = Math.cos(39 * Math.PI / 180), US_W = 60 * US_LAT0, US_H = 26;
function usXY(lon, lat) { return [(lon + 125.5) * US_LAT0, 49.8 - lat]; }
var US_DOTS = null;
function usDots() {
  if (US_DOTS) return US_DOTS;
  var P = [], i, n = US_POLY.length / 2;
  for (i = 0; i < n; i++) P.push(usXY(US_POLY[2 * i], US_POLY[2 * i + 1]));
  function inside(x, y) { var c = false; for (var a = 0, b = n - 1; a < n; b = a++) { if ((P[a][1] > y) !== (P[b][1] > y) && x < (P[b][0] - P[a][0]) * (y - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) c = !c; } return c; }
  var st = 0.62, out = [];
  for (var y = st / 2, r = 0; y < US_H; y += st * 0.866, r++) for (var x = (r % 2 ? st / 2 : 0) + st / 2; x < US_W; x += st) if (inside(x, y)) out.push([x, y, (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1]);
  US_DOTS = out; return out;
}
var SITES = [
  { lon: -97.03, lat: 47.93, city: 'GRAND FORKS, ND', role: 'Northern Plains UAS Test Site', side: 1 },
  { lon: -96.80, lat: 32.78, city: 'DALLAS–FORT WORTH, TX', role: 'Flytrex · drone delivery sites', side: 1 },
  { lon: -105.27, lat: 40.02, city: 'BOULDER, CO', role: 'Classified', side: -1 }
];
var SPACE_STARS = [];
for (var _k = 0; _k < 420; _k++) { var _a = Math.sin(_k * 91.17) * 24634.63, _b = Math.sin(_k * 47.31) * 51872.11; SPACE_STARS.push({ x: _a - Math.floor(_a), y: _b - Math.floor(_b), r: 0.3 + (_k % 9) / 10, ph: _k * 2.3 }); }
// Earth at night: real coastlines (Natural Earth 50m) and city lights placed and sized from city populations
var EARTH_URL = BASE + 'earth.json';
function prepEarth(d) {
  var D2R = Math.PI / 180, land = [], i, k;
  for (i = 0; i < d.land.length; i++) {
    var r = d.land[i], n = r.length / 2, lo = new Float32Array(n), la = new Float32Array(n);
    for (k = 0; k < n; k++) { lo[k] = r[2 * k] * D2R; la[k] = r[2 * k + 1] * D2R; }
    land.push({ lo: lo, la: la });
  }
  var m = d.lights.length / 3, L = { lo: new Float32Array(m), la: new Float32Array(m), b: new Float32Array(m), us: new Uint8Array(m), n: m };
  var P = [], np = US_POLY.length / 2;
  for (i = 0; i < np; i++) P.push(usXY(US_POLY[2 * i], US_POLY[2 * i + 1]));
  for (k = 0; k < m; k++) {
    L.lo[k] = d.lights[3 * k] * D2R; L.la[k] = d.lights[3 * k + 1] * D2R; L.b[k] = d.lights[3 * k + 2];
    var q = usXY(d.lights[3 * k], d.lights[3 * k + 1]), c = false;
    for (var a = 0, b = np - 1; a < np; b = a++) if ((P[a][1] > q[1]) !== (P[b][1] > q[1]) && q[0] < (P[b][0] - P[a][0]) * (q[1] - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) c = !c;
    L.us[k] = c ? 1 : 0;
  }
  var lakes = (d.lakes || []).map(function (r) { var o = new Float32Array(r.length); for (var t = 0; t < r.length; t++) o[t] = r[t] * D2R; return o; });
  return { land: land, lights: L, lakes: lakes };
}
// where the flat map sits; the globe's dive ends exactly on this frame so the hand-off is a crossfade, not a cut
function mapFrame(W, H) {
  var mw = Math.min(W * 0.8, H * 0.66 * US_W / US_H), sc = mw / US_W;
  return { sc: sc, ox: W / 2 - US_W * sc / 2, oy: H * 0.54 - US_H * sc / 2 };
}
var MAP_LON = -125.5 + US_W / 2 / US_LAT0, MAP_LAT = 49.8 - US_H / 2;
// Great Lakes fallback outline (the real lake shapes ship in the earth data), drawn in the sea colour over the land
var LAKES = [
  [-92.1,46.7,-91.0,46.9,-90.4,46.6,-89.6,46.85,-88.4,46.9,-87.6,46.5,-86.6,46.45,-85.0,46.75,-84.6,46.5,-84.5,46.9,-84.8,47.5,-85.6,47.95,-86.5,48.75,-88.3,48.95,-89.3,48.1,-90.0,47.95,-91.5,47.3],
  [-87.8,41.65,-87.2,41.65,-86.6,42.0,-86.2,42.8,-86.3,43.7,-86.5,44.5,-86.0,45.2,-85.4,45.4,-85.0,45.75,-85.6,45.95,-86.5,45.8,-87.0,45.7,-87.6,45.1,-87.8,44.6,-87.5,44.0,-87.9,43.2,-87.85,42.4],
  [-84.6,45.8,-83.5,45.95,-82.0,46.1,-81.2,45.95,-80.6,45.9,-80.0,45.3,-80.2,44.7,-80.9,44.95,-81.3,44.4,-81.7,43.5,-82.4,43.0,-82.6,43.6,-83.5,43.95,-83.4,44.4,-83.3,44.95,-84.2,45.4],
  [-83.45,41.7,-82.7,41.45,-81.7,41.5,-80.5,41.95,-79.1,42.6,-78.9,42.9,-79.8,42.85,-80.6,42.6,-81.5,42.65,-82.5,42.0,-83.1,42.05],
  [-79.8,43.25,-79.0,43.3,-77.8,43.35,-76.3,43.5,-76.2,44.1,-77.0,44.05,-78.5,43.95,-79.4,43.65],
  [-97.2,50.4,-96.3,50.6,-96.4,51.6,-97.5,52.6,-98.6,53.6,-99.2,53.4,-98.2,52.3,-97.6,51.3]
];
// ---- flight log: scrolling through the map, each career stop pops up where it happened, led by its headline result
var STORIES = [
  { lon: -92.10, lat: 46.79, z: 3.2, place: 'DULUTH, MN', org: 'University of Minnesota', stat: '2010', statLabel: 'FIRST AUTOPILOT INTEGRATION', text: 'Integrated an autopilot into an aircraft as a senior design project, the start of fifteen years in autonomy.', tags: ['AUTOPILOT', 'SYSTEMS INTEGRATION'] },
  { lon: -92.10, lat: 46.72, z: 3.2, place: 'SUPERIOR, WI', org: 'EASE Drones', stat: 'REMOTE SENSING', statLabel: 'PIPELINE RIGHT-OF-WAY INSPECTION', text: 'Flew autonomous aircraft to inspect pipeline right-of-way from the air.', tags: ['INSPECTION', 'AUTONOMOUS AIRCRAFT'] },
  { lon: -97.03, lat: 47.93, z: 2.6, place: 'GRAND FORKS, ND', org: 'Northern Plains UAS Test Site', stat: 'FAA', statLabel: 'DESIGNATED UAS TEST SITE', text: 'Integrated drones into the national airspace at one of the FAA’s designated test sites.', tags: ['AIRSPACE INTEGRATION', 'FAA'] },
  { lon: -97.40, lat: 47.95, z: 2.6, place: 'GRAND FORKS AFB, ND', org: 'EASE Drones · NASA · DOD', stat: 'UTM', statLabel: 'NASA AND DOD RESEARCH CONTRACTS', text: 'Drone swarm testing on NASA and DOD research that fed the development of unmanned traffic management.', tags: ['UTM', 'SWARM TESTING', 'RESEARCH'] },
  { lon: -97.03, lat: 47.92, z: 2.6, place: 'GRAND FORKS, ND', org: 'Flytrex', stat: '1ST', statLabel: 'COMMERCIAL DRONE DELIVERY OPERATION IN THE US', text: 'Launched the first commercial drone delivery operation in the United States.', tags: ['DRONE DELIVERY', 'LAUNCH'] },
  { lon: -78.64, lat: 35.78, z: 2.0, place: 'RALEIGH, NC', org: 'Flytrex', stat: '0–1', statLabel: 'BUILT THE BASE FOR SCALING DRONE DELIVERY', text: 'Built the operational foundation that took drone delivery from zero to scale across the Research Triangle and its suburbs.', tags: ['0 TO 1', 'SCALING', 'DRONE DELIVERY'] },
  { lon: -96.80, lat: 32.78, z: 2.0, place: 'DALLAS, TX', org: 'Flytrex', role: 'Head of Flight Operations & Site Deployments', stat: 'BVLOS', statLabel: 'FAA-APPROVED REMOTE OPERATIONS', text: 'Scaled delivery across the DFW metro and owned the ground infrastructure buildout for its delivery sites.', tags: ['REMOTE BVLOS', 'SITE DEPLOYMENT'] },
  { lon: -105.27, lat: 40.02, z: 1.8, place: 'BOULDER, CO', secret: true, org: 'XXXXXXX XXXXXX XXX', role: 'Xxxxxx Xxxxxxx Xxxxxxxxxx', stat: 'CLASSIFIED', statLabel: 'DECLASSIFICATION PENDING · STAND BY', text: 'Xxxxx xxx xxxxxx xxxxxxxxxx xxxxx xxx xxxxxx xxxxxx xxx xxxxx xxxxxx xxxxxxxxx.', tags: ['REDACTED', 'COMING SOON'] }
];
var LOG_TOTALS = [['15+', 'YEARS IN AUTONOMY'], ['250,000+', 'FLIGHTS OVERSEEN'], ['6', 'STATES'], ['8', 'CAREER STOPS']];
var STORY_STEPS = STORIES.length + 1;   // the last step pulls back to show the whole route
// the camera: the transition (q) brings the globe up and dives to the US; the stories (m) then fly between places
function globeView(W, H, q, m) {
  var rise = ease(smooth(0.26, 0.56, q)), dive = smooth(0.56, 0.82, q), de = ease(dive);
  var R0 = Math.min(H * 0.44, W * 0.34), F = mapFrame(W, H), R1 = F.sc * 180 / Math.PI;
  var R = R0 * Math.pow(R1 / R0, de);
  var cy0 = lerp(H + R0 * 1.02, H * 0.53, rise);
  var V = { R: R, cx: W / 2, cy: lerp(cy0, H * 0.54, de), lon: lerp(-93, MAP_LON, de), lat: lerp(17, MAP_LAT, de), dive: dive, z: 1 };
  if (m > 0) {
    var f = m * STORY_STEPS, i = Math.min(STORY_STEPS - 1, Math.floor(f)), t = ease(smooth(0, 0.4, f - i));
    var cam = function (k) {
      if (k < 0 || k >= STORIES.length) return { lon: MAP_LON, lat: MAP_LAT, z: 1, x: W / 2 };
      var S = STORIES[k]; return { lon: S.lon, lat: S.lat, z: S.z, x: W * (W > 900 ? 0.62 : 0.5) };
    };
    var a = cam(i - 1), b = cam(i);
    V.lon = lerp(a.lon, b.lon, t); V.lat = lerp(a.lat, b.lat, t);
    V.z = a.z * Math.pow(b.z / a.z, t); V.R = R1 * V.z; V.cx = lerp(a.x, b.x, t); V.cy = H * 0.54;
  }
  V.lon0 = V.lon * Math.PI / 180; V.lat0 = V.lat * Math.PI / 180; V.m = m || 0;
  return V;
}
function orthoXY(G, lon, lat) {
  var D = Math.PI / 180, dl = lon * D - G.lon0, la = lat * D, cp = Math.cos(la);
  return [G.cx + G.R * cp * Math.sin(dl), G.cy - G.R * (Math.cos(G.lat0) * Math.sin(la) - Math.sin(G.lat0) * cp * Math.cos(dl))];
}
function drawSpace(ctx, W, H, q, s, earth, G) {
  var R = G.R, cx = G.cx, cy = G.cy;
  if (cy - R > H) return;
  var sl0 = Math.sin(G.lat0), cl0 = Math.cos(G.lat0);
  var night = smooth(0.6, 0.82, q);           // as we dive, the sea goes to black and only the land stays blue
  var halo = 1 - night;
  ctx.save();
  if (halo > 0.01) {
    var ag = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.08);
    ag.addColorStop(0, 'rgba(120,170,255,' + (0.35 * halo) + ')'); ag.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, TAU); ctx.fill();
  }
  var sea = mixRGB([8, 17, 38], SPACE, night), sea2 = mixRGB([14, 26, 51], SPACE, night);
  var og = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
  og.addColorStop(0, rgb(sea2)); og.addColorStop(0.75, rgb(sea)); og.addColorStop(1, rgb(mixRGB([10, 20, 48], SPACE, night)));
  ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  if (earth) {
    var proj = function (lo, la) {
      var dl = lo - G.lon0, cp = Math.cos(la), x = cp * Math.sin(dl), y = cl0 * Math.sin(la) - sl0 * cp * Math.cos(dl);
      if (sl0 * Math.sin(la) + cl0 * cp * Math.cos(dl) < 0) { var nn = Math.sqrt(x * x + y * y) || 1; x /= nn; y /= nn; }
      return [cx + R * x, cy - R * y];
    };
    // land is night-blue on the globe and turns dark graphite during the dive, in step with the sea going black
    ctx.fillStyle = rgb(mixRGB([22, 35, 63], [30, 32, 36], night)); ctx.beginPath();
    for (var i = 0; i < earth.land.length; i++) {
      var ring = earth.land[i];
      for (var k = 0; k < ring.lo.length; k++) { var pp = proj(ring.lo[k], ring.la[k]); if (k === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]); }
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = rgb(sea); ctx.beginPath();
    var D2R = Math.PI / 180;
    var lakes = earth.lakes && earth.lakes.length ? earth.lakes : LAKES.map(function (r) { return r.map(function (v) { return v * D2R; }); });
    for (i = 0; i < lakes.length; i++) {
      var Lk = lakes[i];
      for (k = 0; k < Lk.length; k += 2) { pp = proj(Lk[k], Lk[k + 1]); if (k === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]); }
      ctx.closePath();
    }
    ctx.fill();
    // city lights: warm points, brightest where the population is
    var Lt = earth.lights, sz = Math.min(2.4, 0.55 * Math.pow(R / (H * 0.44), 0.35));
    var la = smooth(0.3, 0.5, q) * (G.z > 1 ? 0.85 : 1);
    ctx.globalCompositeOperation = 'lighter';
    for (var j = 0; j < Lt.n; j++) {
      var dl2 = Lt.lo[j] - G.lon0, cp2 = Math.cos(Lt.la[j]), sp2 = Math.sin(Lt.la[j]);
      var cc2 = sl0 * sp2 + cl0 * cp2 * Math.cos(dl2);
      if (cc2 <= 0.02) continue;
      var X = cx + R * cp2 * Math.sin(dl2), Y = cy - R * (cl0 * sp2 - sl0 * cp2 * Math.cos(dl2));
      if (X < -4 || X > W + 4 || Y < -4 || Y > H + 4) continue;
      var bb = Lt.b[j] * la * Math.min(1, cc2 * 3);
      ctx.globalAlpha = bb * 0.22; ctx.fillStyle = '#FFB347';
      ctx.beginPath(); ctx.arc(X, Y, sz * (1.8 + 2.2 * Lt.b[j]), 0, TAU); ctx.fill();
      ctx.globalAlpha = bb; ctx.fillStyle = '#FFE2A8';
      ctx.beginPath(); ctx.arc(X, Y, sz * (0.5 + 0.7 * Lt.b[j]), 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  if (halo > 0.01) {
    ctx.globalAlpha = halo;
    var sh = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    sh.addColorStop(0, 'rgba(2,4,10,0.55)'); sh.addColorStop(0.45, 'rgba(2,4,10,0)'); sh.addColorStop(1, 'rgba(2,4,10,0)');
    ctx.fillStyle = sh; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
  ctx.restore();
  if (halo > 0.01) {
    ctx.globalAlpha = halo; ctx.lineWidth = Math.max(1.5, R * 0.012);
    var rg = ctx.createLinearGradient(cx, cy - R, cx + R, cy);
    rg.addColorStop(0, 'rgba(200,220,255,0.15)'); rg.addColorStop(0.6, 'rgba(225,235,255,0.85)'); rg.addColorStop(1, 'rgba(200,220,255,0.6)');
    ctx.strokeStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, R - ctx.lineWidth / 2, -Math.PI * 0.42, Math.PI * 0.38); ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function wrapLines(ctx, text, maxW) {
  var words = text.split(' '), lines = [], line = '';
  for (var i = 0; i < words.length; i++) { var t = line ? line + ' ' + words[i] : words[i]; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = words[i]; } else line = t; }
  if (line) lines.push(line); return lines;
}
// the story card: headline result first, then what was done, then skill tags. layout is measured once, then drawn
function storyCard(f, S, idx, cw, accent) {
  var iw = cw - 44, ops = [], y = 22;
  // classified stops: the real text is never shipped; placeholder text is drawn as a soft blur (multi-pass, works without ctx.filter)
  var B = !S.secret ? function (fn) { return fn; } : function (fn) {
    return function (x, y0) {
      var a0 = f.globalAlpha; f.save();
      for (var dx = -6; dx <= 6; dx += 2) for (var dy = -4; dy <= 4; dy += 2) { f.globalAlpha = a0 * 0.045; fn(x + dx, y0 + dy); }
      f.restore();
    };
  };
  ops.push(function (x, y0) { f.fillStyle = accent; f.fillRect(x + 22, y0 + 22, 22, 3); });
  y += 26;
  (function (yy) { ops.push(function (x, y0) { f.fillStyle = '#9AA5AF'; f.font = '500 11px "JetBrains Mono", monospace'; f.fillText((idx < 9 ? '0' : '') + (idx + 1) + ' / 0' + STORIES.length + '   ' + S.place, x + 22, y0 + yy); }); })(y);
  f.font = '800 30px "Big Shoulders Display", sans-serif';
  var ofs = 30, ow = f.measureText(S.org.toUpperCase()).width; if (ow > iw) ofs = Math.floor(30 * iw / ow);
  y += 36;
  (function (yy) { ops.push(B(function (x, y0) { f.fillStyle = '#EDEEE9'; f.font = '800 ' + ofs + 'px "Big Shoulders Display", sans-serif'; f.fillText(S.org.toUpperCase(), x + 22, y0 + yy); })); })(y);
  if (S.role) { y += 22; (function (yy) { ops.push(B(function (x, y0) { f.fillStyle = '#9AA5AF'; f.font = '400 13px Inter, system-ui, sans-serif'; f.fillText(S.role, x + 22, y0 + yy); })); })(y); }
  if (S.stat) {
    f.font = '900 58px "Big Shoulders Display", sans-serif';
    var sfs = 58, sw = f.measureText(S.stat).width; if (sw > iw) sfs = Math.floor(58 * iw / sw);
    y += 18 + sfs * 0.86;
    (function (yy) { ops.push(function (x, y0) { f.fillStyle = accent; f.font = '900 ' + sfs + 'px "Big Shoulders Display", sans-serif'; f.fillText(S.stat, x + 20, y0 + yy); }); })(y);
    f.font = '500 11px "JetBrains Mono", monospace';
    var sl = wrapLines(f, S.statLabel, iw);
    sl.forEach(function (line) { y += 17; (function (yy, t) { ops.push(function (x, y0) { f.fillStyle = '#EDEEE9'; f.font = '500 11px "JetBrains Mono", monospace'; f.fillText(t, x + 22, y0 + yy); }); })(y, line); });
  }
  y += 18;
  (function (yy) { ops.push(function (x, y0) { f.fillStyle = 'rgba(237,238,233,0.12)'; f.fillRect(x + 22, y0 + yy, iw, 1); }); })(y);
  f.font = '400 15px Inter, system-ui, sans-serif';
  var lines = wrapLines(f, S.text, iw); y += 4;
  lines.forEach(function (line) { y += 22; (function (yy, t) { ops.push(B(function (x, y0) { f.fillStyle = '#C9CFD4'; f.font = '400 15px Inter, system-ui, sans-serif'; f.fillText(t, x + 22, y0 + yy); })); })(y, line); });
  if (S.tags && S.tags.length) {
    f.font = '500 10px "JetBrains Mono", monospace';
    var tx = 0, ty = y + 16, rowH = 22;
    S.tags.forEach(function (tag) {
      var w = f.measureText(tag).width + 18;
      if (tx > 0 && tx + w > iw) { tx = 0; ty += rowH + 6; }
      (function (cx, cy, t, ww) { ops.push(function (x, y0) {
        f.strokeStyle = 'rgba(237,238,233,0.22)'; f.lineWidth = 1; roundRectPath(f, x + 22 + cx + 0.5, y0 + cy + 0.5, ww, rowH, 11); f.stroke();
        f.fillStyle = '#C9CFD4'; f.font = '500 10px "JetBrains Mono", monospace'; f.fillText(t, x + 22 + cx + 9, y0 + cy + 15);
      }); })(tx, ty, tag, w);
      tx += w + 6;
    });
    y = ty + rowH;
  }
  if (S.secret) ops.push(function (x, y0) {   // the stamp, slapped across the top right
    f.save(); f.translate(x + cw - 92, y0 + 58); f.rotate(-0.16);
    f.strokeStyle = '#FF3B30'; f.fillStyle = '#FF3B30'; f.lineWidth = 3;
    f.font = '900 26px "Big Shoulders Display", Impact, sans-serif'; f.textAlign = 'center';
    var sw2 = f.measureText('TOP SECRET').width + 26;
    f.globalAlpha *= 0.9; f.strokeRect(-sw2 / 2, -22, sw2, 40); f.lineWidth = 1; f.strokeRect(-sw2 / 2 + 4, -18, sw2 - 8, 32);
    f.fillText('TOP SECRET', 0, 7); f.textAlign = 'left'; f.restore();
  });
  return { h: y + 22, draw: function (x, y0) { for (var i = 0; i < ops.length; i++) ops[i](x, y0); } };
}
// the flight log header, career totals, route, markers and the story card for the current place
function drawStories(f, W, H, q, m, s, accent, G) {
  var ta = smooth(0.82, 0.9, q);
  var pad = Math.max(16, W * 0.03);
  var fs = m * STORY_STEPS, cur = m > 0 ? Math.min(STORY_STEPS - 1, Math.floor(fs)) : -1, fr = m > 0 ? fs - cur : 0;
  var headBottom = pad + 92;
  if (ta > 0.01) {
    f.save(); f.globalAlpha = ta; f.textAlign = 'left';
    // a soft dark scrim behind the heading so it reads over bright city lights
    var sc = f.createLinearGradient(0, 0, 0, pad + 360);
    sc.addColorStop(0, 'rgba(8,10,14,0.9)'); sc.addColorStop(0.55, 'rgba(8,10,14,0.6)'); sc.addColorStop(1, 'rgba(8,10,14,0)');
    f.fillStyle = sc; f.fillRect(0, 0, W, pad + 360);
    var ls = 'letterSpacing' in f;
    // section title, big enough to read as a heading
    f.fillStyle = accent; f.font = '500 12px "JetBrains Mono", monospace'; if (ls) f.letterSpacing = '3px';
    f.fillText('FLIGHT LOG', pad, pad + 92);
    if (ls) f.letterSpacing = '0px';
    var ts = Math.round(Math.max(38, Math.min(72, W * 0.048)));
    f.fillStyle = '#EDEEE9'; f.font = '900 ' + ts + 'px "Big Shoulders Display", Impact, sans-serif';
    var tl = wrapLines(f, 'WHERE THE WORK HAPPENED', W - 2 * pad), ty = pad + 92 + 10;
    for (var i = 0; i < tl.length; i++) { ty += ts * 0.9; f.fillText(tl[i], pad, ty); }
    headBottom = ty + 18;
    // career totals: up before the first stop and again on the final overview
    var totA = cur < 0 ? 1 : cur === 0 ? 1 - smooth(0, 0.3, fr) : cur >= STORIES.length ? smooth(0.15, 0.45, fr) : 0;
    if (totA > 0.01) {
      f.globalAlpha = ta * totA;
      var cols = W < 700 ? 2 : 4, colW = Math.min(150, (W - 2 * pad) / cols), y0 = ty + 20;
      for (i = 0; i < LOG_TOTALS.length; i++) {
        var cx = pad + (i % cols) * colW, cy = y0 + Math.floor(i / cols) * 70 + (1 - totA) * 8;
        f.fillStyle = 'rgba(237,238,233,0.18)'; f.fillRect(cx, cy, colW - 18, 1);
        f.fillStyle = i === 1 ? accent : '#EDEEE9'; f.font = '800 34px "Big Shoulders Display", sans-serif'; f.fillText(LOG_TOTALS[i][0], cx, cy + 40);
        f.fillStyle = '#9AA5AF'; f.font = '500 10px "JetBrains Mono", monospace'; f.fillText(LOG_TOTALS[i][1], cx, cy + 58);
      }
      if (cur >= STORIES.length) {
        f.fillStyle = '#C9CFD4'; f.font = '500 11px "JetBrains Mono", monospace';
        f.fillText('FAA PROGRAMS: INTEGRATION PILOT PROGRAM · BEYOND', pad, y0 + Math.ceil(LOG_TOTALS.length / cols) * 70 + 18);
      }
    }
    // data credits required by the map sources (OpenStreetMap ODbL, GeoNames CC BY)
    f.globalAlpha = ta * 0.55; f.font = '400 10px "JetBrains Mono", monospace'; f.textAlign = 'right'; f.fillStyle = '#9AA5AF';
    f.fillText('MAP DATA: NATURAL EARTH · LAKES © OPENSTREETMAP CONTRIBUTORS · CITIES: GEONAMES', W - pad, H - pad * 0.6);
    f.restore(); f.globalAlpha = 1; f.textAlign = 'left';
  }
  if (m <= 0) return;
  var pts = STORIES.map(function (S) { return orthoXY(G, S.lon, S.lat); });
  var shown = Math.min(STORIES.length - 1, cur);
  // route: dotted line through every place reached so far, the newest leg drawing on as the camera flies there
  f.strokeStyle = accent; f.lineWidth = 1.5; f.setLineDash([2, 6]); f.globalAlpha = 0.75; f.beginPath();
  for (var k = 0; k <= shown; k++) {
    var P = pts[k];
    if (k === 0) { f.moveTo(P[0], P[1]); continue; }
    var Q = pts[k - 1], u = k < cur || cur >= STORIES.length ? 1 : smooth(0, 0.4, fr);
    var mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2 - Math.hypot(P[0] - Q[0], P[1] - Q[1]) * 0.18;
    for (var j = 1; j <= 20; j++) { var v = j / 20 * u; f.lineTo((1 - v) * (1 - v) * Q[0] + 2 * (1 - v) * v * mx + v * v * P[0], (1 - v) * (1 - v) * Q[1] + 2 * (1 - v) * v * my + v * v * P[1]); }
  }
  f.stroke(); f.setLineDash([]); f.globalAlpha = 1;
  // markers: visited places stay lit with a small label; the current one pulses
  var labelled = [];
  for (k = 0; k <= shown; k++) {
    var on = k === cur, A = k < cur ? 1 : smooth(0.25, 0.4, fr), Pk = pts[k];
    if (A < 0.01) continue;
    f.globalAlpha = A; f.fillStyle = accent;
    f.beginPath(); f.arc(Pk[0], Pk[1], on ? 6 : 4, 0, TAU); f.fill();
    f.globalAlpha = A * 0.25; f.beginPath(); f.arc(Pk[0], Pk[1], on ? 14 : 9, 0, TAU); f.fill();
    if (on) { var pl = (s * 0.6) % 1; f.globalAlpha = A * 0.7 * (1 - pl); f.strokeStyle = accent; f.lineWidth = 1.5; f.beginPath(); f.arc(Pk[0], Pk[1], 10 + pl * 26, 0, TAU); f.stroke(); }
    if (!on || cur >= STORIES.length) {
      var name = STORIES[k].place.replace(/ AFB/, '').split(',')[0], dup = false;
      for (var d = 0; d < labelled.length; d++) if (labelled[d][2] === name || Math.hypot(labelled[d][0] - Pk[0], labelled[d][1] - Pk[1]) < 26) dup = true;
      if (!dup) {
        labelled.push([Pk[0], Pk[1], name]);
        f.globalAlpha = A * 0.7; f.fillStyle = '#C9CFD4'; f.font = '500 10px "JetBrains Mono", monospace'; f.fillText(name, Pk[0] + 12, Pk[1] + 4);
      }
    }
  }
  f.globalAlpha = 1;
  if (cur >= STORIES.length) return;
  var S = STORIES[cur], P0 = pts[cur];
  var ca = smooth(0.35, 0.47, fr) * (1 - smooth(0.9, 1, fr));
  if (ca < 0.01) return;
  var pop = easeOut(smooth(0.35, 0.5, fr));
  var cw = Math.min(380, W - 2 * pad), side = P0[0] - 40 - cw > pad ? -1 : 1;   // cards sit to the left so the map east of each place stays clear
  var card = storyCard(f, S, cur, cw, accent), chh = card.h;
  var cx0 = side > 0 ? P0[0] + 34 : P0[0] - 34 - cw;
  var cy0 = Math.max(headBottom + 8, Math.min(H - pad - chh, P0[1] - chh * 0.35));
  f.save(); f.globalAlpha = ca; f.textAlign = 'left';
  f.translate(P0[0], P0[1]); f.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop); f.translate(-P0[0], -P0[1] + (1 - pop) * 10);
  f.strokeStyle = accent; f.lineWidth = 1; f.beginPath(); f.moveTo(P0[0] + side * 8, P0[1]); f.lineTo(side > 0 ? cx0 : cx0 + cw, Math.max(cy0 + 16, Math.min(cy0 + chh - 16, P0[1]))); f.stroke();
  f.fillStyle = 'rgba(11,14,19,0.94)'; f.strokeStyle = '#2A3542';
  roundRectPath(f, cx0, cy0, cw, chh, 12); f.fill(); f.stroke();
  card.draw(cx0, cy0);
  f.restore(); f.globalAlpha = 1;
}

class Component extends DCLogic {
constructor(props) { super(props); this.state = {}; }
componentDidMount() {
  var self = this;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  this.reduce = reduce;
  this.t0 = performance.now();
  this.cardShown = reduce;
  this.setState({ cardShown: reduce });
  this.np = 0;
  if (this.glCv) { try { this.spatial = initSpatial(this.glCv, function () { self.setState({ glReady: true }); }); } catch (e) { this.spatial = null; } }
  fetch(EARTH_URL).then(function (r) { return r.json(); }).then(function (d) { self.earth = prepEarth(d); }).catch(function () {});
  fetch(NAME_URL).then(function (r) { return r.json(); }).then(function (d) { self.plan = buildPlan(d.pts || []); }).catch(function () {});
  this.stars = [];
  for (var k = 0; k < 240; k++) { var a = Math.sin(k * 12.9898) * 43758.5453, b = Math.sin(k * 78.233) * 12345.678; this.stars.push({ x: a - Math.floor(a), y: (b - Math.floor(b)) * 0.78, r: 0.4 + (k % 7) / 9, ph: k * 1.7 }); }
  this.mx = 0; this.my = 0; this.smx = 0; this.smy = 0;
  this.onPointer = function (e) {
    if (e.pointerType === 'touch' || !self.boxEl) return;
    var r = self.portraitClient || self.boxEl.getBoundingClientRect(); if (!r.width) return;
    self.mx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.6)));
    self.my = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.36)) / (r.height * 0.5)));
  };
  this.onPointerOut = function (e) { if (!e.relatedTarget) { self.mx = 0; self.my = 0; } };
  try { window.addEventListener('pointermove', this.onPointer, { passive: true }); window.addEventListener('pointerout', this.onPointerOut, { passive: true }); } catch (e) {}
  var tick = function (t) { self.frame(t); self.raf = requestAnimationFrame(tick); };
  this.raf = requestAnimationFrame(tick);
  this.setupRollers();
  this.setupTransmission();
}
// glass cards stand on podiums down both sides of the hangar. Pointing at one brings it to the centre stage, square to
// you and larger, so it can be read; it goes back when the pointer leaves both the card and its empty podium.
updateHangarCards(hS, s) {
  var el = this.hangarEl, self = this;
  if (!el) return;
  var vis = smooth(0.42, 0.52, hS);
  if (vis < 0.001 && this.lastHangarVis < 0.001) return;
  this.lastHangarVis = vis;
  el.style.opacity = vis.toFixed(3);
  el.style.visibility = vis > 0.01 ? 'visible' : 'hidden';
  el.style.pointerEvents = vis > 0.6 ? 'auto' : 'none';
  if (!this.glassCards) {
    this.glassCards = el.querySelectorAll('[data-glass]'); this.hangarHead = el.querySelector('[data-hangar-head]');
    this.glassLift = []; this.hoverK = -1;
    var pick = function (k) { if (self.hoverK !== k) { self.hoverK = k; self.slotRect = self.glassCards[k].getBoundingClientRect(); } };
    Array.prototype.forEach.call(this.glassCards, function (c, k) {
      self.glassLift[k] = 0;
      c.addEventListener('mouseenter', function () { if (self.hoverK < 0 || self.hoverK === k || self.glassLift[self.hoverK] < 0.5) pick(k); });
      c.addEventListener('focusin', function () { pick(k); });
      c.addEventListener('focusout', function () { if (self.hoverK === k) self.hoverK = -1; });
      c.addEventListener('click', function () { if (self.hoverK === k) self.hoverK = -1; else pick(k); });
    });
    var inside = function (r, x, y, pad) { return r && x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad; };
    el.addEventListener('mousemove', function (e) {
      if (self.hoverK < 0) return;
      var cur = self.glassCards[self.hoverK].getBoundingClientRect();
      if (!inside(cur, e.clientX, e.clientY, 12) && !inside(self.slotRect, e.clientX, e.clientY, 8)) self.hoverK = -1;
    });
    el.addEventListener('mouseleave', function () { self.hoverK = -1; });
  }
  HANGAR_LIFT = this.glassLift;
  var W = el.clientWidth, H = el.clientHeight, N = this.glassCards.length, L = hangarLayout(W, H, N), CS = hangarStage(W, H), live = this.reduce ? 0 : 1;
  if (this.hangarHead) this.hangarHead.style.transform = 'translateY(calc(-50% + ' + ((1 - vis) * 16).toFixed(1) + 'px))';
  for (var k = 0; k < N; k++) {
    var c = this.glassCards[k], St = L[k], arrive = ease(smooth(0.46 + k * 0.03, 0.58 + k * 0.03, hS));
    this.glassLift[k] += ((this.hoverK === k ? 1 : 0) - this.glassLift[k]) * (this.reduce ? 1 : 0.11);
    var w = ease(clamp01(this.glassLift[k]));
    var x = lerp(St.x, CS.x, w), y = lerp(St.y, CS.y, w), sc = lerp(St.sc, CS.sc, w), ry = St.ry * (1 - w);
    var arc = Math.sin(w * Math.PI) * 40;                     // a small hop as it crosses to the centre stage
    var idle = live * 2 * Math.sin(s * 0.8 + k * 1.7);
    c.style.left = (x - 125).toFixed(1) + 'px';
    c.style.bottom = (H - y + 5 * sc).toFixed(1) + 'px';
    c.style.opacity = arrive.toFixed(3);
    c.style.zIndex = String(10 + Math.round(St.sc * 10) + Math.round(w * 30));
    c.style.transform = 'translateY(' + (-arc - idle - w * 8 + (1 - arrive) * 30).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ') rotateY(' + ry.toFixed(2) + 'deg)';
    c.style.boxShadow = '0 ' + Math.round(18 + 24 * w) + 'px ' + Math.round(40 + 30 * w) + 'px rgba(0,0,0,' + (0.45 + 0.15 * w).toFixed(2) + '), 0 0 ' + Math.round(34 * w) + 'px rgba(255,91,31,' + (0.2 * w).toFixed(2) + '), inset 0 1px 0 rgba(255,255,255,0.22)';
    // parked cards show only category and name; the description and tags open as the card comes forward
    if (!c.__detail) c.__detail = c.querySelector('[data-detail]');
    var dw = smooth(0.35, 0.95, w);
    if (c.__detail) { c.__detail.style.maxHeight = (dw * 240).toFixed(0) + 'px'; c.__detail.style.opacity = dw.toFixed(3); c.__detail.style.marginTop = (-12 * (1 - dw)).toFixed(1) + 'px'; }
  }
}
// stats roll into place like a lotto wheel each time they scroll into view; reels stop left to right
setupRollers() {
  var host = this.wrapEl && this.wrapEl.parentElement;
  if (!host) return;
  var els = host.querySelectorAll('[data-roll]'), self = this, items = [];
  for (var e = 0; e < els.length; e++) {
    var el = els[e], text = el.getAttribute('data-roll'), cols = [];
    if (el.__rolled) continue; el.__rolled = true;
    el.setAttribute('aria-label', text); el.textContent = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true');
      if (/[0-9]/.test(ch)) {
        // the reel is exactly as wide as its final digit (an invisible copy sizes it), so a "1" doesn't sit in a "0"-wide slot;
        // side padding cancelled by negative margins gives wider digits room as they spin past without changing the spacing
        span.style.cssText = 'display:inline-block;position:relative;height:1em;line-height:1;vertical-align:top;overflow:hidden;padding:0 0.3em;margin:0 -0.3em';
        var sizer = document.createElement('span'); sizer.textContent = ch; sizer.style.visibility = 'hidden'; span.appendChild(sizer);
        var col = document.createElement('span'), h = '';
        col.style.cssText = 'position:absolute;left:50%;top:0;display:block;text-align:center;will-change:transform';
        for (var r = 0; r < 3; r++) for (var d = 0; d < 10; d++) h += '<span style="display:block;height:1em">' + d + '</span>';
        col.innerHTML = h; span.appendChild(col); cols.push({ col: col, d: +ch });
      } else span.textContent = ch;
      el.appendChild(span);
    }
    items.push(cols);
  }
  if (!items.length) return;
  var land = function (cols, animate) {
    cols.forEach(function (c, k) {
      c.col.style.transition = 'none'; c.col.style.transform = 'translate(-50%, 0)';
      void c.col.offsetHeight;
      c.col.style.transition = animate ? 'transform ' + (1.3 + k * 0.22) + 's cubic-bezier(0.12, 0.7, 0.18, 1)' : 'none';
      c.col.style.transform = 'translate(-50%, -' + (20 + c.d) + 'em)';
    });
  };
  var reset = function (cols) { cols.forEach(function (c) { c.col.style.transition = 'none'; c.col.style.transform = 'translate(-50%, 0)'; }); };
  if (this.reduce || typeof IntersectionObserver === 'undefined') { items.forEach(function (c) { land(c, false); }); return; }
  items.forEach(reset);
  this.rollIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var idx = Array.prototype.indexOf.call(els, en.target);
      if (idx < 0 || !items[idx]) return;
      var it = items[idx];
      if (en.intersectionRatio >= 0.6 && !it.on) { it.on = true; land(it, true); }
      else if (!en.isIntersecting && it.on) { it.on = false; reset(it); }
    });
  }, { threshold: [0, 0.6] });
  for (e = 0; e < els.length; e++) this.rollIO.observe(els[e]);
}
// "END TRANSMISSION": the slogan tunes in out of static when it scrolls into view, then keeps losing signal —
// short bursts of horizontal tearing and colour split, letters dropping out, signal bars falling, a blinking cursor
setupTransmission() {
  var host = this.wrapEl && this.wrapEl.parentElement, self = this;
  if (!host) return;
  var h2 = host.querySelector('[data-transmission]'), label = host.querySelector('[data-tx-label]');
  if (!h2 || h2.__tx) return; h2.__tx = true;
  var lines = Array.prototype.slice.call(h2.querySelectorAll('[data-tx-line]')), letters = [];
  lines.forEach(function (ln) {
    var t = ln.textContent; ln.textContent = '';
    for (var i = 0; i < t.length; i++) { var sp = document.createElement('span'); sp.textContent = t[i]; sp.__ch = t[i]; ln.appendChild(sp); if (t[i] !== ' ') letters.push(sp); }
  });
  var txt = label && label.querySelector('[data-tx-text]'), bars = label ? label.querySelectorAll('[data-tx-bars] i') : [], cur = label && label.querySelector('[data-tx-cursor]');
  var labelText = txt ? txt.textContent : '', NOISE = '▓▒░/\\_#';
  if (this.reduce) return;
  var timers = this.txTimers = [], on = false, signal = 4, redUntil = 0, holdUntil = 0;
  var later = function (fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; };
  var reset = function () {
    lines.forEach(function (ln) { ln.style.transform = ''; ln.style.textShadow = ''; ln.style.clipPath = ''; });
    letters.forEach(function (sp) { sp.style.opacity = ''; sp.textContent = sp.__ch; });
  };
  var tuneIn = function () {   // letters resolve out of noise, left to right
    var step = 0, total = 14;
    var tick = function () {
      if (!on) return;
      letters.forEach(function (sp, i) {
        var settled = step / total > i / letters.length + 0.15 * Math.random();
        sp.textContent = settled ? sp.__ch : NOISE[Math.floor(Math.random() * NOISE.length)];
        sp.style.opacity = settled ? '' : (0.3 + Math.random() * 0.4).toFixed(2);
      });
      if (++step <= total + 4) later(tick, 55); else reset();
    };
    tick();
  };
  var burst = function () {   // a short loss of signal
    if (!on) return;
    var frames = 3 + Math.floor(Math.random() * 4), f = 0;
    var frame = function () {
      if (!on) return;
      lines.forEach(function (ln) {
        var dx = (Math.random() - 0.5) * 14, a = Math.random() * 60, b = a + 15 + Math.random() * 35;
        ln.style.transform = 'translateX(' + dx.toFixed(1) + 'px)';
        ln.style.textShadow = (2 + Math.random() * 3).toFixed(1) + 'px 0 rgba(0,214,255,0.5), ' + (-2 - Math.random() * 3).toFixed(1) + 'px 0 rgba(255,91,31,0.55)';
        ln.style.clipPath = Math.random() < 0.5 ? 'inset(' + a.toFixed(0) + '% 0 ' + (100 - b).toFixed(0) + '% 0)' : '';
      });
      letters.forEach(function (sp) { sp.style.opacity = Math.random() < 0.12 ? '0.08' : ''; });
      if (++f < frames) later(frame, 50 + Math.random() * 40); else later(reset, 60);
    };
    frame();
    signal = 0;   // signal lost: bars fall to zero, flash red, then sit dead before recovering
    var now = Date.now();
    redUntil = now + 380 + Math.random() * 420;
    holdUntil = redUntil + 300 + Math.random() * 700;
    later(burst, 1800 + Math.random() * 3600);
  };
  var idle = function () {   // between bursts: a letter flickers, the label scrambles, the bars recover
    if (!on) return;
    if (Math.random() < 0.25) { var sp = letters[Math.floor(Math.random() * letters.length)]; sp.style.opacity = '0.15'; later(function () { sp.style.opacity = ''; }, 90); }
    if (txt) {
      if (Math.random() < 0.18) { var i = Math.floor(Math.random() * labelText.length), arr = labelText.split(''); if (arr[i] !== ' ') arr[i] = NOISE[Math.floor(Math.random() * NOISE.length)]; txt.textContent = arr.join(''); later(function () { txt.textContent = labelText; }, 110); }
    }
    var t = Date.now();
    if (t > holdUntil) signal = Math.min(4, signal + (Math.random() < 0.3 ? 1 : 0));
    var red = t < redUntil, blip = !red && Math.random() < 0.035;   // red no-signal glitch, plus the odd stray red blip
    // red square: steady blink, erratic flicker while the signal is lost, the odd stray blip
    if (cur) cur.style.opacity = red ? (Math.random() < 0.5 ? '1' : '0.1') : blip ? '0.1' : ((t % 1000) < 520 ? '1' : '0.1');
    later(idle, 140);
  };
  var start = function () { if (on) return; on = true; tuneIn(); later(idle, 200); later(burst, 1400); };
  var stop = function () { on = false; timers.forEach(clearTimeout); timers.length = 0; reset(); };
  if (typeof IntersectionObserver === 'undefined') { start(); return; }
  this.txIO = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) start(); else stop(); }); }, { threshold: 0.3 });
  this.txIO.observe(h2);
}
componentWillUnmount() {
  if (this.txIO) this.txIO.disconnect();
  if (this.txTimers) this.txTimers.forEach(clearTimeout);
  if (this.rollIO) this.rollIO.disconnect();
  if (this.raf) cancelAnimationFrame(this.raf);
  try { window.removeEventListener('pointermove', this.onPointer); window.removeEventListener('pointerout', this.onPointerOut); } catch (e) {}
}
frame(t) {
  var s = t / 1000;
  this.drawStage(t, s);
  this.drawDelivery(t, s);
}
fitCanvas(cv, W, H) {
  var dpr = Math.min(2, window.devicePixelRatio || 1), pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); return ctx;
}
// gaze for the spatial portrait: the delivery drone while it is on screen, otherwise the cursor
gaze(s) {
  this.follow = (this.follow || 0) + ((this.droneActive ? 1 : 0) - (this.follow || 0)) * (this.droneActive ? 0.12 : 0.04);
  var tx = this.mx, ty = this.my, r = this.portraitClient;
  if (this.follow > 0.001 && this.droneClient && r) {
    var gw = 0.35 * (this.gazeW == null ? 1 : this.gazeW);
    var dmx = gw * Math.max(-1, Math.min(1, (this.droneClient.x - (r.left + r.width / 2)) / (r.width * 0.6)));
    var dmy = gw * Math.max(-1, Math.min(1, (this.droneClient.y - (r.top + r.height * 0.36)) / (r.height * 0.5)));
    tx = lerp(tx, dmx, this.follow); ty = lerp(ty, dmy, this.follow);
  }
  var k = this.reduce ? 0.2 : lerp(0.07, 0.045, this.follow);
  this.smx += (tx - this.smx) * k; this.smy += (ty - this.smy) * k;
  var idle = this.reduce ? 0 : 1;
  var ox = SPATIAL_MAX_X * 0.9 * this.smx + 0.004 * Math.sin(s * 0.5) * idle;
  var oy = SPATIAL_MAX_Y * 0.8 * this.smy + 0.003 * Math.sin(s * 0.37 + 1) * idle;
  return [Math.max(-SPATIAL_MAX_X, Math.min(SPATIAL_MAX_X, ox)), Math.max(-SPATIAL_MAX_Y, Math.min(SPATIAL_MAX_Y, oy))];
}
drawStage(t, s) {
  var hero = this.heroEl, wrap = this.wrapEl, sky = this.skyCv, front = this.frontCv, box = this.boxEl;
  if (!hero || !wrap || !sky || !front || !box) return;
  var W = hero.clientWidth, H = hero.clientHeight;
  if (!W || !H) return;
  // scroll progress through the pinned stage, eased so scrubbing feels fluid; scrolling up rewinds everything
  var wr = wrap.getBoundingClientRect();
  var raw = clamp01(-wr.top / Math.max(1, wr.height - H));
  this.np += (raw - this.np) * (this.reduce ? 1 : 0.14);
  if (Math.abs(raw - this.np) < 0.0002) this.np = raw;
  // the first STAGE_SHOW px of the pinned stage play the show (p); the rest play the orbit transition (q)
  // then TRANS_PX of orbit transition (qT), then STORY_PX of career stories on the map (mS)
  var pxAll = this.np * Math.max(1, wr.height - H);
  // the first DELIVERY_PX of scroll fly the delivery in; everything after that is the show, transition and stories
  this.dlvDt = (this.reduce ? 1 : clamp01(pxAll / DELIVERY_PX)) * DLV.done;
  var px = Math.max(0, pxAll - DELIVERY_PX), showPx = Math.max(1, STAGE_SHOW - H);
  var pe = px / showPx, p = Math.min(1, pe), qT = clamp01((px - showPx) / TRANS_PX), mS = clamp01((px - showPx - TRANS_PX) / STORY_PX);
  var hS = clamp01((px - showPx - TRANS_PX - STORY_PX) / HANGAR_PX);
  this.qT = qT;
  var camY = H * 1.15 * ease(smooth(0, 0.34, qT));
  var L = stageLayout(W, H, p, box.clientWidth, box.offsetTop || 104);
  var C = L.C, P = L.P;
  var hr = hero.getBoundingClientRect();
  this.portraitClient = { left: hr.left + P.x, top: hr.top + P.y, width: P.S, height: P.S };
  // DOM overlay (nav, wordmark, card) fades as the sunset begins
  var ov = Math.round((1 - smooth(0.08, 0.18, p)) * 20) / 20;
  if (ov !== this.lastOv) { this.lastOv = ov; this.setState({ overlay: ov }); }

  // ---------- sky layer: outer page, marquee, card sky, sun, horizon glow, ground, stars
  var ctx = this.fitCanvas(sky, W, H);
  ctx.fillStyle = rgb(SPACE); if (camY > 0) ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, camY);
  if (camY > 0) {
    // the sky simply continues above the show: night blue deepens into space, same stars, no seam
    var skyTop0 = keyed(SKY_TOP, p).map(Math.round);
    var bg = ctx.createLinearGradient(0, -H * 1.3, 0, 0);
    bg.addColorStop(0, rgb(SPACE)); bg.addColorStop(1, rgb(skyTop0));
    ctx.fillStyle = bg; ctx.fillRect(0, -H * 1.6, W, H * 1.6 + 1);
    ctx.fillStyle = '#FFF4E8';
    for (var k2 = 0; k2 < SPACE_STARS.length; k2++) {
      var st2 = SPACE_STARS[k2];
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(s * 0.8 + st2.ph));
      ctx.beginPath(); ctx.arc(st2.x * W, -st2.y * H * 1.45, st2.r * 0.9, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  var outer = keyed(OUTER, p);
  ctx.fillStyle = rgb(outer.map(Math.round)); ctx.fillRect(0, 0, W, H);
  var accent = this.props.accent ?? '#FF5B1F';
  var mq = smooth(0.2, 0.3, p) * (1 - smooth(0.48, 0.56, p));
  if (mq > 0.01) {
    // two lines behind the card (Lando-style); they crawl on their own clock, independent of page scroll
    var fs = Math.round(Math.min(150, H * 0.14));
    var y1 = H * 0.5 - fs * 0.08, y2 = y1 + fs * 1.0;
    var crawl = this.reduce ? 0 : s * 70;
    ctx.globalAlpha = mq; ctx.textBaseline = 'alphabetic';
    ctx.font = '400 ' + fs + 'px "Instrument Serif", Georgia, serif'; ctx.fillStyle = accent;
    this.marquee(ctx, MARQUEE_1, W, y1, -crawl);
    ctx.font = '900 ' + fs + 'px "Big Shoulders Display", Impact, sans-serif'; ctx.fillStyle = '#E6E4DD';
    this.marquee(ctx, MARQUEE_2, W, y2, crawl * 0.85 - W * 0.4);
    ctx.globalAlpha = 1;
  }
  // the card: its own sky, with the sun setting behind the head
  ctx.save();
  roundRectPath(ctx, C.x, C.y, C.w, C.h, C.r); ctx.clip();
  var top = keyed(SKY_TOP, p).map(Math.round), bot = keyed(SKY_BOT, p).map(Math.round);
  var g = ctx.createLinearGradient(0, C.y, 0, L.hl);
  g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g; ctx.fillRect(C.x, C.y, C.w, C.h);
  // the two pass-through drones fly in the sky layer, so the portrait (drawn above it) hides them as they cross behind the head
  // the faint UTM city map fills the daylight background and gives way as the sun starts to set
  var utmA = 1 - smooth(0.02, 0.1, p);
  if (utmA > 0.01) drawUTM(ctx, W, H, this.reduce ? 0 : s, utmA, accent);
  if (!this.reduce && p < 0.1) drawTraffic(ctx, s, accent, P, W);
  // stars come out
  var starA = smooth(0.36, 0.52, p);
  if (starA > 0.01) {
    ctx.fillStyle = '#FFF4E8';
    for (var k = 0; k < this.stars.length; k++) {
      var st = this.stars[k];
      var sx = st.x * W, sy = st.y * L.hl;
      ctx.globalAlpha = starA * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(s * 0.8 + st.ph)));
      ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // sun: drifts down from upper right and sets behind the head
  var sp = ease(smooth(0.03, 0.42, p));
  var su = lerp(0.82, 0.54, sp), sv = lerp(0.06, 0.52, sp);
  var sunA = smooth(0.03, 0.12, p) * (1 - smooth(0.44, 0.52, p));
  var sunCol = keyed(SUN_COL, p).map(Math.round);
  if (sunA > 0.01) {
    var sxp = P.x + su * P.S, syp = P.y + sv * P.S, sr = 0.085 * P.S;
    var halo = ctx.createRadialGradient(sxp, syp, sr * 0.6, sxp, syp, sr * 4.5);
    halo.addColorStop(0, rgb(sunCol, 0.55 * sunA)); halo.addColorStop(1, rgb(sunCol, 0));
    ctx.fillStyle = halo; ctx.fillRect(sxp - sr * 5, syp - sr * 5, sr * 10, sr * 10);
    ctx.globalAlpha = sunA; ctx.fillStyle = rgb(sunCol); ctx.beginPath(); ctx.arc(sxp, syp, sr, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  // last light on the horizon, then the ground once the card opens out
  var glowA = smooth(0.14, 0.32, p) * (1 - smooth(0.6, 0.72, p));
  if (glowA > 0.01) {
    var gg = ctx.createLinearGradient(0, L.hl - H * 0.22, 0, L.hl);
    gg.addColorStop(0, rgb([255, 140, 80], 0)); gg.addColorStop(1, rgb([255, 140, 80], 0.45 * glowA));
    ctx.fillStyle = gg; ctx.fillRect(C.x, L.hl - H * 0.22, C.w, H * 0.22);
  }
  drawFlatirons(ctx, C, L.hl, p, sunCol);
  if (L.e > 0) {
    ctx.fillStyle = rgb(GROUND); ctx.fillRect(C.x, L.hl, C.w, C.y + C.h - L.hl + 2);
    var lineA = L.e * (1 - 0.6 * smooth(0.88, 0.95, p));
    var lg = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
    lg.addColorStop(0, 'rgba(255,170,110,0)'); lg.addColorStop(0.5, rgb([255, 170, 110], 0.6 * lineA)); lg.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = lg; ctx.fillRect(W * 0.1, L.hl - 0.5, W * 0.8, 1.5);
    // the show lights the ground: a faint warm pool under the formation that grows as the drones climb and lock
    var glowS = smooth(0.66, 0.9, p);
    if (glowS > 0.01) {
      var gcx = C.x + C.w / 2, gcy = L.hl + (C.y + C.h - L.hl) * 0.12, grx = C.w * 0.46, gry = (C.y + C.h - L.hl) * 0.5;
      ctx.save(); ctx.translate(gcx, gcy); ctx.scale(1, gry / grx);
      var pg = ctx.createRadialGradient(0, 0, 0, 0, 0, grx);
      pg.addColorStop(0, rgb([255, 158, 104], 0.13 * glowS)); pg.addColorStop(0.45, rgb([236, 226, 230], 0.05 * glowS)); pg.addColorStop(1, 'rgba(236,226,230,0)');
      ctx.fillStyle = pg; ctx.fillRect(-grx, -grx, grx * 2, grx * 2);
      ctx.restore();
    }
  }
  ctx.restore();
  this.drawStarlink(ctx, W, H, pe, s, C, L.hl);
  ctx.restore();
  // ---------- space: the camera has tilted up off the show; Earth rises, then we dive onto the map
  var GV = qT > 0.25 ? globeView(W, H, qT, mS) : null;
  if (GV) drawSpace(ctx, W, H, qT, s, this.earth, GV);

  // ---------- portrait (WebGL): tinted by the sunset, rim-lit, then a silhouette that sets below the horizon
  var Sp = this.spatial, off = this.gaze(s);
  if (Sp && Sp.ready && this.glCv) {
    var dx = su - 0.505, dy = sv - 0.33, dl = Math.sqrt(dx * dx + dy * dy) || 1;
    var look = {
      tint: keyed(TINT, p), dark: smooth(0.32, 0.46, p),
      sun: [dx / dl * 0.012, dy / dl * 0.012],
      rim: 0.95 * smooth(0.1, 0.28, p) * (1 - smooth(0.5, 0.6, p)),
      rimCol: sunCol
    };
    var clip = { x: C.x, y: C.y, w: C.w, h: Math.min(C.y + C.h, L.hl) - C.y };
    var damp = 1 - L.c * 0.5;
    drawSpatialStage(Sp, this.glCv, W, H, P, clip, off[0] * damp, off[1] * damp, look);
  }

  // ---------- front layer: rounded-corner mask for the card, then the airfield and the show
  var f = this.fitCanvas(front, W, H);
  f.save(); f.translate(0, camY);
  if (C.r > 0.5) {
    // fill just the four corner slivers outside the rounded card (the portrait is clipped square by the GPU scissor)
    f.fillStyle = rgb(outer.map(Math.round));
    f.beginPath(); f.rect(C.x - 1, C.y - 1, C.w + 2, C.h + 2); roundRectPathAppend(f, C.x, C.y, C.w, C.h, C.r); f.fill('evenodd');
  }
  if (p > 0.54) {
    f.save(); roundRectPath(f, C.x, C.y, C.w, C.h, C.r); f.clip();
    this.drawShow(f, W, H, p, s);
    f.restore();
  }
  f.restore();
  if (GV && qT > 0.8 && hS < 0.3) drawStories(f, W, H, qT, mS, s, this.props.accent ?? '#FF5B1F', GV);
  // ---------- the hangar: the camera pulls back to a hangar front, the doors roll open, glass project cards float inside
  if (hS > 0) drawHangar(f, W, H, hS, s, this.props.accent ?? '#FF5B1F');
  this.updateHangarCards(hS, s);
}
// ---- homage to Starlink: one fresh-launch train, tied to scroll, crossing once while the name rocks;
// as the transition starts it climbs away and the camera follows it up into orbit
drawStarlink(ctx, W, H, pe, s, C, horizonY) {
  // drawn in the show's own frame, so when the camera looks up the train stays with BRENT ELIASON
  var NSAT = 28, gap = 0.026;
  var st0 = this.firstLockPe || 0.86, st1 = 1.22;
  var u0 = (pe - st0) / (st1 - st0);
  var head = u0 * (1 + NSAT * gap + 0.1) - 0.05;
  if (head < -0.05 || head - NSAT * gap > 1.05) return;
  ctx.save(); ctx.beginPath(); ctx.rect(0, -H * 2, W, horizonY + H * 2); ctx.clip();
  ctx.fillStyle = '#DCE6FF';
  for (var n = 0; n < NSAT; n++) {
    var u = head - n * gap;
    if (u < -0.05 || u > 1.05) continue;
    var tx = C.x + u * C.w, ty = C.y + H * (0.06 + 0.15 * u + 0.05 * u * u);
    var tw = 0.78 + 0.22 * Math.sin(s * 2.1 + n * 1.3), edge = smooth(-0.05, 0.06, u) * (1 - smooth(0.94, 1.05, u));
    ctx.globalAlpha = edge * 0.18 * tw; ctx.beginPath(); ctx.arc(tx, ty, 4.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = edge * 0.88 * tw; ctx.beginPath(); ctx.arc(tx, ty, 1.6, 0, TAU); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
marquee(ctx, text, W, y, shift) {
  var tw = ctx.measureText(text).width; if (!tw) return;
  var x = ((shift % tw) + tw) % tw - tw;
  for (; x < W; x += tw) ctx.fillText(text, x, y);
}
// ---- the night show: field arms on the horizon, scroll scrubs the launch, the name locks
getPaths(w, h, bx, by, bw, bh) {
  var plan = this.plan;
  var key = [w, h, Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh)].join('|');
  if (this.pathCache && this.pathCache.key === key) return this.pathCache;
  var pxPerM = (2 * FIELD.half * w) / (plan.cols * PAD_SPACING), vpx = SPEED * pxPerM;
  var list = [], N = 14;
  for (var i = 0; i < plan.length; i++) {
    var p = plan[i], g = fieldPt(p.col, p.depth, w, h);
    var hx = g.x, hy = g.y - h * (0.08 + 0.14 * p.climb) * g.s;
    // fly to the slot as seen in the formation's 3D pose
    var pp = poseProject((p.tx - 0.5) * bw, (p.ty - 0.5) * bh, p.tz * bw, YAW_IN, bw * 2.2);
    var tx = bx + bw / 2 + pp.x, ty = by + bh / 2 + pp.y;
    var d = Math.sqrt((tx - hx) * (tx - hx) + (ty - hy) * (ty - hy));
    var cx = hx, cy = hy - 0.35 * d;
    var xs = [g.x, hx], ys = [g.y, hy];
    for (var j = 1; j <= N; j++) { var u = j / N, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u; xs.push(a * hx + b * cx + c * tx); ys.push(a * hy + b * cy + c * ty); }
    var cum = [0];
    for (j = 1; j < xs.length; j++) cum.push(cum[j - 1] + Math.sqrt((xs[j] - xs[j - 1]) * (xs[j] - xs[j - 1]) + (ys[j] - ys[j - 1]) * (ys[j] - ys[j - 1])));
    list.push({ xs: xs, ys: ys, cum: cum, pf: profile(Math.max(1, cum[cum.length - 1]), vpx), launch: 0 });
  }
  var times = scheduleLaunches(plan, list.map(function (q) { return q.pf.T; }));
  var formed = 0;
  var first = Infinity;
  for (i = 0; i < list.length; i++) { list[i].launch = times[i]; formed = Math.max(formed, times[i] + list[i].pf.T); first = Math.min(first, times[i] + list[i].pf.T); }
  this.pathCache = { key: key, list: list, formed: formed, first: first };
  return this.pathCache;
}
drawShow(ctx, W, H, p, s) {
  var plan = this.plan;
  if (!plan) return;
  var bw = Math.min(W * 0.82, H * 0.6 * NAME_ASPECT, 1120), bh = bw / NAME_ASPECT, bx = (W - bw) / 2, by = H * 0.43 - bh / 2;
  FIELD.half = Math.min(0.46, Math.max(0.28, (bw * 0.85) / W)); FIELD.cx = 0.5;
  var paths = this.getPaths(W, H, bx, by, bw, bh);
  var T = paths.formed;
  // scroll position where the first drones lock in and light up (the top row of BRENT): the Starlink pass starts here
  this.firstLockPe = 0.64 + 0.22 * (paths.first / T);
  var it = clamp01((p - 0.64) / 0.22) * T;
  var lock = smooth(0.84, 0.9, p);
  // the reveal turn: left side near at lock, then scroll swings the right side forward
  var turn = ease(smooth(0.87, 1, p));
  // it never sits still: a slow rock on top of the scroll turn, a gentle nod, and a float like it is riding the air
  var live = this.reduce ? 0 : lock;
  var yawNow = lerp(YAW_IN, YAW_OUT, turn) + live * (0.075 * Math.sin(s * 0.42) + 0.02 * Math.sin(s * 1.07 + 1.3));
  var pitchNow = POSE_PITCH + live * 0.035 * Math.sin(s * 0.33 + 0.6);
  var fieldA = smooth(0.56, 0.66, p);
  var airborne = 0;
  for (var a = 0; a < paths.list.length; a++) if (it > 0 && it >= paths.list[a].launch) airborne++;
  ctx.globalCompositeOperation = 'lighter';
  var sp = bw * NAME_SPACING;
  var bob = live * (7 * Math.sin(s * 0.55) + 2.5 * Math.sin(s * 1.3 + 2));
  var ncx = bx + bw / 2, ncy = by + bh / 2, F = bw * 2.2;
  for (var i = 0; i < plan.length; i++) {
    var q = plan[i], path = paths.list[i], x, y, alpha, rad;
    if (it <= 0 || it <= path.launch) {
      var gp = fieldPt(q.col, q.depth, W, H);
      x = gp.x; y = gp.y; rad = 1.1 * gp.s;
      // pads arm along the horizon from the centre outward
      alpha = 0.6 * fieldA * smooth(0, 0.25, fieldA * 1.25 - Math.abs(q.col - 0.5));
      if (alpha < 0.02) continue;
    } else {
      var sd = distAt(path.pf, it - path.launch), kk = 1, cum = path.cum;
      while (kk < cum.length - 1 && cum[kk] < sd) kk++;
      var seg = cum[kk] - cum[kk - 1], fr = seg > 0 ? clamp01((sd - cum[kk - 1]) / seg) : 1;
      x = path.xs[kk - 1] + (path.xs[kk] - path.xs[kk - 1]) * fr; y = path.ys[kk - 1] + (path.ys[kk] - path.ys[kk - 1]) * fr;
      var arrived = sd >= path.pf.L - 0.5;
      // the slot moves with the live pose; a drone in flight eases onto it, a drone in the formation rides it
      var X0 = (q.tx - 0.5) * bw, Y0 = (q.ty - 0.5) * bh, Z0 = q.tz * bw;
      var a0 = poseProject(X0, Y0, Z0, YAW_IN, F), a1 = poseProject(X0, Y0, Z0, yawNow, F, pitchNow), u = clamp01(sd / path.pf.L);
      x += (a1.x - a0.x) * u; y += (a1.y - a0.y) * u + bob * u;
      if (arrived && live) { x += live * 0.7 * Math.sin(s * 1.6 + q.ph); y += live * 0.7 * Math.cos(s * 1.3 + q.ph * 1.7); }
      // crisp points; the near side of the turning plane is larger and brighter, the far side smaller and dimmer
      var near = clamp01((a1.k - 0.92) / 0.16), back = q.tz < 0;
      alpha = !arrived ? 0.95 : back ? 0.4 : 0.6 + 0.37 * near;
      rad = sp * (arrived ? (back ? 0.24 : 0.29) * a1.k : 0.22);
    }
    var col = (it > path.launch && distAt(path.pf, it - path.launch) >= path.pf.L - 0.5) ? q.rgb : LIGHT;
    ctx.fillStyle = rgb(col);
    ctx.globalAlpha = alpha * 0.12; ctx.beginPath(); ctx.arc(x, y, rad * 2.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  var hud = smooth(0.58, 0.66, p);
  if (hud > 0.01) {
    var pad = Math.max(16, W * 0.03);
    ctx.globalAlpha = hud * 0.6; ctx.fillStyle = '#EDEEE9'; ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.globalAlpha = hud * 0.6 * (1 - smooth(0.66, 0.72, p));
    ctx.fillText('KEEP SCROLLING TO FLY ↓', W / 2, H - pad);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
}
// ---- delivery
drawDelivery(t, s) {
  var cv = this.dlvCv, hero = this.heroEl, card = this.cardEl;
  if (!cv || !hero || !card) return;
  var dt = this.dlvDt || 0;   // scroll-driven: scrolling down flies the delivery forward, scrolling up rewinds it
  var show = dt >= DLV.cardAt;
  if (show !== !!this.cardShown) { this.cardShown = show; this.setState({ cardShown: show }); }
  var W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (this.reduce || dt >= DLV.done) { this.droneActive = false; if (!this.dlvCleared) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); this.dlvCleared = true; } return; }
  this.dlvCleared = false;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  var hr = hero.getBoundingClientRect(), cr = card.getBoundingClientRect();
  var C = { x: cr.left - hr.left, y: cr.top - hr.top, w: cr.width, h: cr.height };
  var accent = this.props.accent ?? '#FF5B1F';
  // one fixed altitude: just above the top of the head in the portrait
  var bxr = this.boxEl ? this.boxEl.getBoundingClientRect() : null;
  var headTop = bxr ? (bxr.top - hr.top) + 0.09 * bxr.width : 190;
  var hx = C.x + C.w / 2, hy = Math.max(150, headTop - 26);
  // drone position and tilt: in from the right, hover, out to the left — y never changes
  var x, y = hy, tilt;
  if (dt < DLV.enterStart) { this.droneActive = false; return; }
  if (dt < DLV.enterEnd) {
    // steady cruise across the hero, then a soft brake over the drop point (so the face can track it)
    var u = (dt - DLV.enterStart) / (DLV.enterEnd - DLV.enterStart);
    var e = u < 0.7 ? (u / 0.7) * 0.85 : 0.85 + 0.15 * easeOut((u - 0.7) / 0.3);
    x = lerp(W + 150, hx, e);
    tilt = 0.3 * (1 - u) * (1 - u) - 0.14 * Math.sin(Math.PI * clamp01((u - 0.68) / 0.32));
  } else if (dt < DLV.exitStart) {
    x = hx; tilt = 0.02 * Math.sin(s * 2.1);
  } else {
    var ue = clamp01((dt - DLV.exitStart) / (DLV.exitEnd - DLV.exitStart));
    x = lerp(hx, -180, easeIn(ue));
    tilt = 0.32 * smooth(0, 0.25, ue);
  }
  // gaze: a faint follow of the drone as it flies in, fading out gradually as it settles into its hover
  this.droneActive = dt < DLV.done;
  this.gazeW = 1 - smooth(DLV.enterEnd - 0.4, DLV.lowerStart + 1.5, dt);
  this.droneClient = { x: hr.left + x, y: hr.top + y };
  // box and wire
  var winchY = y + 15;
  var landTop = C.y + C.h - BOX_H, landX = C.x + C.w / 2 - BOX_W / 2 - BOX_DX / 2;
  var bx = landX, by = landTop, wireTop = winchY, wireBot = null;
  var hang = winchY + 22;   // in flight the package rides on a short tether below the drone
  if (dt < DLV.lowerStart) {
    by = hang; bx = x - BOX_W / 2 - BOX_DX / 2; wireBot = by;
  } else if (dt < DLV.lowerEnd) {
    var ul = ease((dt - DLV.lowerStart) / (DLV.lowerEnd - DLV.lowerStart));
    var sway = 7 * Math.sin(dt * 2.6) * Math.exp(-(dt - DLV.lowerStart) * 0.9) * (1 - ul);
    by = lerp(hang, landTop, ul); bx = landX + sway; wireBot = by;
  } else if (dt < DLV.retractEnd) {
    var ur = clamp01((dt - DLV.release) / (DLV.retractEnd - DLV.release));
    wireBot = lerp(landTop, winchY, easeOut(ur));
  }
  if (wireBot !== null && wireBot > wireTop + 1) {
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, wireTop); ctx.lineTo(dt < DLV.release ? bx + BOX_W / 2 + BOX_DX / 2 : x, wireBot); ctx.stroke();
    // hook
    ctx.beginPath(); ctx.arc(dt < DLV.release ? bx + BOX_W / 2 + BOX_DX / 2 : x, wireBot - 2, 2.5, 0, TAU); ctx.stroke();
  }
  var flap = clamp01((dt - DLV.flapStart) / (DLV.flapEnd - DLV.flapStart));
  var morph = clamp01((dt - DLV.morphStart) / (DLV.morphEnd - DLV.morphStart));
  var boxAlpha = 1 - smooth(DLV.cardAt, DLV.cardAt + 0.3, dt);
  if (boxAlpha > 0.01) { ctx.globalAlpha = boxAlpha; drawBox(ctx, bx, by - (dt < DLV.lowerStart ? 0 : 0), flap, morph, C, accent); ctx.globalAlpha = 1; }
  if (dt < DLV.exitEnd) drawDrone(ctx, x, y, tilt, s, accent, -1);
}
renderVals() {
  var self = this;
  var st = this.state || {};
  return {
    accent: this.props.accent ?? '#FF5B1F',
    imgOpacity: st.glReady ? 0 : 1,
    glOpacity: st.glReady ? 1 : 0,
    cardOpacity: st.cardShown ? 1 : 0,
    cardPointer: st.cardShown ? 'auto' : 'none',
    heroRef: function (n) { self.heroEl = n; },
    boxRef: function (n) { self.boxEl = n; },
    glRef: function (n) { self.glCv = n; },
    cardRef: function (n) { self.cardEl = n; },
    deliveryRef: function (n) { self.dlvCv = n; },
    hangarRef: function (n) { self.hangarEl = n; },
    wrapRef: function (n) { self.wrapEl = n; },
    skyRef: function (n) { self.skyCv = n; },
    frontRef: function (n) { self.frontCv = n; },
    overlayOpacity: st.overlay != null ? st.overlay : 1,
    overlayPointer: (st.overlay != null ? st.overlay : 1) > 0.3 ? 'auto' : 'none',
    replay: function () {
      if (self.reduce) return;
      self.t0 = performance.now(); self.cardShown = false; self.dlvCleared = false; self.setState({ cardShown: false });
    }
  };
}
}

// ===================== mount =====================
var MARKUP = "<div style=\"background: #0B0E13; color: #15171A; font-family: Inter, system-ui, sans-serif; width: 100%\">\n\n<!-- ============ PINNED STAGE: daylight hero \u2192 sunset \u2192 collapse \u2192 set \u2192 night show ============ -->\n<section data-ref=\"wrapRef\" aria-label=\"Hero and night show\" style=\"position: relative; height: 18600px; background: #0B0E13\">\n<div data-ref=\"heroRef\" style=\"position: sticky; top: 0; height: 100vh; min-height: 640px; overflow: hidden; background: #F2F1ED\">\n\n<canvas data-ref=\"skyRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 0; pointer-events: none\"></canvas>\n<canvas data-ref=\"glRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; pointer-events: none; opacity: 0\"></canvas>\n<div data-ref=\"boxRef\" style=\"position: absolute; left: 50%; top: 104px; width: min(100%, 980px); aspect-ratio: 1; transform: translateX(-50%); z-index: 1; pointer-events: none\">\n<img data-dyn=\"img\" src=\"__ASSET__portrait.webp\" alt=\"Portrait of Brent \u201cDuster\u201d Eliason\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; opacity: 1\">\n</div>\n<canvas data-ref=\"frontRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 3; pointer-events: none\"></canvas>\n\n<div data-dyn=\"overlay\" style=\"position: absolute; inset: 0; z-index: 5; opacity: 1; pointer-events: auto\">\n<nav aria-label=\"Primary\" style=\"position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 16px; padding: 18px clamp(16px, 3vw, 32px)\">\n<a href=\"#\" aria-label=\"Brent Eliason, home\" style=\"justify-self: start; text-decoration: none; color: #15171A\">\n<h1 style=\"margin: 0; display: flex; flex-direction: column; line-height: 0.86\">\n<span style=\"font-family: 'Instrument Serif', serif; font-weight: 400; font-size: calc(1.61 * clamp(32px, 3.2vw, 47px)); line-height: 0.8\">Brent</span>\n<span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(32px, 3.2vw, 47px); text-transform: uppercase\">Eliason</span>\n</h1>\n</a>\n<div style=\"justify-self: center; display: flex; flex-direction: column; align-items: center; gap: 10px\">\n<svg role=\"img\" aria-label=\"3E monogram\" width=\"60\" height=\"46\" viewBox=\"0 0 330 254\" style=\"display: block; color: #15171A\"><g transform=\"translate(62,20) skewX(-11.31)\" fill=\"none\" stroke-width=\"34\"><path stroke=\"__ACCENT__\" d=\"M0 0H55A50 50 0 0 1 55 100H25M55 100A50 50 0 0 1 55 200H0\"></path><path stroke=\"currentColor\" d=\"M245 0H155V200H245M155 100H227\"></path></g></svg>\n<p style=\"margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2.5px; color: #3E4246; text-align: center; max-width: 62vw; line-height: 1.7\">AUTONOMOUS FLIGHT OPERATIONS</p>\n</div>\n<div style=\"justify-self: end; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 22px; font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase\">\n<a href=\"#contact\" style=\"text-decoration: none; padding: 12px 0\">Contact</a>\n</div>\n</nav>\n\n<a data-ref=\"cardRef\" class=\"li-card\" href=\"https://www.linkedin.com/in/brent-eliason/\" target=\"_blank\" rel=\"noopener\" aria-label=\"Brent Eliason on LinkedIn (opens in a new tab)\" style=\"position: absolute; left: calc(clamp(16px, 3vw, 32px) + 56px); bottom: clamp(64px, 11vh, 120px); width: 48px; height: 48px; display: block; border-radius: 9px; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.35s ease, transform 0.2s ease, box-shadow 0.2s ease\">\n<svg aria-hidden=\"true\" width=\"48\" height=\"48\" viewBox=\"3 3 48 48\" style=\"display: block\"><rect x=\"3\" y=\"3\" width=\"48\" height=\"48\" rx=\"9\" fill=\"#0A66C2\"></rect><circle cx=\"16.5\" cy=\"16.2\" r=\"3.6\" fill=\"#FFFFFF\"></circle><rect x=\"13.4\" y=\"22.4\" width=\"6.2\" height=\"19.4\" rx=\"0.8\" fill=\"#FFFFFF\"></rect><path d=\"M24.6 22.4h5.9v2.7c1-1.8 3.2-3.2 6.2-3.2 5.2 0 7 3.2 7 8.4v11.5h-6.2V31.6c0-2.5-.5-4.4-3-4.4s-3.7 1.9-3.7 4.6v10h-6.2z\" fill=\"#FFFFFF\"></path></svg>\n</a>\n\n<div style=\"position: absolute; right: clamp(16px, 3vw, 32px); bottom: 28px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px\">\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2px; color: #5E6266\">SCROLL \u2193</span>\n</div>\n</div>\n\n<div data-ref=\"hangarRef\" role=\"region\" aria-label=\"Projects, under construction\" style=\"position: absolute; inset: 0; z-index: 7; opacity: 0; visibility: hidden; pointer-events: none; perspective: 1100px; perspective-origin: 50% 30%; overflow: hidden\">\n<div data-hangar-head style=\"position: absolute; left: 0; right: 0; top: 47%; text-align: center; color: #EDEEE9; padding: 0 16px\">\n<p style=\"margin: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2.5px; color: __ACCENT__\">HANGAR 3E \u00b7 BUILDS IN PROGRESS</p>\n<h2 style=\"margin: 0; font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(40px, 5.4vw, 80px); line-height: 0.9; text-transform: uppercase\">Under Construction</h2>\n<p style=\"margin: 14px auto 0; max-width: 460px; font-size: 15px; line-height: 1.55; color: #C9CFD4\">New projects are being built in here. The first ones roll out soon.</p>\n</div>\n</div>\n<canvas data-ref=\"deliveryRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 6; pointer-events: none; opacity: 1\" data-dyn=\"overlay2\"></canvas>\n<h2 style=\"position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0\">When the sun goes down, the show goes up: Brent Eliason written by 3,077 drones. A Starlink train crosses the sky, and the view follows it into orbit and down onto a map, where each place in Brent\u2019s career appears as a story, and then into a hangar where his next projects are under construction.</h2>\n<ol style=\"position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0\"><li>Duluth, MN, University of Minnesota: first autonomous flight integration.</li><li>Superior, WI, EASE Drones: pipeline right-of-way inspection using autonomous aircraft.</li><li>Grand Forks, ND, Northern Plains UAS Test Site: integrating drones into the national airspace.</li><li>Grand Forks Air Force Base, ND, EASE Drones, NASA, DOD: research pivotal to unmanned traffic management development.</li><li>Grand Forks, ND, Flytrex: the first commercial drone delivery operation in the United States.</li><li>Raleigh, NC, Flytrex: scaled drone delivery across the Research Triangle and surrounding suburbs.</li><li>Dallas, TX, Flytrex: continued scaling across the DFW metro, achieving FAA-approved remote BVLOS operations.</li><li>Boulder, CO: classified, details coming soon.</li></ol>\n</div>\n</section>\n\n<!-- ============ STATEMENT (night) ============ -->\n<section id=\"work\" style=\"background: #0B0E13; color: #EDEEE9; padding: clamp(80px, 10vw, 150px) clamp(16px, 4vw, 56px)\">\n<div style=\"display: flex; flex-wrap: wrap; gap: 32px 80px; max-width: 1280px; margin: 0 auto\">\n<p data-tx-label aria-label=\"End transmission\" style=\"flex: 0 0 200px; margin: 6px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2.5px; color: #9AA5AF; display: flex; align-items: center; gap: 10px; white-space: nowrap\"><span data-tx-cursor aria-hidden=\"true\" style=\"flex: 0 0 auto; width: 8px; height: 8px; background: #FF2B2B; box-shadow: 0 0 6px rgba(255,43,43,0.6)\"></span><span data-tx-text aria-hidden=\"true\">END TRANSMISSION</span></p>\n<div style=\"flex: 1 1 560px; display: flex; flex-direction: column; gap: 28px\">\n<h2 data-transmission aria-label=\"Spend more time doing.\" style=\"position: relative; margin: 0; font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(64px, 10vw, 156px); line-height: 0.86; letter-spacing: -0.5px; text-transform: uppercase\"><span data-tx-line aria-hidden=\"true\" style=\"display: block; color: #EDEEE9\">Spend more</span><span data-tx-line aria-hidden=\"true\" style=\"display: block; color: __ACCENT__\">time doing.</span><span aria-hidden=\"true\" style=\"position: absolute; inset: -4px 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(11,14,19,0.32) 0 1px, transparent 1px 4px); mix-blend-mode: multiply\"></span></h2>\n<p style=\"margin: 0; font-size: 19px; line-height: 1.6; color: #C9CFD4; max-width: 620px\">Fifteen years integrating autonomous aircraft into the national airspace.</p>\n<div style=\"display: flex; flex-wrap: wrap; border-top: 1px solid #26323D; margin-top: 12px\">\n<div style=\"flex: 1 1 160px; padding: 18px 20px 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\" data-roll=\"2010\">2010</span><span style=\"font-size: 13px; color: #9AA5AF\">First autopilot integration</span></div>\n<div style=\"flex: 1 1 160px; padding: 18px 20px 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\" data-roll=\"15+\">15+</span><span style=\"font-size: 13px; color: #9AA5AF\">Years in autonomous systems</span></div>\n<div style=\"flex: 1 1 160px; padding: 18px 0 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\" data-roll=\"250,000+\">250,000+</span><span style=\"font-size: 13px; color: #9AA5AF\">Flights overseen</span></div>\n</div>\n</div>\n</div>\n</section>\n\n<!-- ============ FOOTER ============ -->\n<footer id=\"contact\" style=\"background: #0B0E13; color: #EDEEE9; padding: 56px clamp(16px, 4vw, 56px) 36px; border-top: 1px solid #26323D; display: flex; flex-direction: column; gap: 40px\">\n<div style=\"display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 24px\">\n<a href=\"#\" aria-label=\"Brent Eliason, back to top\" style=\"display: block; color: #EDEEE9; line-height: 0\"><svg role=\"img\" aria-label=\"3E, the Brent Eliason monogram\" viewBox=\"0 0 330 254\" style=\"display: block; width: clamp(96px, 11vw, 150px); height: auto\"><g transform=\"translate(62,20) skewX(-11.31)\" fill=\"none\" stroke-width=\"34\"><path stroke=\"__ACCENT__\" d=\"M0 0H55A50 50 0 0 1 55 100H25M55 100A50 50 0 0 1 55 200H0\"></path><path stroke=\"currentColor\" d=\"M245 0H155V200H245M155 100H227\"></path></g></svg></a>\n<div style=\"display: flex; flex-direction: column; gap: 8px; align-items: flex-end\">\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2px; color: #9AA5AF\">LET\u2019S CONNECT</span>\n<a class=\"li-card\" href=\"https://www.linkedin.com/in/brent-eliason/\" target=\"_blank\" rel=\"noopener\" aria-label=\"Brent Eliason on LinkedIn (opens in a new tab)\" style=\"display: block; width: 44px; height: 44px; border-radius: 8px; transition: transform 0.2s ease, box-shadow 0.2s ease\"><svg aria-hidden=\"true\" width=\"44\" height=\"44\" viewBox=\"3 3 48 48\" style=\"display: block\"><rect x=\"3\" y=\"3\" width=\"48\" height=\"48\" rx=\"9\" fill=\"#0A66C2\"></rect><circle cx=\"16.5\" cy=\"16.2\" r=\"3.6\" fill=\"#FFFFFF\"></circle><rect x=\"13.4\" y=\"22.4\" width=\"6.2\" height=\"19.4\" rx=\"0.8\" fill=\"#FFFFFF\"></rect><path d=\"M24.6 22.4h5.9v2.7c1-1.8 3.2-3.2 6.2-3.2 5.2 0 7 3.2 7 8.4v11.5h-6.2V31.6c0-2.5-.5-4.4-3-4.4s-3.7 1.9-3.7 4.6v10h-6.2z\" fill=\"#FFFFFF\"></path></svg></a>\n</div>\n</div>\n<div style=\"display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 1.5px; color: #9AA5AF\">\n<span>\u00a9 2026 BRENT ELIASON</span>\n<span>BOULDER, CO</span>\n</div>\n</footer>\n\n</div>";
var FONTS = "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Instrument+Serif&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

function injectOnce(id, make) { if (!document.getElementById(id)) { var el = make(); el.id = id; document.head.appendChild(el); } }

// ---- Squarespace-aware mounting: full takeover on the live site; out of the way while you edit
function isEditing() {
  var c = (document.body && document.body.className || '') + ' ' + document.documentElement.className;
  return /sqs-edit-mode|sqs-editing|edit-mode-active/.test(c);
}
function isOff() { return /[?&]brentshow=off\b/.test(location.search); }
var HEADER_CSS = '#header,header#header,.Header,header.Header,.Mobile-bar,.Mobile-bar--top,.header-announcement-bar-wrapper{display:none!important}';
// the template footer (social links, "Powered by Squarespace") across 7.0 and 7.1 templates; the show's own footer has id="contact" and is untouched
var FOOTER_CSS = '#footer,footer#footer,.Footer,footer.Footer,#footer-sections,footer.sections,.footer-sections,[data-footer-sections],.sqs-footer,.site-footer,.Footer-blocks,.Footer-inner,#siteWrapper>footer,.Site-footer,.footer-wrapper,#footerWrapper,.sqs-announcement-bar-dropzone+footer{display:none!important}';

function mount(host) {
  if (host.__brentShow) return;
  host.__brentShow = { active: false };
  var accent = host.getAttribute('data-accent') || '#FF5B1F';
  var hideHeader = host.getAttribute('data-hide-header') !== 'false';
  var hideFooter = host.getAttribute('data-hide-footer') !== 'false';
  var takeover = host.getAttribute('data-takeover') !== 'false';

  injectOnce('brent-show-fonts', function () { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONTS; return l; });
  injectOnce('brent-show-css', function () {
    var st = document.createElement('style');
    st.textContent =
      '.brent-show-root{position:relative;width:100%;margin:0;padding:0;line-height:normal;letter-spacing:normal;text-align:left;-webkit-font-smoothing:antialiased}' +
      '.brent-show-root *{box-sizing:border-box}' +
      '.brent-show-root p,.brent-show-root h1,.brent-show-root h2{margin:0;padding:0}' +
      '.brent-show-root a{color:#15171A;text-decoration:none}.brent-show-root a:hover{color:#4A4E52}' +
      '.brent-show-root footer a{color:#EDEEE9}' +
      '.brent-show-root .li-card:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(10,102,194,.35)}.brent-show-root .li-card:focus-visible{outline:2px solid #15171A;outline-offset:3px}' +
      '.brent-show-root button{font:inherit;line-height:normal}' +
      '.brent-show-placeholder{font:500 13px/1.5 "JetBrains Mono",monospace;letter-spacing:1px;color:#15171A;background:#F2F1ED;border:1px dashed #FF5B1F;border-radius:10px;padding:18px 20px}';
    return st;
  });

  var S = host.__brentShow;
  function activate() {
    if (S.active) return;
    S.active = true;
    host.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'brent-show-root';
    root.innerHTML = MARKUP.split('__ASSET__').join(BASE).split('__ACCENT__').join(accent);
    // Squarespace sections and grids clip or pad their content; the show needs the page's own scroll and full width,
    // so on the live site it sits just before the section holding the code block and hides that section.
    S.section = null;
    var sec = takeover ? host.closest('section') : null;
    if (sec && sec.parentNode) { sec.parentNode.insertBefore(root, sec); sec.style.display = 'none'; S.section = sec; }
    else host.appendChild(root);
    S.root = root;
    if (hideHeader || hideFooter) { var hs = document.createElement('style'); hs.textContent = (hideHeader ? HEADER_CSS : '') + (hideFooter ? FOOTER_CSS : ''); document.head.appendChild(hs); S.headerStyle = hs; }
    // position: sticky stops working under any ancestor that clips overflow
    S.fixed = [];
    for (var el = root.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      var cs = getComputedStyle(el);
      if (cs.overflow !== 'visible' || cs.overflowY !== 'visible' || cs.overflowX !== 'visible') { S.fixed.push([el, el.style.overflow]); el.style.overflow = 'visible'; }
    }
    var comp = new Component({ accent: accent });
    S.comp = comp;
    var q = function (sel) { return root.querySelector(sel); };
    var vals = comp.renderVals();
    root.querySelectorAll('[data-ref]').forEach(function (n) { var fn = vals[n.getAttribute('data-ref')]; if (typeof fn === 'function') fn(n); });
    var img = q('[data-dyn="img"]'), ov = q('[data-dyn="overlay"]'), ov2 = q('[data-dyn="overlay2"]');
    var gl = q('[data-ref="glRef"]'), card = q('[data-ref="cardRef"]');
    comp._apply = function () {
      var v = comp.renderVals();
      if (img) img.style.opacity = v.imgOpacity;
      if (gl) gl.style.opacity = v.glOpacity;
      if (card) { card.style.opacity = v.cardOpacity; card.style.pointerEvents = v.cardPointer; }
      if (ov) { ov.style.opacity = v.overlayOpacity; ov.style.pointerEvents = v.overlayPointer; }
      if (ov2) ov2.style.opacity = v.overlayOpacity;
    };
    comp._apply();
    comp.componentDidMount();
  }
  function deactivate() {
    if (S.active) {
      S.active = false;
      try { S.comp.componentWillUnmount(); } catch (e) {}
      if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
      if (S.section) S.section.style.display = '';
      if (S.headerStyle && S.headerStyle.parentNode) S.headerStyle.parentNode.removeChild(S.headerStyle);
      (S.fixed || []).forEach(function (f) { f[0].style.overflow = f[1]; });
      S.root = S.comp = S.section = S.headerStyle = null; S.fixed = [];
    }
    host.innerHTML = '<div class="brent-show-placeholder">BRENT SHOW · hero, night show, map stories<br>This is the code block that loads it. The animation is paused while you edit and plays on the live site.</div>';
  }
  function sync() { if (isEditing() || isOff()) deactivate(); else activate(); }
  sync();
  // follow Squarespace switching in and out of edit mode
  try { new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
}

function boot() {
  var hosts = document.querySelectorAll('#brent-show, [data-brent-show]');
  for (var i = 0; i < hosts.length; i++) mount(hosts[i]);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
window.addEventListener('load', boot);
})();
