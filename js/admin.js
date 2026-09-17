(function () {
  "use strict";

  var Store = window.LunchStore;
  var DAYS = Store.WEEKDAYS_FULL;
  var d = Store.parseDate;
  var fmt = Store.formatShort;

  // Kept only in this tab's sessionStorage (cleared when the tab closes) so
  // a reload doesn't force re-typing the password. Never sent anywhere
  // except as the p_password argument to the admin_* RPCs, which re-check
  // it against the bcrypt hash in Supabase on every call — see schema.sql.
  var SESSION_KEY = "lunchbokning:admin-password";
  var password = null;

  var loginCard = document.getElementById("login-card");
  var adminContent = document.getElementById("admin-content");
  var passwordInput = document.getElementById("admin-password");
  var loginBtn = document.getElementById("login-btn");
  var loginError = document.getElementById("login-error");
  var logoutBtn = document.getElementById("logout-btn");
  var pendingBody = document.getElementById("pending-body");
  var pendingEmpty = document.getElementById("pending-empty");
  var body = document.getElementById("bookings-body");
  var empty = document.getElementById("bookings-empty");

  function formatBookedAt(iso) {
    var dt = new Date(iso);
    return dt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  }

  function addRow(tbody, b, actionButtons) {
    var tr = document.createElement("tr");
    var dayLabel = DAYS[d(b.date).getDay()] + " " + fmt(d(b.date));
    [b.employee_name, dayLabel, b.time, b.place, formatBookedAt(b.booked_at)].forEach(function (text) {
      var td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });

    var actionTd = document.createElement("td");
    actionTd.style.display = "flex";
    actionTd.style.gap = "8px";
    actionButtons.forEach(function (spec) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = spec.label;
      btn.addEventListener("click", async function () {
        actionTd.querySelectorAll("button").forEach(function (b2) { b2.disabled = true; });
        try {
          await spec.onClick();
          loadAndRender();
        } catch (e) {
          actionTd.querySelectorAll("button").forEach(function (b2) { b2.disabled = false; });
        }
      });
      actionTd.appendChild(btn);
    });
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  }

  function renderRows(bookings) {
    var pending = bookings.filter(function (b) { return b.status === "pending"; });
    var confirmed = bookings.filter(function (b) { return b.status !== "pending"; });

    pendingBody.innerHTML = "";
    pendingEmpty.hidden = pending.length > 0;
    pending.forEach(function (b) {
      addRow(pendingBody, b, [
        { label: "Godkän", onClick: function () { return Store.adminApproveBooking(password, b.id); } },
        { label: "Neka", onClick: function () { return Store.adminDeleteBooking(password, b.id); } }
      ]);
    });

    body.innerHTML = "";
    empty.hidden = confirmed.length > 0;
    confirmed.forEach(function (b) {
      addRow(body, b, [
        { label: "Ta bort", onClick: function () { return Store.adminDeleteBooking(password, b.id); } }
      ]);
    });
  }

  async function loadAndRender() {
    try {
      var bookings = await Store.adminListBookings(password);
      renderRows(bookings);
    } catch (e) {
      logOut();
      loginError.textContent = "Fel lösenord.";
      loginError.hidden = false;
    }
  }

  function showLoggedIn() {
    loginCard.hidden = true;
    adminContent.hidden = false;
    loadAndRender();
  }

  function showLoggedOut() {
    loginCard.hidden = false;
    adminContent.hidden = true;
  }

  function logOut() {
    password = null;
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    showLoggedOut();
  }

  loginBtn.addEventListener("click", async function () {
    loginError.hidden = true;
    loginBtn.disabled = true;
    var candidate = passwordInput.value;
    try {
      await Store.adminListBookings(candidate); // throws if wrong
      password = candidate;
      try { window.sessionStorage.setItem(SESSION_KEY, password); } catch (e) { /* ignore */ }
      passwordInput.value = "";
      showLoggedIn();
    } catch (e) {
      loginError.textContent = "Fel lösenord.";
      loginError.hidden = false;
    } finally {
      loginBtn.disabled = false;
    }
  });

  passwordInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") loginBtn.click();
  });

  logoutBtn.addEventListener("click", logOut);

  (function init() {
    var remembered = null;
    try { remembered = window.sessionStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    if (remembered) {
      password = remembered;
      showLoggedIn();
    } else {
      showLoggedOut();
    }
  })();
})();
