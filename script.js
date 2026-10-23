const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const token = urlParams.get("token") || "";
// ?stand=1 puts the player in the cafe stand; ?sign= is the stand's sign label.
const standOn = urlParams.get("stand") === "1";
let signLabel = urlParams.get("sign") || "";
// ?preview is the configure page's preview (never in a copied URL): it never
// hides, and shows a default song (the Song Info Card's) whenever YouTube Music
// isn't playing: 3:55 long, parked at 2:35 like the comp.
const previewMode = urlParams.has("preview");
const PREVIEW_SONG = {
    player: { trackState: 0, videoProgress: 155 },
    video: { title: "Big Iron", author: "Marty Robbins", album: "Gunfighter Ballads And Trail Songs", durationSeconds: 235,
             thumbnails: [{ url: new URL("assets/default-album-art.png", location.href).href }] }
};
const isPlayingState = (s) => !!(s && s.player && (s.player.trackState === 1 || s.player.trackState === 2));

const appId = "nuttys-ytmdesktop-widget";
const appName = "Music Player Widget";
const appVersion = "1.0.0";
let browserSourceURL = "";

if (token === "") {
    const setupContainer = document.getElementById("setupContainer");
    const authBox = document.getElementById("authorizationBox");
    if (setupContainer) setupContainer.style.display = "flex";
    if (authBox) authBox.style.display = "block";
    RequestToken();
} else {
    connectws();
}

async function RequestCode() {
    try {
        const response = await fetch("http://localhost:9863/api/v1/auth/requestcode", {
            method: "POST",
            body: JSON.stringify({ "appId": appId, "appName": appName, "appVersion": appVersion }),
            headers: { "Content-type": "application/json; charset=UTF-8" }
        });
        const data = await response.json();
        if (data.hasOwnProperty("statusCode")) {
            ShowError(data.message);
            return null;
        }
        return data;
    } catch (e) {
        ShowError("IS YOUTUBE MUSIC RUNNING?");
        return null;
    }
}

async function RequestToken() {
    const requestCode = await RequestCode();
    if (!requestCode) return;

    const authCode = requestCode.code;
    const codeEl = document.getElementById("authorizationCode");
    if (codeEl) codeEl.innerText = authCode;

    try {
        const response = await fetch("http://localhost:9863/api/v1/auth/request", {
            method: "POST",
            body: JSON.stringify({ "appId": appId, "code": authCode }),
            headers: { "Content-type": "application/json; charset=UTF-8" }
        });
        const data = await response.json();

        if (data.hasOwnProperty("statusCode")) {
            ShowError(data.message);
        } else {
            browserSourceURL = `https://eseninocafe.github.io/music-player/?token=${data.token}`;
            const btn = document.getElementById("copyURLButton");
            if (btn) {
                btn.disabled = false;
                btn.innerText = "Click to copy URL";
            }
            if (codeEl) codeEl.style.display = 'none';
            const completeEl = document.getElementById("authorizationComplete");
            if (completeEl) completeEl.style.display = 'block';
        }
    } catch (e) {
        ShowError("AUTHORIZATION FAILED");
    }
}

window.CopyToURL = function() {
    navigator.clipboard.writeText(browserSourceURL);
    const btn = document.getElementById("copyURLButton");
    if (btn) {
        btn.innerText = "Copied to clipboard!";
        btn.style.backgroundColor = "#00dd63";
        btn.style.color = "#ffffff";
        setTimeout(() => {
            btn.innerText = "Click to copy URL";
            btn.style.backgroundColor = "#ffffff";
            btn.style.color = "#181818";
        }, 3000);
    }
}

// Setup errors drop the setup screen and show in the connection pill instead.
function ShowError(msg) {
    document.getElementById("setupContainer").style.display = "none";
    clearTimeout(connectionHideTimer);
    connectionLabel.textContent = msg;
    connectionLabel.classList.remove("hidden");
}

// ── SKULL CONFIG & PRELOAD ──
const SKULL_CFG = {
    scale: 0.90,
    framesCount: 23,
    fps: 25,
    sx: 36, sy: 506, sw: 110, sh: 130,
    dx: -34, dy: -50
};

const skullFrames = [];
function preloadSkull() {
    for (let i = 0; i < SKULL_CFG.framesCount; i++) {
        const img = new Image();
        img.src = `assets/skull/Test.${String(i).padStart(5, '0')}.svg`;
        skullFrames.push(img);
    }
}
preloadSkull();
// ────────────────────────────

/* ── Boil cadence — same two knobs as the Multichat overlay ────────────────
   BOIL_FPS  — how many drawings a second (they are held in between).
   BOIL_STEP — how far the noise field moves between drawings. Simplex
              decorrelates over ~1.0 of z, so a step this size makes each redraw
              read as a fresh drawing rather than a nudge of the last one. The
              clock used to advance by noiseTimeScale/fps, about 0.04, which is
              why the line looked like it was moving instead of being redrawn.
   Time is quantised to the drawing grid, so this border turns over on the same
   beat as every other boiling outline, and the same expression serves as both
   the noise coordinate and the redraw throttle.
   Old smooth drift: fps 24, step 0.042                                      */
const BOIL_FPS = 7;
const BOIL_STEP = 0.178;

const BOIL_CFG = {
    cornerRadius: 24, strokeWidth: 8, noiseFreq: 4.2, noiseCoordScale: 0.006,
    noiseTimeScale: 1.0, noiseAmp: 1.5, divW: 240, divH: 80, divCorner: 10, padding: 32
};

// Card colours: the card tokens in style.css (the card has no dark mode).
const cardTokens = getComputedStyle(document.documentElement);
const CARD_SURFACE = cardTokens.getPropertyValue('--card-surface').trim();
const CARD_STROKE = cardTokens.getPropertyValue('--card-stroke').trim();

// Live handles, read fresh every frame, so the boil can be dialled from the
// console (or the OBS browser source's remote debugger) without a reload.
window.BOIL = {
    fps: BOIL_FPS,
    step: BOIL_STEP,
    get amp() { return BOIL_CFG.noiseAmp; },
    set amp(v) { BOIL_CFG.noiseAmp = Math.max(0, Math.min(6, v)); },
};
// Which drawing `tSec` falls on, and where that drawing sits in the noise field.
const boilIndexAt = (tSec) => Math.floor(tSec * BOIL.fps);
const boilZ = (idx) => idx * BOIL.step;

const Simplex3D = (function () {
    const F3 = 1.0 / 3.0, G3 = 1.0 / 6.0;
    const p = new Uint8Array([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]);
    const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = (perm[i] % 12); }
    function grad(hash, x, y, z) {
        const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    return function (xin, yin, zin) {
        let n0, n1, n2, n3;
        const s = (xin + yin + zin) * F3; const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
        const t = (i + j + k) * G3; const X0 = i - t, Y0 = j - t, Z0 = k - t;
        const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; } else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; } else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
        } else {
            if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; } else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; } else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
        }
        const x1=x0-i1+G3, y1=y0-j1+G3, z1=z0-k1+G3;
        const x2=x0-i2+2.0*G3, y2=y0-j2+2.0*G3, z2=z0-k2+2.0*G3;
        const x3=x0-1.0+3.0*G3, y3=y0-1.0+3.0*G3, z3=z0-1.0+3.0*G3;
        const ii=i&255, jj=j&255, kk=k&255;
        let t0=0.6-x0*x0-y0*y0-z0*z0; if(t0<0) n0=0.0; else { t0*=t0; n0=t0*t0*grad(permMod12[ii+perm[jj+perm[kk]]],x0,y0,z0); }
        let t1=0.6-x1*x1-y1*y1-z1*z1; if(t1<0) n1=0.0; else { t1*=t1; n1=t1*t1*grad(permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]],x1,y1,z1); }
        let t2=0.6-x2*x2-y2*y2-z2*z2; if(t2<0) n2=0.0; else { t2*=t2; n2=t2*t2*grad(permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]],x2,y2,z2); }
        let t3=0.6-x3*x3-y3*y3-z3*z3; if(t3<0) n3=0.0; else { t3*=t3; n3=t3*t3*grad(permMod12[ii+1+perm[jj+1+perm[kk+1]]],x3,y3,z3); }
        return 32.0*(n0+n1+n2+n3);
    };
})();

function boilBuildBasePath(W, H, R) {
    const pts = []; const { divW, divH, divCorner } = BOIL_CFG;
    for (let i = 0; i < divW; i++) pts.push({ x: R + (W - 2 * R) * (i / divW), y: 0 });
    for (let i = 0; i < divCorner; i++) pts.push({ x: W - R + R * Math.cos(-Math.PI / 2 + (Math.PI / 2) * (i / divCorner)), y: R + R * Math.sin(-Math.PI / 2 + (Math.PI / 2) * (i / divCorner)) });
    for (let i = 0; i < divH; i++) pts.push({ x: W, y: R + (H - 2 * R) * (i / divH) });
    for (let i = 0; i < divCorner; i++) pts.push({ x: W - R + R * Math.cos((Math.PI / 2) * (i / divCorner)), y: H - R + R * Math.sin((Math.PI / 2) * (i / divCorner)) });
    for (let i = 0; i < divW; i++) pts.push({ x: W - R - (W - 2 * R) * (i / divW), y: H });
    for (let i = 0; i < divCorner; i++) pts.push({ x: R + R * Math.cos(Math.PI / 2 + (Math.PI / 2) * (i / divCorner)), y: H - R + R * Math.sin(Math.PI / 2 + (Math.PI / 2) * (i / divCorner)) });
    for (let i = 0; i < divH; i++) pts.push({ x: 0, y: H - R - (H - 2 * R) * (i / divH) });
    for (let i = 0; i < divCorner; i++) pts.push({ x: R + R * Math.cos(Math.PI + (Math.PI / 2) * (i / divCorner)), y: R + R * Math.sin(Math.PI + (Math.PI / 2) * (i / divCorner)) });
    return pts;
}

// `out` is a scratch array reused across frames. The .map() this replaced built a
// fresh 680-object array on every tick — ~41k short-lived objects a second, which
// is a steady stream of garbage for a loop that never needs the old points again.
function boilDeformPath(base, time, seed, out) {
    const freq = BOIL_CFG.noiseFreq * BOIL_CFG.noiseCoordScale, t = time * BOIL_CFG.noiseTimeScale;
    for (let i = 0; i < base.length; i++) {
        const p = base[i];
        const o = out[i] || (out[i] = { x: 0, y: 0 });
        o.x = p.x + Simplex3D(p.x * freq + seed, p.y * freq + seed, t) * BOIL_CFG.noiseAmp;
        o.y = p.y + Simplex3D(p.x * freq + seed + 99.9, p.y * freq + seed + 99.9, t) * BOIL_CFG.noiseAmp;
    }
    return out;
}

// Build the smoothed outline ONCE per draw and hand the same Path2D to every
// fill and stroke the frame needs. Tracing straight into the context meant
// replaying all 680 quadraticCurveTo calls again for the black outline over the
// shape that had just been filled, and again for the white pass during the
// intro — the context rebuilds its path from scratch after every beginPath(), so
// it had no way to know it was being handed the identical curve each time.
function boilBuildSmoothPath(pts) {
    const path = new Path2D();
    if (pts.length < 3) return path;
    let p1 = pts[0];
    path.moveTo((pts[pts.length - 1].x + p1.x) / 2, (pts[pts.length - 1].y + p1.y) / 2);
    for (let i = 0; i < pts.length; i++) {
        p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        path.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    path.closePath();
    return path;
}

let eraserPts = null;

function getEraserPath(W, H, P) {
    if (eraserPts) return eraserPts;
    eraserPts = [];
    const startX = -P - 80;
    const startY = -P - 80;
    const maxDim = Math.max(W, H) + P * 2 + 160;

    const basePts = [];
    // 24 zigzags 550–600px out reach across the stand's 544px card; a card filling
    // a wide source gets more of them, reaching further, so none of it is missed.
    const zigzags = Math.max(24, Math.round(maxDim / 32));
    for (let i = 0; i <= zigzags; i++) {
        let t = i / zigzags;
        let bx = startX + t * maxDim;
        let by = startY + t * maxDim;
        let offset = (i % 2 === 0) ? 1 : -1;
        let amp = Math.max(550, (W + P * 2) * 0.75) + Math.random() * 50;
        if (i === 0 || i === zigzags) amp = 0;
        let px = 0.707;
        let py = -0.707;
        basePts.push({ x: bx + px * amp * offset, y: by + py * amp * offset });
    }

    const detailSteps = 8;
    let totalLength = 0;
    for (let i = 0; i < basePts.length - 1; i++) {
        let p1 = basePts[i];
        let p2 = basePts[i + 1];
        for (let j = 0; j < detailSteps; j++) {
            let t = j / detailSteps;
            let x = p1.x + (p2.x - p1.x) * t;
            let y = p1.y + (p2.y - p1.y) * t;
            x += (Math.random() - 0.5) * 15;
            y += (Math.random() - 0.5) * 15;
            let pt = { x, y };
            if (eraserPts.length > 0) {
                let lastPt = eraserPts[eraserPts.length - 1];
                totalLength += Math.hypot(x - lastPt.x, y - lastPt.y);
            }
            pt.dist = totalLength;
            eraserPts.push(pt);
        }
    }
    let lastBase = basePts[basePts.length - 1];
    totalLength += Math.hypot(lastBase.x - eraserPts[eraserPts.length - 1].x, lastBase.y - eraserPts[eraserPts.length - 1].y);
    eraserPts.push({ x: lastBase.x, y: lastBase.y, dist: totalLength });
    eraserPts.totalLength = totalLength;
    return eraserPts;
}

function initEraserMask() {
    if (document.getElementById('eraser-mask-svg')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'eraser-mask-svg';
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.pointerEvents = 'none';
    svg.innerHTML = `
        <defs>
            <mask id="eraser-mask" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1000" height="500">
                <rect x="-200" y="-200" width="1000" height="500" fill="white" />
                <path id="eraser-path" fill="none" stroke="black" stroke-width="160" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
        </defs>
    `;
    document.body.appendChild(svg);
}

/* The mask only does anything during the outro, but leaving it bound to the
   wrapper for the whole session made Chromium push the entire card subtree
   through a masking pass on every repaint — to apply a mask that is a plain
   white rectangle whenever the eraser path is empty. Bind it while erasing,
   drop it the rest of the time. */
let eraserMaskOn = false;
function setEraserMaskActive(on) {
    if (on === eraserMaskOn) return;
    const wrapper = document.querySelector('.sub-card-wrapper');
    if (!wrapper) return;
    eraserMaskOn = on;
    const v = on ? 'url(#eraser-mask)' : '';
    wrapper.style.mask = v;
    wrapper.style.webkitMask = v;
}

window.widgetAnimState = 'HIDDEN';
window.widgetAnimStartTime = performance.now();

window.setWidgetVisibility = function(visible) {
    if (visible && (window.widgetAnimState === 'HIDDEN' || window.widgetAnimState === 'DISAPPEARING')) {
        window.widgetAnimState = 'APPEARING';
        window.widgetAnimStartTime = performance.now();
        eraserPts = null;
        setEraserMaskActive(false);
        const eraserPathEl = document.getElementById('eraser-path');
        if (eraserPathEl) eraserPathEl.setAttribute('d', '');
    } else if (!visible && (window.widgetAnimState === 'VISIBLE' || window.widgetAnimState === 'APPEARING')) {
        window.widgetAnimState = 'DISAPPEARING';
        window.widgetAnimStartTime = performance.now();
        setEraserMaskActive(true);
    }
}

// Returns setSize(W, H): the card's size comes from the page layout (without the
// stand it fills the source's width), so the canvases, the outline and the
// eraser are rebuilt whenever it changes.
function initBoilingBorder(canvas) {
    if (!canvas) return () => {};
    const P = BOIL_CFG.padding, R = BOIL_CFG.cornerRadius;
    let contentW = 0, contentH = 0, cw = 0, ch = 0, basePath = [];

    const ctx = canvas.getContext('2d');

    // ─── SKULL CANVAS SETUP ───
    let skullCanvas = document.getElementById('skullOverlayCanvas');
    if (!skullCanvas) {
        skullCanvas = document.createElement('canvas');
        skullCanvas.id = 'skullOverlayCanvas';
        skullCanvas.className = canvas.className;
        skullCanvas.style.backgroundColor = 'transparent';
        skullCanvas.style.backgroundImage = 'none';
        skullCanvas.style.boxShadow = 'none';
        skullCanvas.style.border = 'none';
        skullCanvas.style.pointerEvents = 'none'; 
        skullCanvas.style.zIndex = '100';
        canvas.parentElement.insertBefore(skullCanvas, canvas.nextSibling);
    }
    const skullCtx = skullCanvas.getContext('2d');
    // ─────────────────────────

    let seed = Math.random() * 1000;
    const contentEl = document.querySelector('.sub-card-content');
    initEraserMask();
    // initEraserMask has just put this in the document, so look it up once here
    // rather than doing a getElementById on every frame of the loop below.
    const eraserPathEl = document.getElementById('eraser-path');
    const eraserMaskEl = document.getElementById('eraser-mask');
    let hiddenSettled = false;   // has the HIDDEN state already been wiped to screen?
    const deformScratch = [];    // reused by boilDeformPath, see the note there
    let lastDrawnIdx = -1;       // which drawing the border canvas currently holds
    let introHoldIdx = null;     // the one drawing held through the appear animation
    let skullDrawnIdx = -1, skullDrawnAlpha = -1;   // what the skull canvas currently holds

    function setSize(W, H) {
        if (W === contentW && H === contentH) return;
        contentW = W; contentH = H;
        cw = W + P * 2; ch = H + P * 2;
        const dpr = window.devicePixelRatio || 1;
        for (const [c, c2d] of [[canvas, ctx], [skullCanvas, skullCtx]]) {
            c.width = cw * dpr;
            c.height = ch * dpr;
            c.style.width = cw + 'px';
            c.style.height = ch + 'px';
            c2d.setTransform(dpr, 0, 0, dpr, 0, 0);   // resizing a canvas resets it
        }
        basePath = boilBuildBasePath(W, H, R);
        eraserPts = null;   // the outro's scribble is sized to the card too
        // The eraser mask has to cover the card and the canvases around it.
        for (const el of [eraserMaskEl, eraserMaskEl.firstElementChild]) {
            el.setAttribute('x', -P - 200);
            el.setAttribute('y', -P - 200);
            el.setAttribute('width', cw + 400);
            el.setAttribute('height', ch + 400);
        }
        lastDrawnIdx = -1;    // repaint the border...
        skullDrawnIdx = -1;   // ...and the skull at the new size
    }

    const STROKE_DUR = 1200;
    const FADE_DELAY = 300;
    const FADE_DUR = 500;
    const TOTAL_ANIM_DUR = Math.max(STROKE_DUR, FADE_DELAY + FADE_DUR);
    const OUTRO_DUR = 1500;

    function tick(ts) {
        let elapsed = ts - window.widgetAnimStartTime;

        // PREVENT GLITCH: Check end of disappearing animation immediately!
        if (window.widgetAnimState === 'DISAPPEARING' && elapsed >= OUTRO_DUR) {
            window.widgetAnimState = 'HIDDEN';
            seed = Math.random() * 1000;
            eraserPts = null;
            setEraserMaskActive(false);
        }

        // Between songs the widget sits HIDDEN, and this loop was still clearing two
        // full-size canvases, re-querying the eraser path and re-writing the same two
        // values sixty times a second for nothing. Both canvases and the mask only
        // need wiping once on the way in; after that a hidden widget costs a single
        // comparison per frame until it's asked to come back.
        if (window.widgetAnimState === 'HIDDEN') {
            if (!hiddenSettled) {
                hiddenSettled = true;
                ctx.clearRect(-50, -50, cw + 100, ch + 100);
                skullCtx.clearRect(-50, -50, cw + 100, ch + 100);
                skullDrawnIdx = -1;   // canvas is empty; force a repaint on the way back
                introHoldIdx = null;  // next appearance picks its own held drawing
                lastDrawnIdx = -1;
                if (contentEl) contentEl.style.opacity = 0;
                if (eraserPathEl) eraserPathEl.setAttribute('d', ''); // Clear mask fully
            }
            requestAnimationFrame(tick);
            return;
        }
        hiddenSettled = false;

        // Which skull frame, and how solid, on this tick — worked out before
        // anything is wiped. Once the widget is VISIBLE the answer is identical
        // every tick, and re-rasterising the same SVG sixty times a second to
        // paint the same picture was the most wasteful thing in this loop.
        let skullAlpha = 1;
        let skullFrameIdx = SKULL_CFG.framesCount - 1;   // default: final frame
        if (window.widgetAnimState === 'APPEARING') {
            const fadeT = Math.min(1, Math.max(0, (elapsed - FADE_DELAY) / FADE_DUR));
            skullAlpha = fadeT * fadeT * (3 - 2 * fadeT);   // sync with the border fade
            skullFrameIdx = Math.min(SKULL_CFG.framesCount - 1, Math.floor((elapsed / 1000) * SKULL_CFG.fps));
        }
        // The outro erases into the skull canvas each frame, so it always repaints.
        const skullChanged = window.widgetAnimState !== 'VISIBLE'
            || skullFrameIdx !== skullDrawnIdx || skullAlpha !== skullDrawnAlpha;

        // Which drawing this frame gets. Through the appear animation the widget
        // holds ONE drawing: the line draws itself on and settles before it starts
        // boiling, rather than wobbling its way in. Afterwards it follows the same
        // shared beat as every other boiling outline.
        let boilIdx;
        if (window.widgetAnimState === 'APPEARING') {
            if (introHoldIdx === null) introHoldIdx = boilIndexAt(ts / 1000);
            boilIdx = introHoldIdx;
        } else {
            introHoldIdx = null;
            boilIdx = boilIndexAt(ts / 1000);
        }

        // Settled and nothing else on the canvas is moving: if the drawing hasn't
        // turned over there is nothing new to paint. The intro and outro fall
        // through every frame — the dash offset and the eraser are animating, and
        // those are the parts where smoothness actually shows.
        if (window.widgetAnimState === 'VISIBLE' && !skullChanged && boilIdx === lastDrawnIdx) {
            requestAnimationFrame(tick);
            return;
        }
        lastDrawnIdx = boilIdx;

        // Clear slightly larger area to prevent any out-of-bound pixel artifacts from the skull
        ctx.clearRect(-50, -50, cw + 100, ch + 100);
        if (skullChanged) skullCtx.clearRect(-50, -50, cw + 100, ch + 100);

        ctx.save();
        skullCtx.save(); // Save skull context

        ctx.translate(P, P);
        skullCtx.translate(P, P); // Translate skull context

        const borderPath = boilBuildSmoothPath(boilDeformPath(basePath, boilZ(boilIdx), seed, deformScratch));
        ctx.lineWidth = BOIL_CFG.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // ── DRAW SKULL ──
        if (skullChanged) {
            skullDrawnIdx = skullFrameIdx;
            skullDrawnAlpha = skullAlpha;
            const frame = skullFrames[skullFrameIdx];
            if (frame && frame.complete && skullAlpha > 0) {
                try {
                    skullCtx.save();
                    skullCtx.globalAlpha = skullAlpha;
                    skullCtx.drawImage(
                        frame,
                        SKULL_CFG.sx, SKULL_CFG.sy, SKULL_CFG.sw, SKULL_CFG.sh,
                        SKULL_CFG.dx, SKULL_CFG.dy,
                        SKULL_CFG.sw * SKULL_CFG.scale, SKULL_CFG.sh * SKULL_CFG.scale
                    );
                    skullCtx.restore();
                } catch (err) {}
            }
        }
        // ─────────────────────────────────────────────────────────────

        if (window.widgetAnimState === 'APPEARING') {
            if (elapsed >= TOTAL_ANIM_DUR) {
                window.widgetAnimState = 'VISIBLE';
                elapsed = TOTAL_ANIM_DUR;
            }
            const strokeT = Math.min(1, Math.max(0, elapsed / STROKE_DUR));
            const strokeProgress = 1 - Math.pow(1 - strokeT, 3);
            const fadeT = Math.min(1, Math.max(0, (elapsed - FADE_DELAY) / FADE_DUR));
            const smoothFade = fadeT * fadeT * (3 - 2 * fadeT);

            if (strokeProgress < 1) {
                const dashLen = 3000;
                const actualLen = 1500;
                const startOffset = dashLen + 20;
                ctx.setLineDash([dashLen, dashLen]);
                ctx.lineDashOffset = startOffset - (actualLen + 20) * strokeProgress;
            } else {
                ctx.setLineDash([]);
            }

            ctx.globalAlpha = smoothFade;
            ctx.fillStyle = CARD_SURFACE;
            ctx.strokeStyle = CARD_SURFACE;
            ctx.fill(borderPath);
            ctx.stroke(borderPath);
            ctx.globalAlpha = 1;

            if (contentEl) contentEl.style.opacity = smoothFade;

            ctx.strokeStyle = CARD_STROKE;
            ctx.stroke(borderPath);

        } else if (window.widgetAnimState === 'VISIBLE' || window.widgetAnimState === 'DISAPPEARING') {
            ctx.setLineDash([]);
            ctx.fillStyle = CARD_SURFACE;
            ctx.strokeStyle = CARD_SURFACE;
            ctx.fill(borderPath);
            ctx.stroke(borderPath);

            ctx.strokeStyle = CARD_STROKE;
            ctx.stroke(borderPath);

            if (contentEl && contentEl.style.opacity !== "1") {
                contentEl.style.opacity = 1;
            }

            if (window.widgetAnimState === 'DISAPPEARING') {
                let outroP = Math.max(0, Math.min(1, elapsed / OUTRO_DUR));
                let easeP = outroP < 0.5 ? 2 * outroP * outroP : 1 - Math.pow(-2 * outroP + 2, 2) / 2;
                easeP = Math.max(0, Math.min(1, easeP));

                let pts = getEraserPath(contentW, contentH, P);
                let targetDist = easeP * pts.totalLength;
                let d = "";
                if (pts.length > 0) {
                    d += `M ${pts[0].x} ${pts[0].y}`;
                    for (let i = 1; i < pts.length; i++) {
                        if (pts[i].dist <= targetDist) {
                            d += ` L ${pts[i].x} ${pts[i].y}`;
                        } else {
                            let prev = pts[i - 1], curr = pts[i];
                            let segmentLen = curr.dist - prev.dist;
                            if (segmentLen > 0) {
                                let t = (targetDist - prev.dist) / segmentLen;
                                let x = prev.x + (curr.x - prev.x) * t;
                                let y = prev.y + (curr.y - prev.y) * t;
                                d += ` L ${x} ${y}`;
                            }
                            break;
                        }
                    }
                }

                if (eraserPathEl) {   // resolved once in initBoilingBorder
                    eraserPathEl.setAttribute('d', d);
                    const jx = (Math.random() - 0.5) * 2;
                    const jy = (Math.random() - 0.5) * 2;
                    eraserPathEl.setAttribute('transform', `translate(${jx}, ${jy})`);
                }

                // Erase Border
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                const p = new Path2D(d);
                const randTx = (Math.random() - 0.5) * 2;
                const randTy = (Math.random() - 0.5) * 2;

                ctx.save();
                ctx.translate(randTx, randTy);
                ctx.lineWidth = 140;
                ctx.stroke(p);
                ctx.lineWidth = 160;
                ctx.stroke(p);
                ctx.restore();
                ctx.globalCompositeOperation = 'source-over';

                // Erase Skull
                skullCtx.globalCompositeOperation = 'destination-out';
                skullCtx.lineCap = 'round';
                skullCtx.lineJoin = 'round';

                skullCtx.save();
                skullCtx.translate(randTx, randTy); // Use same jitter for coherence
                skullCtx.lineWidth = 140;
                skullCtx.stroke(p);
                skullCtx.lineWidth = 160;
                skullCtx.stroke(p);
                skullCtx.restore();
                skullCtx.globalCompositeOperation = 'source-over';
            }
        }

        ctx.restore();
        skullCtx.restore();

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return setSize;
}

const state = {
    currentSecs: 0,
    durationSeconds: 0,
    isPlaying: false,
    lastUpdateTime: performance.now(),
    scrollStartTime: null
};

const timeCurrentEl = document.getElementById('timeCurrent');
const timeRemainingEl = document.getElementById('timeRemaining');
const progressThumbEl = document.getElementById('progressThumb');
const borderCanvasEl = document.querySelector('.sub-border-canvas');

const titleEl = document.getElementById('trackTitle');
const artistEl = document.getElementById('trackArtist');
const progressContainer = document.getElementById('progressContainer');
const progressSvg = document.getElementById('progressSvg');
const progressPath = document.getElementById('progressPath');

/* ═══════════════════════════════════════════════════════════════════
   SMOOTH-WRAP MARQUEE — title + artist, ported from the Music Card
   (MusicUIRender/app.js). Two copies wrap seamlessly: rest at home, cruise once
   around (through the end and the wrapped start) at a shared ease-in →
   cruise → ease-out pace, land back at home, loop. A soft edge fade
   (written inline per frame) masks the clipped ends. Both lines share one
   clock, sized by the longest line, so they move and loop together.
   ═══════════════════════════════════════════════════════════════════ */
const MQ = { speed: 50, easeMs: 650, pauseStart: 2000, smoothGap: 32, fadePx: 12 }; // px/s · accel/decel ms · rest ms · copy gap · fade ramp px
const V_CRUISE = MQ.speed / 1000;        // px per ms
const A_RAMP = V_CRUISE / MQ.easeMs;     // px per ms² (fixed accel/decel)
function mqScrollMs(D) {                   // total time to travel distance D
    if (D <= 0) return 0;
    if (D >= V_CRUISE * MQ.easeMs) return D / V_CRUISE + MQ.easeMs;  // trapezoid
    return 2 * Math.sqrt(D / A_RAMP);      // triangle (too short to reach cruise)
}
function mqTravel(D, st) {                  // how far distance-D has moved st ms in
    if (D <= 0 || st <= 0) return 0;
    const T = mqScrollMs(D); if (st >= T) return D;
    if (D >= V_CRUISE * MQ.easeMs) {        // trapezoid
        const E = MQ.easeMs;
        if (st < E) return 0.5 * A_RAMP * st * st;
        if (st < T - E) return 0.5 * V_CRUISE * E + V_CRUISE * (st - E);
        const q = T - st; return D - 0.5 * A_RAMP * q * q;
    }
    const half = T / 2;                    // triangle
    if (st < half) return 0.5 * A_RAMP * st * st;
    const q = T - st; return D - 0.5 * A_RAMP * q * q;
}

function makeLineMarquee(winEl, innerEl) {
    innerEl.style.gap = MQ.smoothGap + 'px';
    return { win: winEl, inner: innerEl, copies: innerEl.querySelectorAll('.mq-copy'), text: null, O: 0, unit: 0 };
}
const titleMq = makeLineMarquee(document.querySelector('.title-wrapper'), titleEl);
const artistMq = makeLineMarquee(document.querySelector('.artist-wrapper'), artistEl);
let mqGroupCycle = MQ.pauseStart;

// Fill both copies; returns true if the text actually changed.
function setLineText(m, text) {
    text = text || '';
    if (m.text === text) return false;
    m.text = text;
    m.copies[0].textContent = text;
    m.copies[1].textContent = text;
    return true;
}
// Read layout once per song change (not per frame): O = overflow, unit = one full wrap.
function measureMarquees() {
    for (const m of [titleMq, artistMq]) {
        const copyW = m.copies[0].offsetWidth;
        m.O = Math.max(0, Math.round(copyW - m.win.clientWidth));
        m.unit = copyW + MQ.smoothGap;
        m.copies[1].style.display = m.O > 0 ? '' : 'none';  // hide the 2nd copy unless it overflows
    }
    let maxUnit = 0;
    if (titleMq.O > 0) maxUnit = Math.max(maxUnit, titleMq.unit);
    if (artistMq.O > 0) maxUnit = Math.max(maxUnit, artistMq.unit);
    mqGroupCycle = MQ.pauseStart + mqScrollMs(maxUnit);
}
// off ≤ 0; l fades the left edge (ramps as text scrolls off), r the right (always on while overflowing).
// The mask gradient is the one genuinely expensive write here — changing mask-image
// forces Chromium to repaint the window every frame, which is painful when the
// browser source is rasterising on the CPU. The fade only actually ramps over the
// first / last MQ.fadePx of travel; through the 2s rest and the whole cruise both
// edges sit pinned at their end values, so remembering the last string written
// collapses the vast majority of frames to no write at all.
function setLineFade(m, l, r) {
    let g;
    if (m.O <= 0) g = 'none';
    else {
        const lp = (l * MQ.fadePx).toFixed(2), rp = (r * MQ.fadePx).toFixed(2);
        g = `linear-gradient(90deg, transparent 0, #000 ${lp}px, #000 calc(100% - ${rp}px), transparent 100%)`;
    }
    if (g === m._mask) return;
    m._mask = g;
    m.win.style.webkitMaskImage = g;
    m.win.style.maskImage = g;
}
// Same idea for the transform: parked frames (and the tail of the ease, where
// successive frames differ by far less than 1/100 px) skip the write entirely.
function setLineOffset(m, off) {
    const v = Math.round(off * 100) / 100;
    if (v === m._off) return;
    m._off = v;
    m.inner.style.transform = `translateX(${v}px)`;
}
function tickLineMarquee(m, timeMs) {
    if (m.O <= 0) { setLineOffset(m, 0); setLineFade(m, 0, 0); return; }
    const t = timeMs % mqGroupCycle;
    // -unit ≡ home (the 2nd copy lands exactly where the 1st began → seamless loop).
    const off = t < MQ.pauseStart ? 0 : -mqTravel(m.unit, t - MQ.pauseStart);
    setLineOffset(m, off);
    const d = Math.min(-off, m.unit + off);   // distance from whichever home edge is nearest
    setLineFade(m, Math.max(0, Math.min(1, d / MQ.fadePx)), 1);
}
// Re-measure once the web font loads (glyph widths shift when Inter swaps in).
// (the time labels resize with the font too, which moves the progress bar — so
// re-read its cached width on the same signal)
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureMarquees(); refreshProgressWidth(); });

/* ── Song-change fade reset ─────────────────────────────────────────
   Ported from the Multichat overlay's username fade-swap: when the track
   changes, fade the title + artist OUT, swap in the new text at the home
   position, then fade them back IN. This also guarantees the smooth-wrap
   scroll restarts cleanly from the beginning for every new song, instead
   of the text popping in mid-scroll. */
const MQ_RESET_FADE_MS = 200;   // fade-out / fade-in half-durations (ms)
let mqReset = null;             // active transition { phase, start, title, artist } or null
let songKey = '';               // identity of the shown/transitioning track text

function applySongText(title, artist) {
    setLineText(titleMq, title);
    setLineText(artistMq, artist);
    measureMarquees();
    state.scrollStartTime = null;   // restart the shared scroll clock at home
}

function startSongTextReset(title, artist) {
    if (!titleMq.text && !artistMq.text) {
        // First song: nothing on screen to fade out — show it and just fade in.
        applySongText(title, artist);
        mqReset = { phase: 'in', start: performance.now() };
    } else {
        // Keep the old text visible; fade it out, swap at the bottom, fade in.
        mqReset = { phase: 'out', start: performance.now(), title, artist };
    }
}

// Advance the fade-reset one frame; returns the current text opacity (0→1).
function tickSongTextReset() {
    if (!mqReset) return 1;
    const p = Math.min(1, (performance.now() - mqReset.start) / MQ_RESET_FADE_MS);
    if (mqReset.phase === 'out') {
        if (p >= 1) {
            applySongText(mqReset.title, mqReset.artist);   // swap new text in at home
            mqReset = { phase: 'in', start: performance.now() };
            return 0;
        }
        return 1 - p;
    }
    // phase 'in'
    if (p >= 1) { mqReset = null; return 1; }
    return p;
}

const setBoilSize = initBoilingBorder(borderCanvasEl);

let currentState = -1;
let hideDebounceTimeout = null;

function ConvertSeconds(time) {
    if (!time || time < 0 || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.trunc(time - minutes * 60);
    return `${minutes}:${('0' + seconds).slice(-2)}`;
}

// The label at the bottom (the chat box's): NOT CONNECTED until YTMDesktop connects,
// then CONNECTED for a moment before it fades. Built here rather than in index.html,
// so a cached old page paired with this script can't break it.
const connectionLabel = document.createElement('div');
connectionLabel.id = 'connectionLabel';
connectionLabel.textContent = 'NOT CONNECTED';
if (!previewMode) document.body.appendChild(connectionLabel);
let connectionHideTimer = 0;
function SetConnectionStatus(connected) {
    if (previewMode) {   // no label in the preview; losing YTMDesktop falls back to the default song
        if (!connected) UpdatePlayer(PREVIEW_SONG);
        return;
    }
    clearTimeout(connectionHideTimer);
    connectionLabel.textContent = connected ? 'CONNECTED' : 'NOT CONNECTED';
    connectionLabel.classList.remove('hidden');
    if (connected) connectionHideTimer = setTimeout(() => connectionLabel.classList.add('hidden'), 2000);
    else window.setWidgetVisibility(false);
}

function UpdatePlayer(stateData) {
    if (!stateData || !stateData.player || !stateData.video) return;
    const songInfo = stateData.video;
    const player = stateData.player;

    state.durationSeconds = songInfo.durationSeconds || 0;
    
    const serverSecs = player.videoProgress || 0;
    const incomingTitle = songInfo.title || '';
    // Figma's second line is "Artist - Album" (just the artist when there's no album)
    const incomingArtist = [songInfo.author, songInfo.album].filter(Boolean).join(' - ');
    const incomingKey = incomingTitle + '␟' + incomingArtist;
    const songChanged = incomingKey !== songKey;
    const stateChanged = player.trackState !== currentState;
    
    let localSecs = state.currentSecs;
    if (state.isPlaying) {
        const elapsedMs = performance.now() - state.lastUpdateTime;
        localSecs += elapsedMs / 1000;
    }
    
    const drift = Math.abs(serverSecs - localSecs);
    
    if (songChanged || stateChanged || drift > 2) {
        state.currentSecs = serverSecs;
        state.lastUpdateTime = performance.now();
    }

    if (songInfo.thumbnails && songInfo.thumbnails.length > 0) {
        const thumbnail = songInfo.thumbnails[songInfo.thumbnails.length - 1].url;
        const albumArtEl = document.getElementById("albumArt");
        if (albumArtEl && albumArtEl.src !== thumbnail) albumArtEl.src = thumbnail;
    }

    // On a genuine track change, run the fade reset: the title + artist fade
    // out, swap to the new text at the home position, then fade back in.
    if (songChanged) {
        songKey = incomingKey;
        startSongTextReset(incomingTitle, incomingArtist);
    }

    if (player.trackState !== currentState) {
        clearTimeout(hideDebounceTimeout);

        if (player.trackState === 1 || player.trackState === 2) {
            // 1 = playing, 2 = buffering while a track loads (e.g. when you skip
            // or a new song starts right after another). Keep the widget visible
            // for both so track changes stay seamless and the intro animation
            // never replays mid-skip.
            window.setWidgetVisibility(true);
            state.isPlaying = (player.trackState === 1);
        } else {
            // Genuinely paused/stopped: run the outro after a short debounce so
            // it reacts promptly instead of waiting a long time.
            state.isPlaying = false;
            if (previewMode) window.setWidgetVisibility(true);   // the preview stays up
            else hideDebounceTimeout = setTimeout(() => {
                window.setWidgetVisibility(false);
            }, 400);
        }
        currentState = player.trackState;
    }
}

function connectws() {
    if (typeof io === 'undefined') return setTimeout(connectws, 1000);

    const socket = io("http://localhost:9863/api/v1/realtime", {
        transports: ['websocket'],
        auth: { token: token }
    });

    socket.on("state-update", (stateData) => {
        UpdatePlayer(previewMode && !isPlayingState(stateData) ? PREVIEW_SONG : stateData);
    });

    socket.on('connect', function () {
        SetConnectionStatus(true);
    });

    socket.on('disconnect', function () {
        SetConnectionStatus(false);
        setTimeout(connectws, 5000);
    });
}

// Cached, because the progress bar's width has to be read back out of layout and
// doing that every frame — right after the marquee has written transforms and
// masks — forces a synchronous style+layout pass on every single frame. The
// container is a flex-grow child sitting between the two time labels, so its width
// only actually moves when a label's text changes (see the refresh below).
let progressContainerW = 0;
let lastTimeCurrentText = null, lastTimeRemainingText = null, lastTextOpacity = null;
// The sine under the progress wave runs at about 0.6Hz, so redrawing it on twos is
// indistinguishable — and each redraw is a fresh path string, an SVG re-parse and a
// repaint of the bar, which is the second-biggest per-frame cost here after the border.
const WAVE_FRAME_MS = 1000 / 30;
let lastWaveDraw = -1e9, lastThumbX = -1;
function refreshProgressWidth() { if (progressContainer) progressContainerW = progressContainer.clientWidth; }

function updateUI(ts) {
    if (state.scrollStartTime === null) state.scrollStartTime = ts;
    const timeMs = ts - state.scrollStartTime;

    // Nothing is on screen while the widget is hidden, so skip every DOM write.
    // The clocks keep running off `ts` / performance.now(), so the marquee and the
    // song-change fade pick straight back up in phase when the widget returns.
    const widgetHidden = window.widgetAnimState === 'HIDDEN';

    if (!widgetHidden) {
        // Smooth-wrap marquee for the title + artist (shared clock via timeMs).
        tickLineMarquee(titleMq, timeMs);
        tickLineMarquee(artistMq, timeMs);
    }

    // Song-change fade reset: fade old text out, swap at home, fade new text in.
    // This one still advances while hidden — it owns the text swap itself, so
    // letting it run means a track that changes while the widget is away has
    // already settled on the new title by the time the widget fades back in.
    const textOpacity = tickSongTextReset();
    if (!widgetHidden && textOpacity !== lastTextOpacity) {
        lastTextOpacity = textOpacity;
        titleMq.inner.style.opacity = textOpacity;
        artistMq.inner.style.opacity = textOpacity;
    }

    if (widgetHidden) { requestAnimationFrame(updateUI); return; }

    let currentSecs = state.currentSecs;
    if (state.isPlaying && state.durationSeconds > 0) {
        const elapsedMs = performance.now() - state.lastUpdateTime;
        currentSecs += elapsedMs / 1000;
    }
    currentSecs = Math.max(0, Math.min(state.durationSeconds, currentSecs));
    
    const remainingSecs = Math.max(0, state.durationSeconds - currentSecs);
    const smoothProgress = state.durationSeconds > 0 ? (currentSecs / state.durationSeconds) : 0;

    // The clock only ticks once a second, but this ran ~60 times a second, and an
    // innerText write replaces the element's text node every time. Comparing first
    // reduces it to the one write per second that actually shows something new —
    // and tells us the rare moment the label's width can have changed (a digit
    // added or dropped), which is the only thing that moves the bar's width.
    let labelsChanged = false;
    if (timeCurrentEl) {
        const s = ConvertSeconds(currentSecs);
        if (s !== lastTimeCurrentText) { lastTimeCurrentText = s; timeCurrentEl.innerText = s; labelsChanged = true; }
    }
    if (timeRemainingEl) {
        const s = state.durationSeconds > 0 ? "-" + ConvertSeconds(remainingSecs) : "-0:00";
        if (s !== lastTimeRemainingText) { lastTimeRemainingText = s; timeRemainingEl.innerText = s; labelsChanged = true; }
    }

    if (progressContainer && progressThumbEl && progressSvg && progressPath) {
        if (labelsChanged || !progressContainerW) refreshProgressWidth();
        const containerW = progressContainerW;
        const thumbX = smoothProgress * containerW;

        // The bar creeps across over minutes, so most frames ask for a position it
        // is already at. Each of these is a style invalidation on an element the
        // marquee has just touched, so skipping the no-ops is worth the compare.
        const thumbPx = Math.round(thumbX * 10) / 10;
        if (thumbPx !== lastThumbX) {
            lastThumbX = thumbPx;
            progressThumbEl.style.left = thumbPx + 'px';
            progressSvg.style.width = Math.max(0, thumbPx + 10) + 'px';
        }

        if (ts - lastWaveDraw >= WAVE_FRAME_MS) {
            lastWaveDraw = (ts - lastWaveDraw > 2 * WAVE_FRAME_MS) ? ts : lastWaveDraw + WAVE_FRAME_MS;
            let d = "";
            if (thumbX > 0) {
                // One point every ~3px. The wave's period is ~42px and its amplitude
                // 1.5px, so this is still ~14 points a cycle — visually identical to
                // the old 2px spacing, at two thirds the string length. Rounding the
                // coordinates cuts it much further again: the raw floats were writing
                // seventeen significant digits per number into the attribute.
                const segments = Math.max(10, Math.floor(thumbX / 3));
                for (let i = 0; i <= segments; i++) {
                    const px = (i / segments) * thumbX;
                    const py = 8 + Math.sin((px * 0.15) + (timeMs * 0.004)) * 1.5;   // centre of the 16px track
                    d += (i === 0 ? 'M ' : ' L ') + px.toFixed(1) + ' ' + py.toFixed(2);
                }
            } else {
                d = "M 0 8";
            }
            progressPath.setAttribute('d', d);
        }
    }
    requestAnimationFrame(updateUI);
}

/* ── Layout ─────────────────────────────────────────────────────────────────
   Nothing scales: the widget is drawn at its design size. Without the stand the
   card fills the source's width; a source under 192px tall gets the compact
   player (172px is its full height), which never has the stand. With the stand
   it's the fixed 732×832 stall, card in its counter. */
const COMPACT_BELOW = 192;
const cardWrapperEl = document.querySelector('.sub-card-wrapper');
function applyLayout() {
    const compact = window.innerHeight < COMPACT_BELOW;
    document.body.classList.toggle('compact', compact);
    document.body.classList.toggle('stand', standOn && !compact);
    setBoilSize(cardWrapperEl.offsetWidth, cardWrapperEl.offsetHeight);
    measureMarquees();
    refreshProgressWidth();
}
window.addEventListener('resize', applyLayout);
applyLayout();

// The sign: laid out again once Inter 700 is in (the label's width sets the
// frame), and whenever the configure page's preview sends the label as it's typed.
function drawSign() { if (standOn) Sign.layout(signLabel); }
window.addEventListener('message', (e) => {
    if (e.data && typeof e.data.sign === 'string') { signLabel = e.data.sign; drawSign(); }
});
document.fonts.load('700 32px Inter').then(drawSign, drawSign);
drawSign();

if (previewMode) UpdatePlayer(PREVIEW_SONG);   // until YouTube Music plays something

requestAnimationFrame(updateUI);