/* ============================================================
   CONFIG
   Paste the Google Apps Script Web App URL here after deployment.
   Deployment steps are in docs/SETUP_GUIDE.md
   ============================================================ */
const API_URL = "https://script.google.com/macros/s/AKfycbwGUSEYze7ESDtg7-u6AjoxETkegz0ZU9NiN9PkB-3sT7whKvmrjEpjt_EnJQqguK6O5w/exec";

/* ------------------------------------------------------------
   callApi(action, payload)
   Sends a POST request to the Apps Script backend.
   Uses text/plain content-type on purpose — this avoids the
   CORS pre-flight request, which Apps Script Web Apps cannot
   answer. The backend (Code.gs) reads e.postData.contents and
   parses it as JSON itself.
   ------------------------------------------------------------ */
async function callApi(action, payload = {}) {
  if (!API_URL || API_URL.indexOf("PASTE_YOUR") === 0) {
    throw new Error("Backend URL is not configured yet. Open js/config.js and paste your Apps Script Web App URL.");
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  if (!res.ok) throw new Error("Network error: " + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data.result;
}

/* ------------------------------------------------------------
   Toasts
   ------------------------------------------------------------ */
function ensureToastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}
function toast(message, type = "info", timeout = 3800) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : type === "success" ? " success" : "");
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

/* ------------------------------------------------------------
   Simple full-page loading overlay
   ------------------------------------------------------------ */
function showBlockingLoader(text) {
  hideBlockingLoader();
  const el = document.createElement("div");
  el.className = "overlay-block";
  el.id = "blockingLoader";
  el.innerHTML = `<div class="card card-pad center" style="min-width:220px"><div class="loader dark" style="margin:0 auto 12px"></div><div class="muted" style="font-size:13.5px">${text || "Loading..."}</div></div>`;
  document.body.appendChild(el);
}
function hideBlockingLoader() {
  const el = document.getElementById("blockingLoader");
  if (el) el.remove();
}

/* ------------------------------------------------------------
   Session (kept in sessionStorage only — cleared on tab close)
   ------------------------------------------------------------ */
const Session = {
  set(user) { sessionStorage.setItem("cm_user", JSON.stringify(user)); },
  get() {
    try { return JSON.parse(sessionStorage.getItem("cm_user")); } catch (e) { return null; }
  },
  clear() { sessionStorage.removeItem("cm_user"); },
  requireRole(role) {
    const u = Session.get();
    if (!u || u.role !== role) {
      window.location.href = "index.html";
      return null;
    }
    return u;
  }
};

const RATING_LABELS = { 1: "Beginner", 2: "Developing", 3: "Competent", 4: "Proficient", 5: "Expert" };
