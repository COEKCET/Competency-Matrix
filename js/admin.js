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

/* ---------------- QP Allocation (course-wise) ---------------- */
async function loadAllocation(board) {
  const wrap = document.getElementById("allocWrap");
  document.getElementById("allocNotAllottedWrap").innerHTML = "";
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">📝</div>Choose a board to begin allocation.</div>`; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    const data = await callApi("adminGetAllocationData", { board });
    renderNotAllottedBanner("allocNotAllottedWrap", data.notAllotted);
    renderAllocation(board, data);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderAllocation(board, data) {
  const wrap = document.getElementById("allocWrap");
  wrap.innerHTML = data.courses.map(c => {
    const allotted = c.allocatedFaculty;
    return `
    <div class="card mb-16" style="border-color:var(--line)">
      <div class="card-head">
        <div>
          <h3 style="margin:0">${c.code} — ${c.name}</h3>
          <div class="muted" style="font-size:12px">${c.year} / ${c.sem}</div>
        </div>
        ${allotted ? `<span class="badge badge-success">Allotted: ${allotted.name}</span>` : `<span class="badge badge-lock">Not allotted</span>`}
      </div>
      <div class="card-pad">
        ${allotted ? `
          <div class="flex-between">
            <div class="muted" style="font-size:13.5px">Rating: <strong>${allotted.rating} · ${RATING_LABELS[allotted.rating]}</strong></div>
            <button class="btn btn-outline btn-sm unallocBtn" data-code="${c.code}">Remove allocation</button>
          </div>
        ` : (c.candidates.length ? `
          <div class="table-wrap">
          <table>
            <thead><tr><th>Faculty</th><th>Rating</th><th>Current allocations</th><th></th></tr></thead>
            <tbody>
              ${c.candidates.map(cand => `
                <tr>
                  <td>${cand.name}</td>
                  <td><span class="badge badge-gold">${cand.rating} · ${RATING_LABELS[cand.rating]}</span></td>
                  <td class="muted">${cand.currentAllocCount} / 3</td>
                  <td>
                    ${cand.currentAllocCount >= 3
                      ? `<span class="q-lock">🔒 Max reached</span>`
                      : `<button class="btn btn-sm btn-primary allocBtn" data-code="${c.code}" data-name="${c.name}" data-email="${cand.email}">Allocate</button>`}
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
          </div>
        ` : `<div class="muted" style="font-size:13.5px">No eligible faculty (excluding those already handling it this semester) have rated this course yet.</div>`)}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".allocBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const { code, name, email } = e.target.dataset;
      try {
        await callApi("adminAllocateFaculty", { board, code, name, email });
        toast("Faculty allocated.", "success");
        loadAllocation(board);
      } catch (err) { toast(err.message, "error"); }
    });
  });
  wrap.querySelectorAll(".unallocBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const code = e.target.dataset.code;
      try {
        await callApi("adminUnallocate", { board, code });
        toast("Allocation removed.", "success");
        loadAllocation(board);
      } catch (err) { toast(err.message, "error"); }
    });
  });
}

/* ---------------- Faculty-wise preference list ---------------- */
async function loadFacultyPreferences(board) {
  const wrap = document.getElementById("facPrefWrap");
  document.getElementById("facPrefNotAllottedWrap").innerHTML = "";
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">🧑‍🏫</div>Choose a board to view faculty preferences.</div>`; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    const data = await callApi("adminGetFacultyPreferenceList", { board });
    renderNotAllottedBanner("facPrefNotAllottedWrap", data.notAllotted);
    renderFacultyPreferences(board, data);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderFacultyPreferences(board, data) {
  const wrap = document.getElementById("facPrefWrap");
  if (!data.faculty.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">🧑‍🏫</div>No faculty have submitted ratings for this board yet.</div>`;
    return;
  }
  wrap.innerHTML = data.faculty.map(f => `
    <div class="card mb-16" style="border-color:var(--line)">
      <div class="card-head">
        <div>
          <h3 style="margin:0">${f.name}</h3>
          <div class="muted" style="font-size:12px">${f.dept || "—"}</div>
        </div>
        <span class="badge ${f.allocCount >= 3 ? 'badge-lock' : 'badge-gold'}">${f.allocCount} / 3 allotted</span>
      </div>
      <div class="card-pad">
        <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Course</th><th>Rating (preference)</th><th>Handled this sem</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${f.preferences.map(pref => `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:600">${pref.code}</td>
                <td>${pref.name}</td>
                <td><span class="badge badge-gold">${pref.rating} · ${RATING_LABELS[pref.rating]}</span></td>
                <td>${pref.handled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-lock">No</span>'}</td>
                <td>
                  ${pref.allocatedToSelf ? '<span class="badge badge-success">Allotted to them</span>'
                    : pref.allocatedToOther ? '<span class="badge badge-warn">Allotted elsewhere</span>'
                    : pref.handled ? '<span class="muted">Not eligible (handling)</span>'
                    : '<span class="badge badge-lock">Not allotted</span>'}
                </td>
                <td>
                  ${pref.allocatedToSelf
                    ? `<button class="btn btn-outline btn-sm facPrefUnallocBtn" data-code="${pref.code}">Remove</button>`
                    : (!pref.allocated && !pref.handled
                        ? (f.allocCount >= 3
                            ? `<span class="q-lock">🔒 Max reached</span>`
                            : `<button class="btn btn-sm btn-primary facPrefAllocBtn" data-code="${pref.code}" data-name="${pref.name}" data-email="${f.email}">Allocate</button>`)
                        : "")}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".facPrefAllocBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const { code, name, email } = e.target.dataset;
      try {
        await callApi("adminAllocateFaculty", { board, code, name, email });
        toast("Faculty allocated.", "success");
        loadFacultyPreferences(board);
      } catch (err) { toast(err.message, "error"); }
    });
  });
  wrap.querySelectorAll(".facPrefUnallocBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const code = e.target.dataset.code;
      try {
        await callApi("adminUnallocate", { board, code });
        toast("Allocation removed.", "success");
        loadFacultyPreferences(board);
      } catch (err) { toast(err.message, "error"); }
    });
  });
}

/* ---------------- Board-wise faculty x course matrix ---------------- */
async function loadBoardMatrix(board) {
  const wrap = document.getElementById("matrixWrap");
  document.getElementById("matrixNotAllottedWrap").innerHTML = "";
  if (!board) { wrap.innerHTML = `<div class="empty-state"><div class="glyph">🔲</div>Choose a board to view the matrix.</div>`; return; }
  wrap.innerHTML = `<div class="center" style="padding:30px"><div class="loader dark" style="margin:0 auto"></div></div>`;
  try {
    const data = await callApi("adminGetBoardMatrix", { board });
    renderNotAllottedBanner("matrixNotAllottedWrap", data.notAllotted);
    renderBoardMatrix(board, data);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderBoardMatrix(board, data) {
  const wrap = document.getElementById("matrixWrap");
  if (!data.matrix.length || !data.courses.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">🔲</div>No ratings submitted for this board yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="position:sticky;left:0;background:#FBFBFD">Faculty</th>
          ${data.courses.map(c => `<th title="${c.name}" style="text-align:center">${c.code}${c.allocatedTo ? ' 🔒' : ''}</th>`).join("")}
          <th>Allotted</th>
        </tr>
      </thead>
      <tbody>
        ${data.matrix.map(row => `
          <tr data-email="${row.email}">
            <td style="position:sticky;left:0;background:#fff;font-weight:600">${row.name}<div class="muted" style="font-weight:400;font-size:11px">${row.dept || ""}</div></td>
            ${row.cells.map(cell => {
              if (cell.rating == null) return `<td class="center muted">—</td>`;
              if (cell.allocated) return `<td class="center"><span class="badge badge-success" title="Allotted to ${row.name}">${cell.rating}</span></td>`;
              if (cell.allocatedToOther) return `<td class="center"><span class="badge badge-lock" title="Allotted to another faculty member">${cell.rating}</span></td>`;
              if (cell.handled) return `<td class="center"><span class="badge badge-lock" title="Already handling this course">${cell.rating}</span></td>`;
              return `<td class="center"><button class="btn btn-sm btn-outline matrixCellBtn" data-code="${cell.code}" data-email="${row.email}" data-name="${row.name}" title="Allocate ${cell.code} to ${row.name}">${cell.rating}</button></td>`;
            }).join("")}
            <td class="center"><span class="badge ${row.allocCount >= 3 ? 'badge-lock' : 'badge-gold'}">${row.allocCount}/3</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    </div>
    <div class="hint mt-16">Green = allotted to that faculty · grey number = rated but not available (already allotted elsewhere, or already handling it) · outlined button = click to allocate.</div>
  `;

  wrap.querySelectorAll(".matrixCellBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const { code, name, email } = e.target.dataset;
      const courseName = (data.courses.find(c => c.code === code) || {}).name || "";
      try {
        await callApi("adminAllocateFaculty", { board, code, name: courseName, email });
        toast(`Allocated ${code} to ${name}.`, "success");
        loadBoardMatrix(board);
      } catch (err) { toast(err.message, "error"); }
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
