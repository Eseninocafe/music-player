/* The stand's hanging sign. The widget draws it; the configure page uses the
   same measurements to cap the label. Coordinates are the stand's (732 × 832;
   assets/stall.svg's are 9px lower, see its viewBox), and the frame is
   measured on its stroke's centre line, as Figma draws it.

   The two strings hang from the awning's scallop bottoms, and the frame is
   centred between them. For a label, the pair is the one whose spacing puts the
   strings closest to 32px inside the frame's ends; among equally good pairs, the
   rightmost one that fits. The frame hugs the label (padding 18 × 24), widening
   only to keep its strings 32px inside the ends, and never comes closer than 2px
   to either post. The type is always 32px: the label is capped at MAX_CHARS, and
   the configure page trims or refuses a change that would still run past the
   widest frame (wide all-caps, e.g. 13 W's). */
const Sign = (() => {
    const DEFAULT = 'Opening Soon';
    const MAX_CHARS = 24;
    const SCALLOPS = [55.755, 159.265, 262.775, 366.286, 469.796, 573.306, 676.816];  // scallop bottoms, x
    const SCALLOP_Y = 396.183;                  // ...and y (the awning stroke's centre line)
    const POST_L = 112.743, POST_R = 620.743;   // the posts' inner stroke edges
    const TOP = 410, H = 75, PAD_X = 24, PAD_Y = 18, LINE_H = 39, FONT = 32;
    const STROKE = 8, POST_GAP = 2, STRING_INSET = 32;

    // Every scallop pair the sign could hang from, with the widest frame that,
    // centred on the pair, still clears both posts by 2px.
    const PAIRS = [];
    for (let i = 0; i < SCALLOPS.length; i++) {
        for (let j = i + 1; j < SCALLOPS.length; j++) {
            const c = (SCALLOPS[i] + SCALLOPS[j]) / 2, d = SCALLOPS[j] - SCALLOPS[i];
            const maxW = 2 * Math.min(c - POST_L - POST_GAP, POST_R - POST_GAP - c) - STROKE;
            if (d + 2 * STRING_INSET <= maxW + 0.01) PAIRS.push({ i, j, c, d, maxW });
        }
    }
    const W_MAX = Math.max(...PAIRS.map((q) => q.maxW));
    const MAX_TEXT_W = W_MAX - 2 * PAD_X;     // the widest label the widest frame holds

    // Width of a label in the sign's type (both pages load Inter 700).
    const measure = document.createElement('canvas').getContext('2d');
    function width(label) {
        measure.font = `700 ${FONT}px Inter`;
        return measure.measureText(label).width;
    }

    // Draws the sign into the widget's #hangL, #hangR, #signBox and #signText.
    function layout(label) {
        label = (label || '').trim() || DEFAULT;
        const hugW = Math.min(Math.ceil(width(label)) + 2 * PAD_X, W_MAX);   // Figma rounds hug-width text up
        let best = null;
        for (const q of PAIRS) {
            const fw = Math.max(hugW, q.d + 2 * STRING_INSET);
            if (fw > q.maxW + 0.01) continue;
            const cost = Math.abs(q.d + 2 * STRING_INSET - hugW);
            // (pairs sharing a centre differ by float noise, hence the 0.5 slack)
            if (!best || cost < best.cost - 0.5 || (Math.abs(cost - best.cost) <= 0.5 && q.c > best.c)) best = { ...q, fw, cost };
        }

        const box = document.getElementById('signBox'), text = document.getElementById('signText');
        box.setAttribute('x', best.c - best.fw / 2);
        box.setAttribute('y', TOP);
        box.setAttribute('width', best.fw);
        box.setAttribute('height', H);
        text.textContent = label;
        text.setAttribute('x', best.c);
        // 39px line, Inter metrics → baseline
        text.setAttribute('y', (TOP + PAD_Y + (LINE_H - 1.20995 * FONT) / 2 + 0.96875 * FONT).toFixed(2));
        // The strings start on the awning's stroke, so they read as hanging from it.
        for (const [id, k] of [['hangL', best.i], ['hangR', best.j]]) {
            const line = document.getElementById(id);
            line.setAttribute('x1', SCALLOPS[k]);
            line.setAttribute('x2', SCALLOPS[k]);
            line.setAttribute('y1', SCALLOP_Y);
            line.setAttribute('y2', TOP);
        }
    }

    return { DEFAULT, MAX_CHARS, MAX_TEXT_W, width, layout };
})();
