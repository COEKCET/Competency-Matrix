const user = Session.requireRole("faculty");
if (user) init();

let STATE = {
  profile: null,
  courses: [],       // flat list from all boards
  boards: [],
  responses: {},      // courseCode -> {rating, handled, board, courseName, year, sem}
  locked: false,       // hard lock by admin (cannot enter at all)
  submitted: false,    // already submitted final
  editAllowed: false,  // admin granted edit after submission
  systemLocked: false, // global lock switch
  visitedBoards: new Set() // boards the faculty has opened — every course in these must be rated before submit
};

async function init() {
  document.getElementById("whoName").textContent = user.name || user.email;
  bindTabs();
  bindTopActions();
  bindMatrixEvents();
  bindReviewEvents();

  showBlockingLoader("Loading your workspace...");
  try {
    const data = await callApi("getFacultyData", { email: user.email });
    STATE.profile = data.profile;
    STATE.courses = data.courses;
    STATE.boards = data.boards;
    STATE.locked = data.profile.locked;
    STATE.submitted = data.profile.submitted;
    STATE.editAllowed = data.profile.editAllowed;
    STATE.systemLocked = data.systemLocked;
    (data.existingResponses || []).forEach(r => {
      STATE.responses[r.courseCode] = r;
    });

    renderProfile();
    renderBoardOptions();
    renderStatusBanner();
    applyLockUI();
  } catch (err) {
    toast(err.message, "error", 6000);
  } finally {
    hideBlockingLoader();
  }
}

/* ---------------- Tabs ---------------- */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "review") renderReview();
    });
  });
}

/* ---------------- Top actions ---------------- */
function bindTopActions() {
  document.getElementById("logoutBtn").addEventListener("click", () => {
    Session.clear();
    window.location.href = "index.html";
  });

  document.getElementById("changePwBtn").addEventListener("click", () => {
    document.getElementById("pwModal").style.display = "flex";
  });
  document.getElementById("pwCancelBtn").addEventListener("click", () => {
    document.getElementById("pwModal").style.display = "none";
  });
  document.getElementById("pwUpdateBtn").addEventListener("click", async () => {
    const cur = document.getElementById("curPass").value;
    const p1 = document.getElementById("np1").value;
    const p2 = document.getElementById("np2").value;
    const err = document.getElementById("pwModalError");
    err.textContent = "";
    if (!cur || !p1 || !p2) { err.textContent = "Please fill all fields."; return; }
    if (p1.length < 6) { err.textContent = "New password must be at least 6 characters."; return; }
    if (p1 !== p2) { err.textContent = "New passwords do not match."; return; }
    try {
      await callApi("changePassword", { id: user.email, oldPassword: cur, newPassword: p1, firstTime: false });
      toast("Password updated.", "success");
      document.getElementById("pwModal").style.display = "none";
    } catch (e) {
      err.textContent = e.message;
    }
  });
}

/* ---------------- Profile ---------------- */
function renderProfile() {
  const p = STATE.profile;
  document.getElementById("deptBadge").textContent = p.dept || "—";
  const fields = [
    ["Name", p.name], ["Department", p.dept], ["Designation", p.designation],
    ["Official Email", p.email], ["Mobile Number", p.mobile],
    ["KCET Staff ID", p.staffId], ["AICTE / Anna Univ. Code", p.facultyCode]
  ];
  document.getElementById("profileGrid").innerHTML = fields.map(([label, val]) => `
    <div>
      <label style="margin-bottom:3px">${label}</label>
      <div style="font-size:14.5px;font-weight:600">${val || "—"}</div>
    </div>
  `).join("");

  document.getElementById("expYears").value = p.expYears ?? "";
  document.getElementById("expMonths").value = p.expMonths ?? "";
}

document.getElementById("saveExpBtn").addEventListener("click", async () => {
  const y = parseInt(document.getElementById("expYears").value || "0", 10);
  const m = parseInt(document.getElementById("expMonths").value || "0", 10);
  try {
    await callApi("updateExperience", { email: user.email, years: y, months: m });
    toast("Experience updated.", "success");
    STATE.profile.expYears = y;
    STATE.profile.expMonths = m;
  } catch (e) {
    toast(e.message, "error");
  }
});

/* ---------------- Status banner / lock handling ---------------- */
function renderStatusBanner() {
  const el = document.getElementById("statusBanner");
  el.style.display = "block";
  if (STATE.systemLocked) {
    el.innerHTML = `<div class="locked-banner">🔒 Data entry is currently closed by the CoE office. Please check back later.</div>`;
  } else if (STATE.locked) {
    el.innerHTML = `<div class="locked-banner">🔒 Your entry has been locked by the admin. Contact the CoE office if you believe this is an error.</div>`;
  } else if (STATE.submitted && !STATE.editAllowed) {
    el.innerHTML = `<div class="submitted-banner">✅ You have already submitted your competency matrix.
      <button class="btn btn-sm btn-outline" id="requestEditBtn" style="margin-left:auto">Request Edit Permission</button></div>`;
    document.getElementById("requestEditBtn").addEventListener("click", requestEdit);
  } else if (STATE.submitted && STATE.editAllowed) {
    el.innerHTML = `<div class="locked-banner">✏️ The admin has granted you edit access. Update your responses and submit again.</div>`;
  } else {
    el.style.display = "none";
  }
}

async function requestEdit() {
  try {
    await callApi("requestEdit", { email: user.email });
    toast("Edit request sent to admin.", "success");
    document.getElementById("requestEditBtn").disabled = true;
    document.getElementById("requestEditBtn").textContent = "Request Sent";
  } catch (e) {
    toast(e.message, "error");
  }
}

function isReadOnly() {
  return STATE.systemLocked || STATE.locked || (STATE.submitted && !STATE.editAllowed);
}

function applyLockUI() {
  const ro = isReadOnly();
  document.getElementById("saveProgressBtn").disabled = ro;
  document.getElementById("submitBtn").disabled = ro;
  document.getElementById("boardSelect").disabled = ro;
}

/* ---------------- Board / Course matrix ---------------- */
function renderBoardOptions() {
  const sel = document.getElementById("boardSelect");
  sel.innerHTML = '<option value="">Choose a board…</option>' +
    STATE.boards.map(b => `<option value="${b}">${b}</option>`).join("");
  // Preselect faculty's own department board if it exists in the list
  if (STATE.boards.includes(STATE.profile.dept)) {
    sel.value = STATE.profile.dept;
    renderCourseList(STATE.profile.dept);
  }
}

document.getElementById("boardSelect").addEventListener("change", (e) => {
  renderCourseList(e.target.value);
});

function renderCourseList(board) {
  const wrap = document.getElementById("courseListWrap");
  if (!board) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">📋</div>Choose a board above to view its courses.</div>`;
    return;
  }
  const courses = STATE.courses.filter(c => c.board === board);
  if (!courses.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">📭</div>No courses configured for this board yet.</div>`;
    return;
  }

  // store meta for later review/save (must happen before counting/highlighting)
  courses.forEach(c => {
    if (!STATE.responses[c.courseCode]) STATE.responses[c.courseCode] = {};
    Object.assign(STATE.responses[c.courseCode], {
      board: c.board, courseCode: c.courseCode, courseName: c.courseName, year: c.year, sem: c.sem
    });
  });
  STATE.visitedBoards.add(board);

  const ro = isReadOnly();
  const ratedCount = courses.filter(c => STATE.responses[c.courseCode] && STATE.responses[c.courseCode].rating).length;
  wrap.innerHTML = `
    <div class="flex-between mb-8">
      <span class="muted" style="font-size:12.5px">Rated <strong>${ratedCount}</strong> of <strong>${courses.length}</strong> courses — all must be rated before you can submit.</span>
    </div>
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Year / Sem</th><th>Course Code</th><th>Course Name</th>
        <th>Handled this semester?</th><th class="ladder-cell">Your Competency Rating</th>
      </tr></thead>
      <tbody>
        ${courses.map(c => {
          const resp = STATE.responses[c.courseCode] || {};
          return `
          <tr data-code="${c.courseCode}" class="${!resp.rating ? "row-missing" : ""}">
            <td class="muted">${c.year} / ${c.sem}</td>
            <td style="font-family:var(--font-mono);font-weight:600">${c.courseCode}</td>
            <td>${c.courseName}</td>
            <td>
              <label class="switch">
                <input type="checkbox" class="handledToggle" ${resp.handled ? "checked" : ""} ${ro ? "disabled" : ""}>
                <span class="slider"></span>
              </label>
            </td>
            <td>
              <div class="rating-ladder" data-code="${c.courseCode}">
                ${[1,2,3,4,5].map(v => `<div class="rung ${resp.rating == v ? "active" : ""}" data-v="${v}" title="${RATING_LABELS[v]}">${v}</div>`).join("")}
              </div>
              <div class="ladder-label">${resp.rating ? RATING_LABELS[resp.rating] : "Not rated"}</div>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  `;
}

function bindMatrixEvents() {
  const wrap = document.getElementById("courseListWrap");
  wrap.addEventListener("click", (e) => {
    if (isReadOnly()) return;
    const rung = e.target.closest(".rung");
    if (!rung) return;
    const ladder = rung.closest(".rating-ladder");
    const code = ladder.dataset.code;
    const val = parseInt(rung.dataset.v, 10);
    const wasUnrated = !STATE.responses[code].rating;
    STATE.responses[code].rating = val;
    ladder.querySelectorAll(".rung").forEach(r => r.classList.toggle("active", parseInt(r.dataset.v, 10) === val));
    ladder.parentElement.querySelector(".ladder-label").textContent = RATING_LABELS[val];
    const row = ladder.closest("tr");
    if (row) row.classList.remove("row-missing");
    if (wasUnrated) {
      const counterEl = wrap.querySelector(".flex-between .muted strong");
      if (counterEl) counterEl.textContent = String(parseInt(counterEl.textContent, 10) + 1);
    }
  });
  wrap.addEventListener("change", (e) => {
    if (isReadOnly()) return;
    if (e.target.classList.contains("handledToggle")) {
      const code = e.target.closest("tr").dataset.code;
      STATE.responses[code].handled = e.target.checked;
    }
  });

  document.getElementById("saveProgressBtn").addEventListener("click", saveProgress);
}

async function saveProgress() {
  const statusEl = document.getElementById("matrixSaveStatus");
  statusEl.textContent = "Saving...";
  try {
    const list = Object.values(STATE.responses).filter(r => r.courseCode && (r.rating || r.handled !== undefined));
    await callApi("saveDraftResponses", { email: user.email, responses: list });
    statusEl.textContent = "Saved just now.";
    toast("Progress saved.", "success");
  } catch (e) {
    statusEl.textContent = "";
    toast(e.message, "error");
  }
}

/* ---------------- Mandatory completion check ---------------- */
// A board is only "required" once the faculty has opened it (STATE.visitedBoards).
// Every course in a visited board must carry a rating — no skipping allowed.
function validateCompletion() {
  const missing = {};
  STATE.visitedBoards.forEach(board => {
    const courses = STATE.courses.filter(c => c.board === board);
    const missingCodes = courses
      .filter(c => !STATE.responses[c.courseCode] || !STATE.responses[c.courseCode].rating)
      .map(c => c.courseCode);
    if (missingCodes.length) missing[board] = missingCodes;
  });
  return { valid: Object.keys(missing).length === 0, missing };
}

function showMissingCoursesWarning(missing) {
  const boards = Object.keys(missing);
  const parts = boards.map(b => {
    const codes = missing[b];
    const shown = codes.slice(0, 6).join(", ") + (codes.length > 6 ? "…" : "");
    return `${b}: ${codes.length} not rated (${shown})`;
  });
  toast("Every course must be rated — none can be skipped. " + parts.join(" | "), "error", 8000);

  // Jump to the matrix tab, first incomplete board, and highlight the missing rows.
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="matrix"]').classList.add("active");
  document.getElementById("tab-matrix").classList.add("active");

  const firstBoard = boards[0];
  document.getElementById("boardSelect").value = firstBoard;
  renderCourseList(firstBoard);
}

/* ---------------- Review & Submit ---------------- */
function bindReviewEvents() {
  document.getElementById("submitBtn").addEventListener("click", () => {
    if (!STATE.visitedBoards.size) {
      toast("Please choose a board and rate its courses before submitting.", "error");
      return;
    }
    const { valid, missing } = validateCompletion();
    if (!valid) { showMissingCoursesWarning(missing); return; }
    document.getElementById("submitModal").style.display = "flex";
  });
  document.getElementById("submitCancelBtn").addEventListener("click", () => {
    document.getElementById("submitModal").style.display = "none";
  });
  document.getElementById("submitConfirmBtn").addEventListener("click", finalSubmit);
}

function renderReview() {
  const rated = Object.values(STATE.responses).filter(r => r.rating || r.handled);
  const wrap = document.getElementById("reviewWrap");
  document.getElementById("reviewCount").textContent = rated.length ? `${rated.length} course(s) entered` : "";
  if (!rated.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="glyph">🗒️</div>No responses entered yet. Go to “Competency Ratings” to begin.</div>`;
    return;
  }
  const byBoard = {};
  rated.forEach(r => { (byBoard[r.board] = byBoard[r.board] || []).push(r); });

  wrap.innerHTML = Object.keys(byBoard).map(board => `
    <h4 style="font-size:14px;margin:18px 0 8px">${board} Board</h4>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Code</th><th>Course</th><th>Year/Sem</th><th>Handled</th><th>Rating</th></tr></thead>
      <tbody>
      ${byBoard[board].map(r => `
        <tr>
          <td style="font-family:var(--font-mono)">${r.courseCode}</td>
          <td>${r.courseName}</td>
          <td class="muted">${r.year}/${r.sem}</td>
          <td>${r.handled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-lock">No</span>'}</td>
          <td>${r.rating ? `<span class="badge badge-gold">${r.rating} · ${RATING_LABELS[r.rating]}</span>` : '<span class="badge badge-warn">Not rated</span>'}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    </div>
  `).join("");
}

async function finalSubmit() {
  const { valid, missing } = validateCompletion();
  if (!valid) {
    document.getElementById("submitModal").style.display = "none";
    showMissingCoursesWarning(missing);
    return;
  }
  const btn = document.getElementById("submitConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Submitting...";
  try {
    const list = Object.values(STATE.responses).filter(r => r.rating);
    await callApi("submitFinalResponses", { email: user.email, responses: list });
    document.getElementById("submitModal").style.display = "none";
    toast("Your competency matrix has been submitted.", "success");
    STATE.submitted = true;
    STATE.editAllowed = false;
    renderStatusBanner();
    applyLockUI();
    renderCourseList(document.getElementById("boardSelect").value);
  } catch (e) {
    toast(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm & Submit";
  }
}
