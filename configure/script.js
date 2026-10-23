const appId = "nuttys-ytmdesktop-widget";
const appName = "Music Player Widget";
const appVersion = "1.0.0";
const widgetURL = "https://eseninocafe.github.io/music-player/";
const YTMD = "http://localhost:9863/api/v1";

const $ = (id) => document.getElementById(id);
const standToggle = $('standToggle'), signInput = $('signInput'), preview = $('preview');
let token = "";

/* ── Screens ── */
function show(screen) {
	for (const id of ['authScreen', 'errorScreen', 'configScreen']) $(id).hidden = id !== screen;
}

const UNREACHABLE = { title: $('errorTitle').textContent, message: $('errorMessage').textContent };
function showError(title, message) {
	$('errorTitle').textContent = title;
	$('errorMessage').textContent = message;
	show('errorScreen');
}

async function post(path, body) {
	const response = await fetch(YTMD + path, {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-type": "application/json; charset=UTF-8" }
	});
	return response.json();
}

// No Connect page: ask for a code as soon as the page opens, show it, and wait
// for it to be approved in YTMDesktop. YTMDesktop answering with an error shows
// its own message; not answering at all is the "not reachable" screen.
async function connect() {
	try {
		const request = await post("/auth/requestcode", { appId, appName, appVersion });
		if (request.statusCode) return showError(`Error ${request.statusCode}`, request.message);
		$('authCode').textContent = request.code;
		show('authScreen');

		const approval = await post("/auth/request", { appId, code: request.code });
		if (approval.statusCode) return showError(`Error ${approval.statusCode}`, approval.message);
		openSettings(approval.token, true, "");   // the stand starts on, as in the comp
	} catch (e) {
		showError(UNREACHABLE.title, UNREACHABLE.message);
	}
}
// A token from an earlier visit is reused: YTMDesktop turns authorization
// requests off once it approves one, so asking again on a refresh is refused.
// Only a token YTMDesktop rejects is dropped for a new code.
async function start() {
	let saved = null;
	try { saved = localStorage.getItem('ytmdToken'); } catch (e) {}
	if (!saved) return connect();
	try {
		const response = await fetch(YTMD + "/state", { headers: { Authorization: saved } });
		if (response.status !== 401 && response.status !== 403) return openSettings(saved, true, "");
		try { localStorage.removeItem('ytmdToken'); } catch (e) {}
		connect();
	} catch (e) {
		showError(UNREACHABLE.title, UNREACHABLE.message);
	}
}
$('retryBtn').addEventListener('click', start);

/* ── Settings ── */
function openSettings(newToken, stand, sign) {
	token = newToken;
	try { localStorage.setItem('ytmdToken', token); } catch (e) {}
	standToggle.checked = stand;
	setSign(sign);
	show('configScreen');
	reloadPreview();
}

// The widget's query: the token, plus the stand and its label when the stand is on.
function widgetQuery() {
	const p = new URLSearchParams({ token });
	if (standToggle.checked) {
		p.set('stand', '1');
		const sign = signInput.value.trim();
		if (sign) p.set('sign', sign);
	}
	return p.toString();
}

// The preview is the widget itself, with this token: it shows what YouTube Music
// is playing, and a default song when nothing is (?preview, see script.js).
function reloadPreview() {
	$('signField').classList.toggle('off', !standToggle.checked);
	preview.classList.toggle('bare', !standToggle.checked);
	preview.src = '../index.html?' + widgetQuery() + '&preview';
	fitPreview();
}
standToggle.addEventListener('change', reloadPreview);

/* ── Fit the preview to the window (only the preview: the widget never scales) ──
   The stand (or the bare player) is scaled down to fit below the settings,
   14px clear of the window's edges, never up. */
const STAND = { w: 732, h: 832 }, BARE = { w: 608, h: 192 }, PAD = 14;
function fitPreview() {
	if ($('configScreen').hidden) return;
	const box = standToggle.checked ? STAND : BARE;
	const top = $('fit').getBoundingClientRect().top + window.scrollY;
	const s = Math.max(0.1, Math.min(1, (innerWidth - 2 * PAD) / box.w, (innerHeight - top - PAD) / box.h));
	preview.style.transform = `scale(${s})`;
	$('fit').style.width = box.w * s + 'px';
	$('fit').style.height = box.h * s + 'px';
}
window.addEventListener('resize', fitPreview);
document.fonts.ready.then(fitPreview);   // Inter settles the settings' height

$('copyUrlBtn').addEventListener('click', () => {
	navigator.clipboard.writeText(widgetURL + '?' + widgetQuery());
	$('copyUrlLabel').textContent = 'Copied';
	$('copyUrlBtn').classList.add('copied');            // label only, no icon
	setTimeout(() => {
		$('copyUrlLabel').textContent = 'Copy Widget URL';
		$('copyUrlBtn').classList.remove('copied');
	}, 1500);
});

/* ── Paste a widget URL: back to its settings, no new code needed ── */
function loadUrl(input) {
	let url = null;
	try { url = new URL(input.value.trim()); } catch (e) {}
	const pastedToken = url && url.searchParams.get('token');
	input.value = '';
	clearTimeout(input.placeholderTimer);
	if (!pastedToken) {
		// Says so for a moment, like "Copied", then asks again (typing resets it sooner)
		input.placeholder = 'Not a widget URL';
		input.placeholderTimer = setTimeout(() => { input.placeholder = 'Paste your widget URL'; }, 1500);
		return;
	}
	input.placeholder = 'Paste your widget URL';
	openSettings(pastedToken, url.searchParams.get('stand') === '1', url.searchParams.get('sign') || '');
}
document.querySelectorAll('.load-row').forEach((row) => {
	const input = row.querySelector('.url-input');
	row.querySelector('.load-btn').addEventListener('click', () => loadUrl(input));
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(input); });
	input.addEventListener('input', () => { input.placeholder = 'Paste your widget URL'; });
});

/* ── Sign label ──
   maxlength caps the characters; this handles the rare change that is still too
   wide for the sign's 32px type. Text added at the end (typing, a paste) is
   trimmed to what fits; a change in the middle is refused, caret kept in place.
   The preview gets each label as it's typed, without reloading. */
let acceptedSign = '';
const fits = (v) => Sign.width(v.trim()) <= Sign.MAX_TEXT_W;

signInput.addEventListener('input', () => {
	let v = signInput.value;
	if (!fits(v)) {
		if (signInput.selectionStart === v.length) {           // added at the end → trim
			while (v && !fits(v)) v = v.slice(0, -1);
			signInput.value = v;
		} else {                                               // mid-string → refuse
			const caret = Math.max(0, signInput.selectionStart - (v.length - acceptedSign.length));
			signInput.value = v = acceptedSign;
			signInput.setSelectionRange(caret, caret);
		}
	}
	acceptedSign = v;
	preview.contentWindow.postMessage({ sign: v }, '*');
});

// A label from a pasted URL: the same cap, trimmed to what fits.
function setSign(v) {
	v = v.slice(0, Sign.MAX_CHARS);
	while (v && !fits(v)) v = v.slice(0, -1);
	signInput.value = acceptedSign = v;
}

/* ── Theme: the same saved choice as the Song Info Card (dark unless set to light) ── */
$('themeToggle').addEventListener('click', () => {
	const light = document.body.classList.toggle('light-mode');
	try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
});

document.fonts.load('700 32px Inter');   // the sign's type, which the label is measured in
start();
