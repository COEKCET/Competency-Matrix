const user = Session.requireRole("admin");
if (user) init();

let ADMIN_STATE = {
  faculty: [],
  departments: [],
  boards: [],
  globalLocked: false
};

async function init() {
  bindTopActions();
  bindTabs();
  showBlockingLoader("Loading admin console...");
  try {
    const data = await callApi("adminBootstrap", {});
    ADMIN_STATE.faculty = data.faculty;
    ADMIN_STATE.departments = data.departments;
    ADMIN_STATE.boards = data.boards;
    ADMIN_STATE.globalLocked = data.globalLocked;

    renderStatCards(data.stats);
    renderGlobalLockToggle();
    renderDeptFilter();
    renderFacultyTable();
    renderNotEntered();
    populateBoardSelects();

    bindSaveBarControls("allocBoardSelect", "allocSaveBtn", "allocDiscardBtn", renderAllocation);
    bindSaveBarControls("facPrefBoardSelect", "facPrefSaveBtn", "facPrefDiscardBtn", renderFacultyPreferences);
    bindSaveBarControls("matrixBoardSelect", "matrixSaveBtn", "matrixDiscardBtn", renderBoardMatrix);
  } catch (err) {
    toast(err.message, "error", 6000);
  } finally {
    hideBlockingLoader();
  }
}

function bindTopActions() {
  document.getElementById("logoutBtn").addEventListener("click", () => {
    Session.clear();
    window.location.href = "index.html";
  });
}

function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "allocreport" && !currentAllocReport) loadAllocReport();
    });
  });
}

/* ---------------- Stat cards ---------------- */
function renderStatCards(stats) {
  const cards = [
    ["Total Faculty", stats.totalFaculty],
    ["Submitted", stats.submitted],
    ["Not Entered", stats.notEntered],
    ["Pending Edit Requests", stats.pendingEditRequests]
  ];
  document.getElementById("statCards").innerHTML = cards.map(([label, num]) => `
    <div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>
  `).join("");
}

/* ---------------- Global lock ---------------- */
function renderGlobalLockToggle() {
  const toggle = document.getElementById("globalLockToggle");
  const label = document.getElementById("globalLockLabel");
  toggle.checked = !ADMIN_STATE.globalLocked; // checked = unlocked/open
  label.textContent = ADMIN_STATE.globalLocked ? "Locked" : "Open";
  toggle.addEventListener("change", async () => {
    const wantOpen = toggle.checked;
    try {
      await callApi("adminSetGlobalLock", { lock: !wantOpen });
      ADMIN_STATE.globalLocked = !wantOpen;
      label.textContent = ADMIN_STATE.globalLocked ? "Locked" : "Open";
      toast(wantOpen ? "Faculty entry opened system-wide." : "Faculty entry locked system-wide.", "success");
    } catch (e) {
      toggle.checked = !toggle.checked;
      toast(e.message, "error");
    }
  });
}

/* ---------------- Faculty table ---------------- */
function renderDeptFilter() {
  const sel = document.getElementById("facDeptFilter");
  sel.innerHTML = '<option value="">All departments</option>' +
    ADMIN_STATE.departments.map(d => `<option value="${d}">${d}</option>`).join("");
  sel.addEventListener("change", renderFacultyTable);
}

function renderFacultyTable() {
  const deptFilter = document.getElementById("facDeptFilter").value;
  const rows = ADMIN_STATE.faculty.filter(f => !deptFilter || f.dept === deptFilter);
  const tbody = document.querySelector("#facultyTable tbody");
  tbody.innerHTML = rows.map(f => `
    <tr data-email="${f.email}">
      <td><strong>${f.name}</strong></td>
      <td>${f.dept || "—"}</td>
      <td>${f.designation || "—"}</td>
      <td class="muted">${f.expYears || 0}y ${f.expMonths || 0}m</td>
      <td>${f.submitted
        ? (f.editAllowed ? '<span class="badge badge-warn">Editing enabled</span>' : '<span class="badge badge-success">Submitted</span>')
        : '<span class="badge badge-lock">Not entered</span>'}</td>
      <td>
        <label class="switch"><input type="checkbox" class="rowLock" ${f.locked ? "" : "checked"}><span class="slider"></span></label>
      </td>
      <td>${f.editRequested ? '<span class="badge badge-warn">Requested</span>' : '<span class="muted">—</span>'}</td>
      <td>
        ${f.editRequested ? `<button class="btn btn-sm btn-success grantEditBtn">Grant Edit</button>` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".rowLock").forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const email = e.target.closest("tr").dataset.email;
      const wantUnlocked = e.target.checked;
      try {
        await callApi("adminToggleLock", { email, lock: !wantUnlocked });
        toast(wantUnlocked ? "Faculty unlocked." : "Faculty locked.", "success");
        const f = ADMIN_STATE.faculty.find(x => x.email === email);
        if (f) f.locked = !wantUnlocked;
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(err.message, "error");
      }
    });
  });

  tbody.querySelectorAll(".grantEditBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const email = e.target.closest("tr").dataset.email;
      try {
        await callApi("adminSetEditAllowed", { email, allow: true });
        toast("Edit access granted.", "success");
        const f = ADMIN_STATE.faculty.find(x => x.email === email);
        if (f) { f.editAllowed = true; f.editRequested = false; }
        renderFacultyTable();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

/* ---------------- Not entered ---------------- */
function renderNotEntered() {
  const rows = ADMIN_STATE.faculty.filter(f => !f.submitted && (f.expYears || 0) * 12 + (f.expMonths || 0) >= 24 && f.role !== "admin");
  document.querySelector("#notEnteredTable tbody").innerHTML = rows.map(f => `
    <tr>
      <td><strong>${f.name}</strong></td><td>${f.dept}</td><td>${f.designation}</td>
      <td class="muted">${f.expYears || 0}y ${f.expMonths || 0}m</td>
      <td>${f.email}</td><td>${f.mobile || "—"}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty-state">Everyone eligible has submitted. 🎉</td></tr>`;

  document.getElementById("exportNotEnteredBtn").addEventListener("click", () => {
    exportTableToExcel(rows.map(f => ({
      Name: f.name, Department: f.dept, Designation: f.designation,
      Experience: `${f.expYears || 0}y ${f.expMonths || 0}m`, Email: f.email, Mobile: f.mobile
    })), "Not_Entered_Faculty");
  });
}

/* ---------------- Board selects ---------------- */
function populateBoardSelects() {
  ["reportBoardSelect", "allocBoardSelect", "facPrefBoardSelect", "matrixBoardSelect", "printBoardSelect"].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Choose board…</option>' + ADMIN_STATE.boards.map(b => `<option value="${b}">${b}</option>`).join("");
  });
  document.getElementById("reportBoardSelect").addEventListener("change", e => loadBoardReport(e.target.value));
  document.getElementById("allocBoardSelect").addEventListener("change", e => loadAllocation(e.target.value));
  document.getElementById("facPrefBoardSelect").addEventListener("change", e => loadFacultyPreferences(e.target.value));
  document.getElementById("matrixBoardSelect").addEventListener("change", e => loadBoardMatrix(e.target.value));
  document.getElementById("printBoardSelect").addEventListener("change", e => loadPrintSheet(e.target.value));
}

/* ---------------- Shared: "Not allotted" live banner ---------------- */
function renderNotAllottedBanner(targetElId, notAllotted) {
  const el = document.getElementById(targetElId);
  if (!el) return;
  if (!notAllotted || !notAllotted.length) {
    el.innerHTML = `<div class="badge badge-success">✓ All courses in this board are allotted</div>`;
    return;
  }
  el.innerHTML = `
    <div class="locked-banner" style="align-items:flex-start;flex-wrap:wrap">
      <span style="flex:none">📌 Not allotted (${notAllotted.length}):</span>
      <span style="display:flex;flex-wrap:wrap;gap:6px">
        ${notAllotted.map(code => `<span class="badge badge-lock" style="font-family:var(--font-mono)">${code}</span>`).join("")}
      </span>
    </div>`;
}

/* ---------------- Board report ---------------- */
let currentReport = null;

async function loadBoardReport(board) {
  const wrap = document.getElementById("reportWrap");
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">📊</div>Choose a board to view its report.</div>`; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    currentReport = await callApi("adminGetBoardReport", { board });
    wrap.innerHTML = currentReport.courses.map(c => `
      <h4 style="font-size:14px;margin:16px 0 8px">${c.code} — ${c.name} <span class="muted" style="font-weight:400">(${c.year}/${c.sem})</span></h4>
      <div class="table-wrap mb-16">
      <table>
        <thead><tr><th>Faculty</th><th>Dept</th><th>Experience</th><th>Handled this sem</th><th>Rating</th></tr></thead>
        <tbody>
        ${c.ratings.length ? c.ratings.map(r => `
          <tr>
            <td>${r.name}</td><td class="muted">${r.dept}</td>
            <td class="muted">${r.expYears}y ${r.expMonths}m</td>
            <td>${r.handled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-lock">No</span>'}</td>
            <td><span class="badge badge-gold">${r.rating} · ${RATING_LABELS[r.rating]}</span></td>
          </tr>`).join("") : `<tr><td colspan="5" class="muted center">No ratings submitted for this course yet.</td></tr>`}
        </tbody>
      </table>
      </div>
    `).join("");
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

document.getElementById("exportReportExcelBtn").addEventListener("click", () => {
  if (!currentReport) { toast("Choose a board first.", "error"); return; }
  const rows = [];
  currentReport.courses.forEach(c => {
    if (!c.ratings.length) rows.push({ Course_Code: c.code, Course_Name: c.name, Year: c.year, Sem: c.sem, Faculty: "—", Dept: "", Experience: "", Handled: "", Rating: "" });
    c.ratings.forEach(r => rows.push({
      Course_Code: c.code, Course_Name: c.name, Year: c.year, Sem: c.sem,
      Faculty: r.name, Dept: r.dept, Experience: `${r.expYears}y ${r.expMonths}m`,
      Handled: r.handled ? "Yes" : "No", Rating: `${r.rating} - ${RATING_LABELS[r.rating]}`
    }));
  });
  exportTableToExcel(rows, "Board_Report_" + currentReport.board);
});

document.getElementById("exportReportPdfBtn").addEventListener("click", () => {
  if (!currentReport) { toast("Choose a board first.", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Board Report — ${currentReport.board}`, 14, 16);
  let y = 24;
  currentReport.courses.forEach(c => {
    if (y > 260) { doc.addPage(); y = 16; }
    doc.setFontSize(11);
    doc.text(`${c.code} — ${c.name} (${c.year}/${c.sem})`, 14, y);
    const body = c.ratings.length
      ? c.ratings.map(r => [r.name, r.dept, `${r.expYears}y ${r.expMonths}m`, r.handled ? "Yes" : "No", `${r.rating} - ${RATING_LABELS[r.rating]}`])
      : [["No ratings submitted", "", "", "", ""]];
    doc.autoTable({
      startY: y + 4,
      head: [["Faculty", "Dept", "Experience", "Handled", "Rating"]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 35, 63] },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 12;
  });
  doc.save(`Board_Report_${currentReport.board}.pdf`);
});

/* ================================================================
   SHARED ALLOCATION STATE
   (QP Allocation / Faculty Preference / Board Matrix)
   ------------------------------------------------------------
   Selecting a board loads ALL THREE views in a single request
   (adminGetBoardAllocBundle) and caches the result in ALLOC_CACHE.
   Clicking Allocate / Remove / a matrix cell never calls the
   backend directly — it stages the change in ALLOC_PENDING and
   re-renders from cache + pending instantly (counts, locks, and
   colours all update with zero network delay). Switching between
   the three tabs, or re-selecting the same board, reuses the same
   cache — no repeated reloads.

   A single shared "Save changes" bar (rendered into whichever tab
   is open) batches every staged change for that board into ONE
   adminBatchAllocate call. If saving would still leave courses
   unallotted, the admin gets a confirm dialog listing them first.
   ================================================================ */
const ALLOC_CACHE = {};   // board -> bundle {courseWise, facultyPref, matrixCourses, matrix, notAllotted}
const ALLOC_PENDING = {}; // board -> { [courseCode]: {code, name, email, facultyName, action} }

function norm(x) { return String(x || "").trim().toLowerCase(); }

function getPending(board) {
  if (!ALLOC_PENDING[board]) ALLOC_PENDING[board] = {};
  return ALLOC_PENDING[board];
}
function pendingCount(board) { return Object.keys(getPending(board)).length; }

/* ---- Fixed Save/Discard bar (lives in the HTML, right after each
   course list — NOT re-created on every render). We bind the click
   handlers ONCE at startup; each handler reads the currently
   selected board straight from its tab's <select> at click time,
   so it always acts on whatever board is on screen. Each render
   just calls updateSaveBar() to show/hide it and update the count. ---- */
function bindSaveBarControls(boardSelId, saveId, discardId, rerender) {
  const saveBtn = document.getElementById(saveId);
  const discardBtn = document.getElementById(discardId);
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const board = document.getElementById(boardSelId).value;
    if (board) saveAllocChanges(board, () => rerender(board));
  });
  if (discardBtn) discardBtn.addEventListener("click", () => {
    const board = document.getElementById(boardSelId).value;
    if (board) { ALLOC_PENDING[board] = {}; rerender(board); }
  });
}

function updateSaveBar(board, barId, textId) {
  const n = pendingCount(board);
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  if (!bar) return;
  bar.style.display = n ? "flex" : "none";
  if (text) text.textContent = n ? `✏️ ${n} unsaved allocation change${n > 1 ? "s" : ""} for ${board}` : "";
}

async function ensureBoardBundle(board) {
  if (ALLOC_CACHE[board]) return ALLOC_CACHE[board];
  const bundle = await callApi("adminGetBoardAllocBundle", { board });
  ALLOC_CACHE[board] = bundle;
  return bundle;
}

/* Effective (base + pending) map of courseCode -> {email, pending?:true} */
function effectiveAllocByCode(board) {
  const bundle = ALLOC_CACHE[board];
  const map = {};
  if (!bundle) return map;
  bundle.matrixCourses.forEach(c => { if (c.allocatedTo) map[c.code] = { email: c.allocatedTo }; });
  Object.values(getPending(board)).forEach(ch => {
    if (ch.action === "allocate") map[ch.code] = { email: ch.email, pending: true };
    else if (ch.action === "unallocate") delete map[ch.code];
  });
  return map;
}

/* Effective per-faculty allocation counts (base + pending deltas) */
function effectiveCountByEmail(board) {
  const bundle = ALLOC_CACHE[board];
  const counts = {};
  if (!bundle) return counts;
  bundle.matrix.forEach(row => { counts[norm(row.email)] = row.allocCount; });
  Object.values(getPending(board)).forEach(ch => {
    const k = norm(ch.email);
    if (ch.action === "allocate") counts[k] = (counts[k] || 0) + 1;
    else if (ch.action === "unallocate") counts[k] = Math.max(0, (counts[k] || 0) - 1);
  });
  return counts;
}

function effectiveNotAllotted(board) {
  const bundle = ALLOC_CACHE[board];
  if (!bundle) return [];
  const allocMap = effectiveAllocByCode(board);
  return bundle.matrixCourses.filter(c => !allocMap[c.code]).map(c => c.code);
}

/* Stage a change locally — no network call.
   For 'unallocate', the original allotted email (if any) is looked
   up from the base bundle so the faculty count is decremented for
   the right person. If the course was only staged as a *pending*
   allocation (never actually saved), unallocate just un-stages it. */
function stagePendingChange(board, entry) {
  const pending = getPending(board);
  const bundle = ALLOC_CACHE[board];
  const courseMeta = bundle.matrixCourses.find(c => c.code === entry.code) || {};
  const originalEmail = courseMeta.allocatedTo || null;

  if (entry.action === "unallocate") {
    if (!originalEmail) {
      delete pending[entry.code]; // was only a pending allocation — cancel the stage
      return;
    }
    pending[entry.code] = { code: entry.code, action: "unallocate", email: originalEmail };
    return;
  }
  pending[entry.code] = entry; // {code, name, email, facultyName, action:'allocate'}
}

async function saveAllocChanges(board, rerender) {
  const changes = Object.values(getPending(board));
  if (!changes.length) return;

  const missing = effectiveNotAllotted(board);
  if (missing.length) {
    const ok = window.confirm(
      `${missing.length} course(s) in ${board} will still be unallotted after saving:\n\n` +
      missing.join(", ") +
      `\n\nSave anyway?`
    );
    if (!ok) return;
  }

  try {
    const bundle = await callApi("adminBatchAllocate", { board, changes });
    ALLOC_CACHE[board] = bundle;   // one fresh bundle back from the batch call
    ALLOC_PENDING[board] = {};
    toast(`Saved ${changes.length} allocation change${changes.length > 1 ? "s" : ""}.`, "success");
    rerender();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------------- QP Allocation (course-wise) ---------------- */
async function loadAllocation(board) {
  const wrap = document.getElementById("allocWrap");
  const bannerWrap = document.getElementById("allocNotAllottedWrap");
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">📝</div>Choose a board to begin allocation.</div>`; bannerWrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    await ensureBoardBundle(board);
    renderAllocation(board);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderAllocation(board) {
  const bundle = ALLOC_CACHE[board];
  const allocMap = effectiveAllocByCode(board);
  const countByEmail = effectiveCountByEmail(board);

  renderNotAllottedBanner("allocNotAllottedWrap", effectiveNotAllotted(board));
  updateSaveBar(board, "allocSaveBar", "allocPendingText");

  const wrap = document.getElementById("allocWrap");
  wrap.innerHTML = bundle.courseWise.map(c => {
    const eff = allocMap[c.code];
    let badgeName = null, rating = null, isPending = false;
    if (eff) {
      isPending = !!eff.pending;
      if (isPending) {
        badgeName = getPending(board)[c.code].facultyName;
      } else {
        badgeName = c.allocatedFaculty ? c.allocatedFaculty.name : eff.email;
        rating = c.allocatedFaculty ? c.allocatedFaculty.rating : null;
      }
    }
    return `
    <div class="card mb-16" style="border-color:var(--line)">
      <div class="card-head">
        <div>
          <h3 style="margin:0">${c.code} — ${c.name}</h3>
          <div class="muted" style="font-size:12px">${c.year} / ${c.sem}</div>
        </div>
        ${eff
          ? `<span class="badge ${isPending ? "badge-warn" : "badge-success"}">${isPending ? "Pending: " : "Allotted: "}${badgeName}</span>`
          : `<span class="badge badge-lock">Not allotted</span>`}
      </div>
      <div class="card-pad">
        ${eff ? `
          <div class="flex-between">
            <div class="muted" style="font-size:13.5px">${rating ? `Rating: <strong>${rating} · ${RATING_LABELS[rating]}</strong>` : (isPending ? "Staged — not saved yet" : "")}</div>
            <button class="btn btn-outline btn-sm unallocBtn" data-code="${c.code}">Remove allocation</button>
          </div>
        ` : (c.candidates.length ? `
          <div class="table-wrap">
          <table>
            <thead><tr><th>Faculty</th><th>Rating</th><th>Current allocations</th><th></th></tr></thead>
            <tbody>
              ${c.candidates.map(cand => {
                const liveCount = countByEmail[norm(cand.email)] ?? cand.currentAllocCount;
                return `
                <tr>
                  <td>${cand.name}</td>
                  <td><span class="badge badge-gold">${cand.rating} · ${RATING_LABELS[cand.rating]}</span></td>
                  <td class="muted">${liveCount} / 3</td>
                  <td>
                    ${liveCount >= 3
                      ? `<span class="q-lock">🔒 Max reached</span>`
                      : `<button class="btn btn-sm btn-primary allocBtn" data-code="${c.code}" data-name="${c.name}" data-email="${cand.email}" data-facname="${cand.name}">Allocate</button>`}
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
          </div>
        ` : `<div class="muted" style="font-size:13.5px">No eligible faculty (excluding those already handling it this semester) have rated this course yet.</div>`)}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".allocBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const { code, name, email, facname } = e.target.dataset;
      stagePendingChange(board, { code, name, email, facultyName: facname, action: "allocate" });
      renderAllocation(board);
    });
  });
  wrap.querySelectorAll(".unallocBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      stagePendingChange(board, { code: e.target.dataset.code, action: "unallocate" });
      renderAllocation(board);
    });
  });
}

/* ---------------- Faculty-wise preference list ---------------- */
async function loadFacultyPreferences(board) {
  const wrap = document.getElementById("facPrefWrap");
  const bannerWrap = document.getElementById("facPrefNotAllottedWrap");
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">🧑‍🏫</div>Choose a board to view faculty preferences.</div>`; bannerWrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    await ensureBoardBundle(board);
    renderFacultyPreferences(board);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderFacultyPreferences(board) {
  const bundle = ALLOC_CACHE[board];
  const allocMap = effectiveAllocByCode(board);
  const countByEmail = effectiveCountByEmail(board);
  renderNotAllottedBanner("facPrefNotAllottedWrap", effectiveNotAllotted(board));
  updateSaveBar(board, "facPrefSaveBar", "facPrefPendingText");

  const wrap = document.getElementById("facPrefWrap");
  if (!bundle.facultyPref.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">🧑‍🏫</div>No faculty have submitted ratings for this board yet.</div>`;
    return;
  }

  wrap.innerHTML = bundle.facultyPref.map(f => {
    const liveCount = countByEmail[norm(f.email)] ?? f.allocCount;
    return `
    <div class="card mb-16" style="border-color:var(--line)">
      <div class="card-head">
        <div>
          <h3 style="margin:0">${f.name}</h3>
          <div class="muted" style="font-size:12px">${f.dept || "—"}</div>
        </div>
        <span class="badge ${liveCount >= 3 ? "badge-lock" : "badge-gold"}">${liveCount} / 3 allotted</span>
      </div>
      <div class="card-pad">
        <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Course</th><th>Rating (preference)</th><th>Handled this sem</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${f.preferences.map(pref => {
              const eff = allocMap[pref.code];
              const allocatedToSelf = !!(eff && norm(eff.email) === norm(f.email));
              const allocatedToOther = !!(eff && norm(eff.email) !== norm(f.email));
              const isPendingSelf = allocatedToSelf && eff.pending;
              return `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:600">${pref.code}</td>
                <td>${pref.name}</td>
                <td><span class="badge badge-gold">${pref.rating} · ${RATING_LABELS[pref.rating]}</span></td>
                <td>${pref.handled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-lock">No</span>'}</td>
                <td>
                  ${allocatedToSelf ? `<span class="badge ${isPendingSelf ? "badge-warn" : "badge-success"}">${isPendingSelf ? "Pending — allotted to them" : "Allotted to them"}</span>`
                    : allocatedToOther ? '<span class="badge badge-warn">Allotted elsewhere</span>'
                    : pref.handled ? '<span class="muted">Not eligible (handling)</span>'
                    : '<span class="badge badge-lock">Not allotted</span>'}
                </td>
                <td>
                  ${allocatedToSelf
                    ? `<button class="btn btn-outline btn-sm facPrefUnallocBtn" data-code="${pref.code}">Remove</button>`
                    : (!eff && !pref.handled
                        ? (liveCount >= 3
                            ? `<span class="q-lock">🔒 Max reached</span>`
                            : `<button class="btn btn-sm btn-primary facPrefAllocBtn" data-code="${pref.code}" data-name="${pref.name}" data-email="${f.email}" data-facname="${f.name}">Allocate</button>`)
                        : "")}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        </div>
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".facPrefAllocBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const { code, name, email, facname } = e.target.dataset;
      stagePendingChange(board, { code, name, email, facultyName: facname, action: "allocate" });
      renderFacultyPreferences(board);
    });
  });
  wrap.querySelectorAll(".facPrefUnallocBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      stagePendingChange(board, { code: e.target.dataset.code, action: "unallocate" });
      renderFacultyPreferences(board);
    });
  });
}

/* ---------------- Board-wise faculty x course matrix ---------------- */
async function loadBoardMatrix(board) {
  const wrap = document.getElementById("matrixWrap");
  const bannerWrap = document.getElementById("matrixNotAllottedWrap");
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">🔲</div>Choose a board to view the matrix.</div>`; bannerWrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    await ensureBoardBundle(board);
    renderBoardMatrix(board);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderBoardMatrix(board) {
  const bundle = ALLOC_CACHE[board];
  const allocMap = effectiveAllocByCode(board);
  const countByEmail = effectiveCountByEmail(board);
  renderNotAllottedBanner("matrixNotAllottedWrap", effectiveNotAllotted(board));
  updateSaveBar(board, "matrixSaveBar", "matrixPendingText");

  const wrap = document.getElementById("matrixWrap");
  if (!bundle.matrix.length || !bundle.matrixCourses.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">🔲</div>No ratings submitted for this board yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="position:sticky;left:0;background:#FBFBFD">Faculty</th>
          ${bundle.matrixCourses.map(c => {
            const eff = allocMap[c.code];
            return `<th title="${c.name}" style="text-align:center">${c.code}${eff ? (eff.pending ? " 🟡" : " 🔒") : ""}</th>`;
          }).join("")}
          <th>Allotted</th>
        </tr>
      </thead>
      <tbody>
        ${bundle.matrix.map(row => {
          const liveCount = countByEmail[norm(row.email)] ?? row.allocCount;
          return `
          <tr data-email="${row.email}">
            <td style="position:sticky;left:0;background:#fff;font-weight:600">${row.name}<div class="muted" style="font-weight:400;font-size:11px">${row.dept || ""}</div></td>
            ${row.cells.map(cell => {
              if (cell.rating == null) return `<td class="center muted">—</td>`;
              const eff = allocMap[cell.code];
              const isSelf = !!(eff && norm(eff.email) === norm(row.email));
              const isOther = !!(eff && norm(eff.email) !== norm(row.email));
              if (isSelf && eff.pending) {
                return `<td class="center"><button class="btn btn-sm matrixUndoBtn" style="background:#FFF6E5;border:1px solid #F0C36D" data-code="${cell.code}" title="Pending — click to undo">${cell.rating} ⏳</button></td>`;
              }
              if (isSelf) {
                return `<td class="center"><button class="btn btn-sm matrixRemoveBtn" style="background:#E6F4EA;border:1px solid #34A853" data-code="${cell.code}" title="Allotted to ${row.name} — click to remove">${cell.rating} ✓</button></td>`;
              }
              if (isOther) return `<td class="center"><span class="badge badge-lock" title="Allotted to another faculty member">${cell.rating}</span></td>`;
              if (cell.handled) return `<td class="center"><span class="badge badge-lock" title="Already handling this course">${cell.rating}</span></td>`;
              return `<td class="center"><button class="btn btn-sm btn-outline matrixCellBtn" data-code="${cell.code}" data-email="${row.email}" data-name="${row.name}" title="Allocate ${cell.code} to ${row.name}">${cell.rating}</button></td>`;
            }).join("")}
            <td class="center"><span class="badge ${liveCount >= 3 ? "badge-lock" : "badge-gold"}">${liveCount}/3</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
    <div class="hint mt-16">Green ✓ = allotted to that faculty (click to remove) · yellow ⏳ = staged, not saved yet (click to undo) · grey number = rated but not available · outlined button = click to allocate.</div>
  `;

  wrap.querySelectorAll(".matrixCellBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const { code, name, email } = e.target.dataset;
      const courseName = (bundle.matrixCourses.find(c => c.code === code) || {}).name || "";
      stagePendingChange(board, { code, name: courseName, email, facultyName: name, action: "allocate" });
      renderBoardMatrix(board);
    });
  });
  wrap.querySelectorAll(".matrixUndoBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      delete getPending(board)[e.target.dataset.code];
      renderBoardMatrix(board);
    });
  });
  wrap.querySelectorAll(".matrixRemoveBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      stagePendingChange(board, { code: e.target.dataset.code, action: "unallocate" });
      renderBoardMatrix(board);
    });
  });
}

/* ---------------- Allocation summary report (board-wise, faculty-wise, total) ---------------- */
let currentAllocReport = null;

async function loadAllocReport() {
  const wrap = document.getElementById("allocReportWrap");
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    currentAllocReport = await callApi("adminGetAllocationSummaryReport", {});
    renderAllocReport();
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderAllocReport() {
  const wrap = document.getElementById("allocReportWrap");
  if (!currentAllocReport || !currentAllocReport.boards.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">📈</div>No allocations have been made yet.</div>`;
    return;
  }
  wrap.innerHTML = currentAllocReport.boards.map(b => `
    <h4 style="font-size:14px;margin:16px 0 8px">${b.board} Board</h4>
    <div class="table-wrap mb-16">
    <table>
      <thead><tr><th>Faculty</th><th>Dept</th><th>Total allotted</th><th>Course codes</th></tr></thead>
      <tbody>
        ${b.faculty.map(f => `
          <tr>
            <td><strong>${f.name}</strong></td>
            <td class="muted">${f.dept || "—"}</td>
            <td><span class="badge badge-gold">${f.total}</span></td>
            <td style="font-family:var(--font-mono);font-size:12.5px">${f.codes}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>
  `).join("");
}

document.getElementById("refreshAllocReportBtn").addEventListener("click", loadAllocReport);

document.getElementById("exportAllocReportExcelBtn").addEventListener("click", () => {
  if (!currentAllocReport || !currentAllocReport.boards.length) { toast("Nothing to export yet.", "error"); return; }
  const rows = [];
  currentAllocReport.boards.forEach(b => {
    b.faculty.forEach(f => rows.push({
      Board: b.board, Faculty: f.name, Dept: f.dept, Total_Allotted: f.total, Course_Codes: f.codes
    }));
  });
  exportTableToExcel(rows, "Allocation_Summary_Report");
});

document.getElementById("exportAllocReportPdfBtn").addEventListener("click", () => {
  if (!currentAllocReport || !currentAllocReport.boards.length) { toast("Nothing to export yet.", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text("Board-wise · Faculty-wise Allocation Summary", 14, 16);
  let y = 24;
  currentAllocReport.boards.forEach(b => {
    if (y > 260) { doc.addPage(); y = 16; }
    doc.setFontSize(11);
    doc.text(`${b.board} Board`, 14, y);
    doc.autoTable({
      startY: y + 4,
      head: [["Faculty", "Dept", "Total", "Course Codes"]],
      body: b.faculty.map(f => [f.name, f.dept || "—", String(f.total), f.codes]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 35, 63] },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 12;
  });
  doc.save("Allocation_Summary_Report.pdf");
});

/* ---------------- Print / Export ---------------- */
let currentPrintData = null;

async function loadPrintSheet(board) {
  const sheet = document.getElementById("printSheet");
  if (!board) { sheet.style.display = "none"; return; }
  showBlockingLoader("Preparing print sheet...");
  try {
    currentPrintData = await callApi("adminGetPrintData", { board });
    document.getElementById("printBoardTitle").textContent = board + " Board";
    document.getElementById("printBody").innerHTML = `
      <div class="table-wrap">
      <table>
        <thead><tr><th>Year/Sem</th><th>Code</th><th>Course Name</th><th>Allotted Faculty</th><th>Competency Rating</th></tr></thead>
        <tbody>
        ${currentPrintData.rows.map(r => `
          <tr>
            <td>${r.year}/${r.sem}</td>
            <td style="font-family:var(--font-mono)">${r.code}</td>
            <td>${r.name}</td>
            <td>${r.facultyName || "—"}</td>
            <td>${r.rating ? `${r.rating} · ${RATING_LABELS[r.rating]}` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      </div>
      <div class="muted mt-24" style="font-size:11.5px">Generated on ${new Date().toLocaleString()} · Kamaraj Engineering College of Engineering and Technology, Controller of Examination</div>
    `;
    sheet.style.display = "block";
  } catch (e) {
    toast(e.message, "error");
  } finally {
    hideBlockingLoader();
  }
}

document.getElementById("printNowBtn").addEventListener("click", () => {
  if (!currentPrintData) { toast("Choose a board first.", "error"); return; }
  window.print();
});

document.getElementById("printExportPdfBtn").addEventListener("click", () => {
  if (!currentPrintData) { toast("Choose a board first.", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text("Kamaraj Engineering College of Engineering and Technology", 14, 16);
  doc.setFontSize(11);
  doc.text(`Board-wise Course Allocation & Faculty Competency — ${currentPrintData.board} Board`, 14, 23);
  doc.autoTable({
    startY: 30,
    head: [["Year/Sem", "Code", "Course Name", "Allotted Faculty", "Rating"]],
    body: currentPrintData.rows.map(r => [`${r.year}/${r.sem}`, r.code, r.name, r.facultyName || "—", r.rating ? `${r.rating} - ${RATING_LABELS[r.rating]}` : "—"]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [22, 35, 63] }
  });
  doc.save(`Allocation_${currentPrintData.board}.pdf`);
});

/* ---------------- Helpers ---------------- */
function exportTableToExcel(rows, filename) {
  if (!rows.length) { toast("Nothing to export.", "error"); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename + ".xlsx");
}
