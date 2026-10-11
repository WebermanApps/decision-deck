(() => {
const C = window.DECK_CONFIG, $ = (s) => document.querySelector(s);
// Token keys are shared with the Brief App on the same origin, so one Connect Dropbox covers both apps.
const LS = { token: "briefapp.dbx.token", verifier: "decisiondeck.dbx.verifier", mode: "decisiondeck.mode", taps: (w) => `decisiondeck.taps.${w}` };
const LABEL = { no: "No", maybe: "Maybe", love: "Love", yes: "Yes" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function isoWeek(d = new Date()) { // YYYY-WW, ISO 8601, device local date
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-${String(w).padStart(2, "0")}`;
}
let deck = null, mode = localStorage.getItem(LS.mode) || "none", queue = [], expanded = new Set();
const redirect = () => location.origin + location.pathname;
const msg = (s) => { $("#msg").textContent = s; };

// ---- Dropbox PKCE (same flow as the Brief App) ----
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function connect() {
  if (!C.DROPBOX_APP_KEY || C.DROPBOX_APP_KEY.startsWith("YOUR_")) return msg("Dropbox app key not set in config.js. Use Demo Mode.");
  const v = b64url(crypto.getRandomValues(new Uint8Array(48))); localStorage.setItem(LS.verifier, v);
  const ch = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  location.href = "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({ client_id: C.DROPBOX_APP_KEY, response_type: "code", code_challenge: ch, code_challenge_method: "S256", redirect_uri: redirect(), token_access_type: "offline" });
}
async function tokenReq(body) {
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: C.DROPBOX_APP_KEY, ...body }) });
  if (!r.ok) throw new Error("Token request failed " + r.status);
  const j = await r.json(), old = JSON.parse(localStorage.getItem(LS.token) || "{}");
  localStorage.setItem(LS.token, JSON.stringify({ access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 }));
}
async function handleRedirect() {
  const code = new URLSearchParams(location.search).get("code"); if (!code) return;
  await tokenReq({ grant_type: "authorization_code", code, code_verifier: localStorage.getItem(LS.verifier), redirect_uri: redirect() });
  localStorage.removeItem(LS.verifier); history.replaceState(null, "", redirect()); mode = "dropbox"; localStorage.setItem(LS.mode, mode);
}
async function access() {
  let t = JSON.parse(localStorage.getItem(LS.token) || "null"); if (!t) throw new Error("Not connected");
  if (Date.now() > t.exp) { await tokenReq({ grant_type: "refresh_token", refresh_token: t.refresh }); t = JSON.parse(localStorage.getItem(LS.token)); }
  return t.access;
}
async function dbxDownload(path) {
  const r = await fetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { Authorization: "Bearer " + await access(), "Dropbox-API-Arg": JSON.stringify({ path }) } });
  if (r.status === 409) return null; if (!r.ok) throw new Error("Download failed " + r.status); return r.json();
}
async function dbxUpload(path, data) {
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { Authorization: "Bearer " + await access(), "Content-Type": "application/octet-stream", "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }) }, body: JSON.stringify(data, null, 2) });
  if (!r.ok) throw new Error("Upload failed " + r.status);
}

// ---- Taps: [{id, action: no|maybe|love|yes, ts}] appended; latest per id wins. Skip is not recorded. ----
const getTaps = () => JSON.parse(localStorage.getItem(LS.taps(deck.week)) || "[]");
const setTaps = (t) => localStorage.setItem(LS.taps(deck.week), JSON.stringify(t));
const exportTaps = () => getTaps().map(({ _saved, ...t }) => t);
const answers = () => { const m = {}; getTaps().forEach((t) => { m[t.id] = t.action; }); return m; };
// Notes on Votes: optional "note" rides on the tap. Latest tap per id wins, so a tap without a note clears it.
const notes = () => { const m = {}; getTaps().forEach((t) => { if (t.note) m[t.id] = t.note; else delete m[t.id]; }); return m; };
const tap = (id, action, note) => { const t = { id, action, ts: new Date().toISOString(), _saved: false }; note = String(note || "").trim().slice(0, 1000); if (note) t.note = note; return t; };
let draft = "", noteOpen = false;
async function sync() {
  if (mode !== "dropbox") return msg("Demo Mode: answers stay on this device.");
  const local = getTaps(); if (!local.some((t) => !t._saved)) return;
  try {
    const remote = (await dbxDownload(C.tapsPath(deck.week))) || [], key = (t) => t.id + "|" + t.ts, seen = new Set(remote.map(key));
    await dbxUpload(C.tapsPath(deck.week), [...remote, ...exportTaps().filter((t) => !seen.has(key(t)))]);
    setTaps(local.map((t) => ({ ...t, _saved: true }))); msg("Saved to Dropbox.");
  } catch (e) { msg("Not saved: " + e.message + ". Tap Sync to retry."); }
}
function answer(a) {
  const it = queue[0]; if (!it) return;
  setTaps([...getTaps(), tap(it.id, a, draft)]); draft = ""; noteOpen = false;
  next(a); if (mode === "dropbox") sync();
}
function next(stamp) {
  if (!stamp) { draft = ""; noteOpen = false; }
  const card = $("#stack .card"); queue.shift();
  if (card && stamp !== undefined && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    card.classList.add("leaving", "go-" + (stamp || "skip")); setTimeout(render, 220);
  } else render();
}

// ---- Render ----
function cardHTML(it) {
  return `<article class="card" data-id="${esc(it.id)}"><span class="stamp" aria-hidden="true"></span>
    <div class="label">Owner · ${esc(it.owner || "-")}</div><h2>${esc(it.title)}</h2><p>${esc(it.detail || "")}</p>
    ${Array.isArray(it.options) && it.options.length ? `<ul class="opts">${it.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
    <div class="notebox"><button class="btn sm notebtn mw-hover${draft ? " has" : ""}" id="notebtn" aria-expanded="${noteOpen}">${draft ? "✎ Note" : "Add Note"}</button>
    <div class="noteedit"${noteOpen ? "" : " hidden"}><textarea id="notetext" rows="3" maxlength="1000" placeholder="Optional note. Vote any time." aria-label="Note">${esc(draft)}</textarea><div class="label">Saved with your vote</div></div></div></article>`;
}
function render() {
  const items = deck.items || [], ans = answers(), done = items.filter((i) => ans[i.id]).length;
  $("#week").textContent = "Week " + deck.week; $("#mode").textContent = mode === "dropbox" ? "Dropbox" : mode === "demo" ? "Demo Mode · Sample Data" : "Not Connected";
  $("#heading").textContent = mode === "demo" ? "Weekly Decisions (Demo)" : "Weekly Decisions";
  $("#progress").textContent = `${done} of ${items.length} Answered`; $("#bar").style.width = items.length ? (100 * done / items.length) + "%" : "0";
  const live = queue.length > 0;
  $("#stack").innerHTML = live ? cardHTML(queue[0]) : ""; $("#stack").hidden = !live; $("#controls").hidden = !live; $("#hint").hidden = !live;
  $("#results").hidden = live || !items.length; if (live) bindDrag($("#stack .card")); else renderResults();
}
function renderResults() {
  const ans = answers(), nts = notes(), by = $("#sort").value, ord = { love: 0, yes: 1, maybe: 2, no: 3, undefined: 4 };
  const az = (x, y) => String(x.title).localeCompare(String(y.title));
  const list = [...deck.items].sort(by === "za" ? (x, y) => -az(x, y) : by === "answer" ? (x, y) => ord[ans[x.id]] - ord[ans[y.id]] || az(x, y) : by === "owner" ? (x, y) => String(x.owner).localeCompare(String(y.owner)) || az(x, y) : az);
  $("#summary").textContent = summary() || "No answers yet.";
  $("#list").innerHTML = list.map((it) => { const a = ans[it.id], open = expanded.has(it.id);
    const nt = nts[it.id] || "";
    return `<article class="rrow" data-id="${esc(it.id)}"><button class="rowhead" aria-expanded="${open}"><span class="rowtitle">${esc(it.title)}</span><span class="rowmeta">${nt ? `<span class="noteicon" title="Has Note" aria-label="Has Note">✎</span>` : ""}<span class="pill ${a || "skipped"}" data-ans="${a || "skipped"}">${a === "love" ? "♥ " : ""}${a ? LABEL[a] : "Skipped"}</span><span class="chev" aria-hidden="true">${open ? "−" : "+"}</span></span></button>
      <div class="rowbody"${open ? "" : " hidden"}><div class="label">Owner · ${esc(it.owner || "-")}</div><p>${esc(it.detail || "")}</p>
      <div class="change">${Object.keys(LABEL).map((k) => `<button class="btn sm mw-hover${a === k ? " on" : ""}" data-change="${k}">${LABEL[k]}</button>`).join("")}</div>
      ${a ? `<div class="rownote"><label class="label" for="n-${esc(it.id)}">Note</label><textarea id="n-${esc(it.id)}" class="rownotetext" rows="2" maxlength="1000" placeholder="Add a note">${esc(nt)}</textarea><button class="btn sm mw-hover" data-savenote>Save Note</button></div>` : ""}</div></article>`; }).join("");
  $("#restart").hidden = !deck.items.some((i) => !ans[i.id]);
}
function summary() {
  const v = Object.values(answers()), n = (a) => v.filter((x) => x === a).length;
  const parts = [["yes", "Yes"], ["love", "Love"], ["maybe", "Maybe"], ["no", "No"]].filter(([k]) => n(k)).map(([k, w]) => `${n(k)} ${w}`);
  return parts.length ? "My picks: " + parts.join(", ") + "." : "";
}

// ---- Swipe: left = No, right = Yes ----
function bindDrag(card) {
  if (!card) return; let x0 = null, dx = 0;
  card.addEventListener("pointerdown", (e) => { x0 = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.classList.add("dragging"); });
  card.addEventListener("pointermove", (e) => { if (x0 === null) return; dx = e.clientX - x0;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`; const s = card.querySelector(".stamp");
    s.textContent = dx > 40 ? "Yes" : dx < -40 ? "No" : ""; s.className = "stamp " + (dx > 40 ? "yes" : dx < -40 ? "no" : ""); });
  // Opening a note pauses the swipe gesture; the note area never starts a drag.
  card.addEventListener("pointerdown", (e) => { if (noteOpen || e.target.closest(".notebox")) e.stopImmediatePropagation(); }, true);
  const end = () => { if (x0 === null) return; x0 = null; card.classList.remove("dragging");
    if (dx > 100) answer("yes"); else if (dx < -100) answer("no"); else { card.style.transform = ""; card.querySelector(".stamp").textContent = ""; } };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
}

// ---- Events ----
document.querySelectorAll(".ans").forEach((b) => (b.onclick = () => answer(b.dataset.a)));
$("#skip").onclick = () => { if (queue.length) next(""); };
$("#stack").addEventListener("click", (e) => { if (!e.target.closest("#notebtn")) return; noteOpen = !noteOpen;
  const ed = $("#stack .noteedit"); ed.hidden = !noteOpen; e.target.closest("#notebtn").setAttribute("aria-expanded", noteOpen); if (noteOpen) $("#notetext").focus(); });
$("#stack").addEventListener("input", (e) => { if (e.target.id !== "notetext") return; draft = e.target.value; const b = $("#notebtn"); b.textContent = draft.trim() ? "✎ Note" : "Add Note"; b.classList.toggle("has", !!draft.trim()); });
document.addEventListener("keydown", (e) => { if ($("#controls").hidden || e.target.closest("textarea,input,select")) return; const k = { ArrowLeft: "no", ArrowRight: "yes" }[e.key]; if (k) answer(k); });
$("#list").addEventListener("click", (e) => {
  const row = e.target.closest(".rrow"); if (!row) return; const id = row.dataset.id, ch = e.target.closest("[data-change]");
  if (e.target.closest("[data-savenote]")) { const n = row.querySelector(".rownotetext").value; setTaps([...getTaps(), tap(id, answers()[id], n)]); renderResults(); msg(n.trim() ? "Note Saved" : "Note Cleared"); if (mode === "dropbox") sync(); return; }
  if (ch) { setTaps([...getTaps(), tap(id, ch.dataset.change, notes()[id])]); renderResults(); render(); if (mode === "dropbox") sync(); return; }
  if (e.target.closest(".rowhead")) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderResults(); }
});
// Copy Results / Export JSON stay on this device (clipboard or a download). Share stays counts only.
function resultsText() { const ans = answers(), nts = notes();
  return [...deck.items].sort((x, y) => String(x.title).localeCompare(String(y.title))).map((it) => `${it.title}: ${ans[it.id] ? LABEL[ans[it.id]] : "Skipped"}${nts[it.id] ? " · Note: " + nts[it.id] : ""}`).join("\n"); }
$("#copy").onclick = async () => { try { await navigator.clipboard.writeText((summary() ? summary() + "\n" : "") + resultsText()); msg("Results Copied"); } catch (e) { msg("Copy failed: " + e.message); } };
$("#export").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(exportTaps(), null, 2)], { type: "application/json" })); a.download = `decision-taps-${deck.week}.json`; a.click(); };
$("#sort").onchange = renderResults; $("#sync").onclick = sync; $("#connect").onclick = connect;
$("#restart").onclick = () => { const a = answers(); queue = deck.items.filter((i) => !a[i.id]); render(); };
$("#demo").onclick = () => { localStorage.setItem(LS.mode, "demo"); location.reload(); };

// ---- Share (brand standard): link + neutral counts only. No phone number. ----
async function share() {
  const url = location.origin + location.pathname, text = (deck && summary()) || "Weekly decisions link:";
  if (navigator.share) { try { await navigator.share({ title: "Weekly Decisions", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  if (matchMedia("(pointer:coarse)").matches) { location.href = "sms:?&body=" + encodeURIComponent(text + "\n" + url); return; }
  try { await navigator.clipboard.writeText(text + "\n" + url); msg("Link Copied"); } catch (e) { msg("Copy this link: " + url); }
}
$("#share").onclick = share;

async function boot() {
  const week = isoWeek(), empty = { week, items: [] };
  try {
    await handleRedirect();
    if (mode === "dropbox") { deck = (await dbxDownload(C.decisionsPath(week))) || empty; if (!deck.items.length) msg("No decisions in Dropbox for this week yet."); }
    else if (mode === "demo") deck = await (await fetch(C.demoUrl)).json();
    else { deck = empty; msg("Connect Dropbox to load this week's decisions, or open Demo Mode."); }
  } catch (e) { deck = deck || empty; msg("Error: " + e.message); }
  deck.week = deck.week || week; const a = answers(); queue = (deck.items || []).filter((i) => !a[i.id]); render();
}
window.__deck = { exportTaps, isoWeek, notes, resultsText }; boot();
})();
