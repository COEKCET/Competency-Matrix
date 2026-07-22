Session.clear();

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const loginBtnText = document.getElementById("loginBtnText");

let pendingUser = null; // used while password-change modal is open

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const id = document.getElementById("loginId").value.trim();
  const pass = document.getElementById("loginPass").value;

  if (!id || !pass) {
    loginError.textContent = "Please enter both fields.";
    return;
  }

  loginBtn.disabled = true;
  loginBtnText.innerHTML = '<span class="loader" style="width:14px;height:14px"></span>';

  try {
    // Role is decided entirely by the backend (Code.gs) based on the
    // FacultyDB sheet. The frontend never hardcodes who is admin/faculty.
    const result = await callApi("login", { id, password: pass });

    if (result.mustChangePassword) {
      pendingUser = result;
      document.getElementById("pwModal").style.display = "flex";
    } else {
      completeLogin(result);
    }
  } catch (err) {
    loginError.textContent = err.message || "Invalid credentials.";
  } finally {
    loginBtn.disabled = false;
    loginBtnText.textContent = "Sign in";
  }
});

function completeLogin(user) {
  Session.set(user);
  if (user.role === "admin") {
    window.location.href = "admin.html";
  } else {
    window.location.href = "faculty.html";
  }
}

// ---- Force password-change modal ----
document.getElementById("pwSaveBtn").addEventListener("click", async () => {
  const p1 = document.getElementById("newPass1").value;
  const p2 = document.getElementById("newPass2").value;
  const pwError = document.getElementById("pwError");
  pwError.textContent = "";

  if (!p1 || p1.length < 6) {
    pwError.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (p1 !== p2) {
    pwError.textContent = "Passwords do not match.";
    return;
  }

  const btn = document.getElementById("pwSaveBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const result = await callApi("changePassword", {
      id: pendingUser.email,
      oldPassword: null,
      newPassword: p1,
      firstTime: true
    });
    toast("Password updated successfully.", "success");
    completeLogin(result);
  } catch (err) {
    pwError.textContent = err.message || "Could not update password.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Save & Continue";
  }
});
