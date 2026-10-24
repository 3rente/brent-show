/*! brent-show.js — Brent "Duster" Eliason · hero, night drone show, orbit transition and career stories.
 *  Copyright (c) 2026 Brent Eliason. All rights reserved. Not open source: no permission is granted to copy, modify,
 *  redistribute or reuse this code or its assets, or to use them to train or improve AI/machine-learning models.
 *  See LICENSE. Third-party map data in assets/earth.json keeps its own license (see LICENSE, section 4).
 *  Mount: <div id="brent-show"></div><script src=".../brent-show.js" defer></script>
 *  Options on the div: data-accent="#FF5B1F"  data-hide-header="true"  data-takeover="true"
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
// line-art quadcopter, side view; dir = -1 faces left; tilt in radians (positive = nose down in the direction of travel)
function drawDrone(ctx, x, y, tilt, s, accent, dir) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir || 1, 1); ctx.rotate(tilt);
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.fillStyle = '#F2F1ED';
  // arms and motor pods
  ctx.beginPath(); ctx.moveTo(-22, -3); ctx.lineTo(-44, -9); ctx.moveTo(22, -3); ctx.lineTo(44, -9); ctx.stroke();
  [-44, 44].forEach(function (mx) { ctx.fillStyle = INK; ctx.fillRect(mx - 4, -15, 8, 9); });
  // spinning rotors: a blurred disc plus one blade at its current angle
  [-44, 44].forEach(function (mx, i) {
    ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.ellipse(mx, -17, 21, 2.6, 0, 0, TAU); ctx.fillStyle = INK; ctx.fill();
    ctx.globalAlpha = 0.9; var bl = 21 * Math.cos(s * 47 + i * 1.7);
    ctx.beginPath(); ctx.moveTo(mx - bl, -17); ctx.lineTo(mx + bl, -17); ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = 1;
  });
  // body
  roundRectPath(ctx, -26, -10, 52, 19, 9); ctx.fillStyle = '#F2F1ED'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(-10, -15); ctx.lineTo(10, -15); ctx.lineTo(14, -10); ctx.stroke();
  // landing legs and winch
  ctx.beginPath(); ctx.moveTo(-12, 9); ctx.lineTo(-19, 21); ctx.moveTo(-24, 21); ctx.lineTo(-14, 21);
  ctx.moveTo(12, 9); ctx.lineTo(19, 21); ctx.moveTo(14, 21); ctx.lineTo(24, 21); ctx.stroke();
  ctx.fillStyle = INK; ctx.fillRect(-5, 9, 10, 6);
  // nav light
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(s * 9); ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(24, -2, 2.6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
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
  var fill = mixRGB(KRAFT.front, [242, 241, 237], ease(morph));
  var edge = mixRGB(KRAFT.edge, [201, 198, 190], ease(morph));
  roundRectPath(ctx, fx, fy, fw, fh, lerp(1, 12, ease(morph)));
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
var DELIVERY_PX = 1600, STAGE_SHOW = 5400, TRANS_PX = 3400, STORY_PX = 4600, SPACE = [4, 6, 10];
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
  { lon: -105.27, lat: 40.02, city: 'BOULDER, CO', role: 'Nova · Global Flight Operations', side: -1 }
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
// ---- stories: scrolling through the map, each place in the career pops up where it happened
var STORIES = [
  { lon: -92.10, lat: 46.79, z: 3.2, place: 'DULUTH, MN', org: 'University of Minnesota', text: 'First autonomous flight integration.' },
  { lon: -92.10, lat: 46.72, z: 3.2, place: 'SUPERIOR, WI', org: 'EASE Drones', text: 'Pipeline right-of-way inspection using autonomous aircraft.' },
  { lon: -97.03, lat: 47.93, z: 2.6, place: 'GRAND FORKS, ND', org: 'Northern Plains UAS Test Site', text: 'Integrating drones into the national airspace.' },
  { lon: -97.40, lat: 47.95, z: 2.6, place: 'GRAND FORKS AFB, ND', org: 'EASE Drones · NASA · DOD', text: 'Research pivotal to the development of unmanned traffic management.' },
  { lon: -97.03, lat: 47.92, z: 2.6, place: 'GRAND FORKS, ND', org: 'Flytrex', text: 'The first commercial drone delivery operation in the United States.' },
  { lon: -78.64, lat: 35.78, z: 2.0, place: 'RALEIGH, NC', org: 'Flytrex', text: 'Scaled drone delivery across the Research Triangle and surrounding suburbs.' },
  { lon: -96.80, lat: 32.78, z: 2.0, place: 'DALLAS, TX', org: 'Flytrex', text: 'Continued scaling across the DFW metro, achieving FAA-approved remote BVLOS operations.' },
  { lon: -105.27, lat: 40.02, z: 1.8, place: 'BOULDER, CO', org: 'Nova Sky Stories', text: 'Scaled global drone light show operations.' }
];
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
// markers, the route flown so far, and the story card for the current place
function drawStories(f, W, H, q, m, s, accent, G) {
  var ta = smooth(0.82, 0.9, q);
  var pad = Math.max(16, W * 0.03);
  if (ta > 0.01) {
    f.globalAlpha = ta; f.fillStyle = '#9AA5AF'; f.font = '500 11px "JetBrains Mono", monospace'; f.textAlign = 'left';
    f.fillText('FLIGHT LOG · WHERE THE WORK HAPPENED', pad, pad + 74);
    // data credits required by the map sources (OpenStreetMap ODbL, GeoNames CC BY)
    f.globalAlpha = ta * 0.55; f.font = '400 10px "JetBrains Mono", monospace'; f.textAlign = 'right';
    f.fillText('MAP DATA: NATURAL EARTH · LAKES © OPENSTREETMAP CONTRIBUTORS · CITIES: GEONAMES', W - pad, H - pad * 0.6);
    f.textAlign = 'left'; f.globalAlpha = 1;
  }
  if (m <= 0) return;
  var fs = m * STORY_STEPS, cur = Math.min(STORY_STEPS - 1, Math.floor(fs)), fr = fs - cur;
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
  // markers: visited places stay lit; the current one pulses
  for (k = 0; k <= shown; k++) {
    var on = k === cur, A = k < cur ? 1 : smooth(0.25, 0.4, fr), Pk = pts[k];
    if (A < 0.01) continue;
    f.globalAlpha = A; f.fillStyle = accent;
    f.beginPath(); f.arc(Pk[0], Pk[1], on ? 6 : 4, 0, TAU); f.fill();
    f.globalAlpha = A * 0.25; f.beginPath(); f.arc(Pk[0], Pk[1], on ? 14 : 9, 0, TAU); f.fill();
    if (on) { var pl = (s * 0.6) % 1; f.globalAlpha = A * 0.7 * (1 - pl); f.strokeStyle = accent; f.lineWidth = 1.5; f.beginPath(); f.arc(Pk[0], Pk[1], 10 + pl * 26, 0, TAU); f.stroke(); }
  }
  f.globalAlpha = 1;
  if (cur >= STORIES.length) return;
  // the story card: pops up beside its marker once the camera arrives, and steps aside for the next place
  var S = STORIES[cur], P0 = pts[cur];
  var ca = smooth(0.35, 0.47, fr) * (1 - smooth(0.9, 1, fr));
  if (ca < 0.01) return;
  var pop = easeOut(smooth(0.35, 0.5, fr));
  var cw = Math.min(320, W - 2 * pad), side = P0[0] - 40 - cw > pad ? -1 : 1;   // cards sit to the left so the map east of each place stays clear
  f.font = '400 15px Inter, system-ui, sans-serif';
  var lines = wrapLines(f, S.text, cw - 40);
  var chh = 112 + lines.length * 22;
  var cx0 = side > 0 ? P0[0] + 34 : P0[0] - 34 - cw;
  var cy0 = Math.max(pad + 90, Math.min(H - pad - chh, P0[1] - chh * 0.35));
  f.save(); f.globalAlpha = ca;
  f.translate(P0[0], P0[1]); f.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop); f.translate(-P0[0], -P0[1] + (1 - pop) * 10);
  f.strokeStyle = accent; f.lineWidth = 1; f.beginPath(); f.moveTo(P0[0] + side * 8, P0[1]); f.lineTo(side > 0 ? cx0 : cx0 + cw, Math.max(cy0 + 16, Math.min(cy0 + chh - 16, P0[1]))); f.stroke();
  f.fillStyle = 'rgba(11,14,19,0.92)'; f.strokeStyle = '#2A3542';
  roundRectPath(f, cx0, cy0, cw, chh, 12); f.fill(); f.stroke();
  f.fillStyle = accent; f.fillRect(cx0 + 20, cy0 + 20, 22, 3);
  f.textAlign = 'left';
  f.fillStyle = '#9AA5AF'; f.font = '500 11px "JetBrains Mono", monospace';
  f.fillText((cur < 9 ? '0' : '') + (cur + 1) + ' / 0' + STORIES.length + '   ' + S.place, cx0 + 20, cy0 + 46);
  var tfs = 26; f.font = '800 26px "Big Shoulders Display", sans-serif';
  var tw0 = f.measureText(S.org.toUpperCase()).width; if (tw0 > cw - 40) tfs = Math.floor(26 * (cw - 40) / tw0);
  f.fillStyle = '#EDEEE9'; f.font = '800 ' + tfs + 'px "Big Shoulders Display", sans-serif';
  f.fillText(S.org.toUpperCase(), cx0 + 20, cy0 + 80);
  f.fillStyle = '#C9CFD4'; f.font = '400 15px Inter, system-ui, sans-serif';
  for (var li = 0; li < lines.length; li++) f.fillText(lines[li], cx0 + 20, cy0 + 112 + li * 22);
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
}
componentWillUnmount() {
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
  if (L.e > 0) {
    ctx.fillStyle = rgb(GROUND); ctx.fillRect(C.x, L.hl, C.w, C.y + C.h - L.hl + 2);
    var lineA = L.e * (1 - 0.6 * smooth(0.88, 0.95, p));
    var lg = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
    lg.addColorStop(0, 'rgba(255,170,110,0)'); lg.addColorStop(0.5, rgb([255, 170, 110], 0.6 * lineA)); lg.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = lg; ctx.fillRect(W * 0.1, L.hl - 0.5, W * 0.8, 1.5);
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
  if (GV && qT > 0.8) drawStories(f, W, H, qT, mS, s, this.props.accent ?? '#FF5B1F', GV);
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
    var secs = Math.floor(it), tenths = Math.floor((it - secs) * 10);
    ctx.textAlign = 'left'; ctx.fillText('SHOW CONTROL · T+' + (secs < 10 ? '0' : '') + secs + '.' + tenths + 's', pad, H - pad);
    ctx.textAlign = 'right';
    ctx.fillText(lock > 0.5 ? 'FORMATION LOCKED · ' + plan.length + ' AIRCRAFT' : (airborne ? airborne + ' / ' + plan.length + ' AIRBORNE' : 'ARMED · ' + plan.length + ' AIRCRAFT'), W - pad, H - pad);
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
    heroRef: function (n) { self.heroEl = n; },
    boxRef: function (n) { self.boxEl = n; },
    glRef: function (n) { self.glCv = n; },
    cardRef: function (n) { self.cardEl = n; },
    deliveryRef: function (n) { self.dlvCv = n; },
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
var MARKUP = "<div style=\"background: #0B0E13; color: #15171A; font-family: Inter, system-ui, sans-serif; width: 100%\">\n\n<!-- ============ PINNED STAGE: daylight hero \u2192 sunset \u2192 collapse \u2192 set \u2192 night show ============ -->\n<section data-ref=\"wrapRef\" aria-label=\"Hero and night show\" style=\"position: relative; height: 15000px; background: #0B0E13\">\n<div data-ref=\"heroRef\" style=\"position: sticky; top: 0; height: 100vh; min-height: 640px; overflow: hidden; background: #F2F1ED\">\n\n<canvas data-ref=\"skyRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 0; pointer-events: none\"></canvas>\n<canvas data-ref=\"glRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 1; pointer-events: none; opacity: 0\"></canvas>\n<div data-ref=\"boxRef\" style=\"position: absolute; left: 50%; top: 104px; width: min(100%, 980px); aspect-ratio: 1; transform: translateX(-50%); z-index: 1; pointer-events: none\">\n<img data-dyn=\"img\" src=\"__ASSET__portrait.webp\" alt=\"Portrait of Brent \u201cDuster\u201d Eliason\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; opacity: 1\">\n</div>\n<canvas data-ref=\"frontRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 3; pointer-events: none\"></canvas>\n\n<div data-dyn=\"overlay\" style=\"position: absolute; inset: 0; z-index: 5; opacity: 1; pointer-events: auto\">\n<nav aria-label=\"Primary\" style=\"position: relative; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px clamp(16px, 3vw, 32px)\">\n<a href=\"#contact\" style=\"display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; background: __ACCENT__; color: #15171A; border-radius: 10px; text-decoration: none; font-family: 'Big Shoulders Display', sans-serif; font-weight: 800; font-size: 20px; letter-spacing: 0.5px; text-transform: uppercase\">Business enquiries</a>\n<div style=\"display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 22px; font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase\">\n<a href=\"#work\" style=\"text-decoration: none; padding: 12px 0\">Work</a>\n<a href=\"#contact\" style=\"text-decoration: none; padding: 12px 0\">Contact</a>\n<a href=\"#\" aria-label=\"Brent Eliason, home\" style=\"display: inline-flex; align-items: center; padding: 6px 0; color: #15171A\"><svg width=\"52\" height=\"40\" viewBox=\"0 0 330 254\" aria-hidden=\"true\"><g transform=\"translate(62,20) skewX(-11.31)\" fill=\"none\" stroke-width=\"34\"><path stroke=\"__ACCENT__\" d=\"M0 0H55A50 50 0 0 1 55 100H25M55 100A50 50 0 0 1 55 200H0\"></path><path stroke=\"currentColor\" d=\"M245 0H155V200H245M155 100H227\"></path></g></svg></a>\n</div>\n</nav>\n\n<div style=\"position: absolute; left: 0; right: 0; top: 74px; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none\">\n<h1 style=\"margin: 0; display: flex; align-items: baseline; gap: 10px; line-height: 1\">\n<span style=\"font-family: 'Instrument Serif', serif; font-weight: 400; font-size: clamp(40px, 4.6vw, 64px); letter-spacing: -0.5px\">Brent</span>\n<span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(40px, 4.6vw, 64px); text-transform: uppercase\">Eliason</span>\n</h1>\n<p style=\"margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2.5px; color: #5E6266\">FLIGHT OPERATIONS \u00b7 AUTONOMY SINCE 2010</p>\n</div>\n\n<aside data-ref=\"cardRef\" aria-label=\"Next show\" style=\"position: absolute; left: clamp(16px, 3vw, 32px); bottom: 28px; width: 150px; box-sizing: border-box; border: 1px solid #C9C6BE; border-radius: 12px; background: #F2F1ED; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 12px 12px; text-align: center; opacity: 0; transition: opacity 0.35s ease\">\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 2px; color: #5E6266\">NEXT SHOW</span>\n<svg role=\"img\" aria-label=\"Quadcopter\" width=\"54\" height=\"54\" viewBox=\"-50 -50 100 100\" fill=\"none\" stroke=\"#15171A\" stroke-width=\"3\"><line x1=\"-24\" y1=\"-24\" x2=\"24\" y2=\"24\"></line><line x1=\"24\" y1=\"-24\" x2=\"-24\" y2=\"24\"></line><circle cx=\"-24\" cy=\"-24\" r=\"12\"></circle><circle cx=\"24\" cy=\"-24\" r=\"12\"></circle><circle cx=\"-24\" cy=\"24\" r=\"12\"></circle><circle cx=\"24\" cy=\"24\" r=\"12\"></circle><rect x=\"-8\" y=\"-8\" width=\"16\" height=\"16\" fill=\"#F2F1ED\"></rect></svg>\n<span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 800; font-size: 18px; text-transform: uppercase; line-height: 1.1\">[Upcoming show]</span>\n<span style=\"width: 100%; height: 1px; background: #C9C6BE\"></span>\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1.5px; color: #5E6266\">NOVA \u00b7 GLOBAL FLIGHT OPS</span>\n</aside>\n\n<div style=\"position: absolute; right: clamp(16px, 3vw, 32px); bottom: 28px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px\">\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2px; color: #5E6266\">SCROLL \u2193</span>\n</div>\n</div>\n\n<canvas data-ref=\"deliveryRef\" aria-hidden=\"true\" style=\"position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 6; pointer-events: none; opacity: 1\" data-dyn=\"overlay2\"></canvas>\n<h2 style=\"position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0\">When the sun goes down, the show goes up: Brent Eliason written by 3,077 drones. A Starlink train crosses the sky, and the view follows it into orbit and down onto a map, where each place in Brent\u2019s career appears as a story.</h2>\n<ol style=\"position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0\"><li>Duluth, MN, University of Minnesota: first autonomous flight integration.</li><li>Superior, WI, EASE Drones: pipeline right-of-way inspection using autonomous aircraft.</li><li>Grand Forks, ND, Northern Plains UAS Test Site: integrating drones into the national airspace.</li><li>Grand Forks Air Force Base, ND, EASE Drones, NASA, DOD: research pivotal to unmanned traffic management development.</li><li>Grand Forks, ND, Flytrex: the first commercial drone delivery operation in the United States.</li><li>Raleigh, NC, Flytrex: scaled drone delivery across the Research Triangle and surrounding suburbs.</li><li>Dallas, TX, Flytrex: continued scaling across the DFW metro, achieving FAA-approved remote BVLOS operations.</li><li>Boulder, CO, Nova Sky Stories: scaled global drone light show operations.</li></ol>\n</div>\n</section>\n\n<!-- ============ STATEMENT (night) ============ -->\n<section id=\"work\" style=\"background: #0B0E13; color: #EDEEE9; padding: clamp(80px, 10vw, 150px) clamp(16px, 4vw, 56px)\">\n<div style=\"display: flex; flex-wrap: wrap; gap: 32px 80px; max-width: 1280px; margin: 0 auto\">\n<p style=\"flex: 0 0 180px; margin: 6px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2.5px; color: #9AA5AF\">TRANSMISSION</p>\n<div style=\"flex: 1 1 560px; display: flex; flex-direction: column; gap: 28px\">\n<p style=\"margin: 0; line-height: 0.95\"><span style=\"font-family: 'Instrument Serif', serif; font-size: clamp(48px, 6vw, 92px); letter-spacing: -1px\">Spend more time </span><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(48px, 6vw, 92px); text-transform: uppercase\">doing.</span></p>\n<p style=\"margin: 0; font-size: 19px; line-height: 1.6; color: #C9CFD4; max-width: 620px\">Fifteen years putting autonomous aircraft into real airspace \u2014 FAA test ranges, neighborhood drone delivery, and now the night sky as Director of Global Flight Operations at Nova.</p>\n<div style=\"display: flex; flex-wrap: wrap; border-top: 1px solid #26323D; margin-top: 12px\">\n<div style=\"flex: 1 1 160px; padding: 18px 20px 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\">2010</span><span style=\"font-size: 13px; color: #9AA5AF\">First autopilot integration</span></div>\n<div style=\"flex: 1 1 160px; padding: 18px 20px 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\">15+</span><span style=\"font-size: 13px; color: #9AA5AF\">Years in autonomous systems</span></div>\n<div style=\"flex: 1 1 160px; padding: 18px 0 0 0; display: flex; flex-direction: column; gap: 4px\"><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: 40px; line-height: 1\">[#,###]</span><span style=\"font-size: 13px; color: #9AA5AF\">Flights &amp; shows overseen</span></div>\n</div>\n</div>\n</div>\n</section>\n\n<!-- ============ FOOTER ============ -->\n<footer id=\"contact\" style=\"background: #0B0E13; color: #EDEEE9; padding: 56px clamp(16px, 4vw, 56px) 36px; border-top: 1px solid #26323D; display: flex; flex-direction: column; gap: 40px\">\n<div style=\"display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 24px\">\n<p style=\"margin: 0; line-height: 0.9\"><span style=\"font-family: 'Instrument Serif', serif; font-size: clamp(44px, 6vw, 88px)\">Brent </span><span style=\"font-family: 'Big Shoulders Display', sans-serif; font-weight: 900; font-size: clamp(44px, 6vw, 88px); text-transform: uppercase\">Eliason</span></p>\n<div style=\"display: flex; flex-direction: column; gap: 8px; align-items: flex-start\">\n<span style=\"font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2px; color: #9AA5AF\">BUSINESS ENQUIRIES</span>\n<a href=\"#contact\" style=\"font-size: 18px; font-weight: 500; color: #EDEEE9\">[CONTACT EMAIL]</a>\n<a href=\"https://www.linkedin.com/in/brent-eliason\" style=\"font-size: 15px; color: #EDEEE9\">LinkedIn</a>\n</div>\n</div>\n<div style=\"display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 1.5px; color: #9AA5AF\">\n<span>\u00a9 2026 BRENT ELIASON</span>\n<span>CALLSIGN DUSTER \u00b7 BOULDER, CO</span>\n</div>\n</footer>\n\n</div>";
var FONTS = "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Instrument+Serif&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

function injectOnce(id, make) { if (!document.getElementById(id)) { var el = make(); el.id = id; document.head.appendChild(el); } }

// ---- Squarespace-aware mounting: full takeover on the live site; out of the way while you edit
function isEditing() {
  var c = (document.body && document.body.className || '') + ' ' + document.documentElement.className;
  return /sqs-edit-mode|sqs-editing|edit-mode-active/.test(c);
}
function isOff() { return /[?&]brentshow=off\b/.test(location.search); }
var HEADER_CSS = '#header,header#header,.Header,header.Header,.Mobile-bar,.Mobile-bar--top,.header-announcement-bar-wrapper{display:none!important}';

function mount(host) {
  if (host.__brentShow) return;
  host.__brentShow = { active: false };
  var accent = host.getAttribute('data-accent') || '#FF5B1F';
  var hideHeader = host.getAttribute('data-hide-header') !== 'false';
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
    if (hideHeader) { var hs = document.createElement('style'); hs.textContent = HEADER_CSS; document.head.appendChild(hs); S.headerStyle = hs; }
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
      if (card) card.style.opacity = v.cardOpacity;
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
