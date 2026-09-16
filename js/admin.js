(function () {
  "use strict";

  var Store = window.LunchStore;
  var DAYS = Store.WEEKDAYS_FULL;
  var d = Store.parseDate;
  var fmt = Store.formatShort;

  // The login form only asks for a password; Supabase Auth still needs an
  // email internally, so we pin every admin session to this one fixed,
  // non-mailbox address. Create this exact user (Authentication → Users →
  // Add user) in the Supabase dashboard and set its password there.
  var ADMIN_EMAIL = "admin@lunchbokning.internal";

  var loginCard = document.getElementById("login-card");
  var adminContent = document.getElementById("admin-content");
  var passwordInput = document.getElementById("admin-password");
  var loginBtn = document.getElementById("login-btn");
  var loginError = document.getElementById("login-error");
  var logoutBtn = document.getElementById("logout-btn");
  var body = document.getElementById("bookings-body");
  var empty = document.getElementById("bookings-empty");

  function formatBookedAt(iso) {
    var dt = new Date(iso);
    return dt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  }

  async function renderBookings() {
    var bookings;
    try {
      bookings = await Store.adminListBookings();
    } catch (e) {
      empty.hidden = false;
      empty.textContent = "Kunde inte hämta bokningar.";
      return;
    }

    body.innerHTML = "";
    empty.hidden = bookings.length > 0;
    empty.textContent = "Inga bokningar ännu.";

    bookings.forEach(function (b) {
      var tr = document.createElement("tr");
      var dayLabel = DAYS[d(b.date).getDay()] + " " + fmt(d(b.date));
      [b.employee_name, dayLabel, b.time, b.place, formatBookedAt(b.booked_at)].forEach(function (text) {
        var td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });

      var actionTd = document.createElement("td");
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-ghost";
      removeBtn.textContent = "Ta bort";
      removeBtn.addEventListener("click", async function () {
        removeBtn.disabled = true;
        try {
          await Store.adminDeleteBooking(b.id);
          renderBookings();
        } catch (e) {
          removeBtn.disabled = false;
        }
      });
      actionTd.appendChild(removeBtn);
      tr.appendChild(actionTd);

      body.appendChild(tr);
    });
  }

  function showLoggedIn() {
    loginCard.hidden = true;
    adminContent.hidden = false;
    renderBookings();
  }

  function showLoggedOut() {
    loginCard.hidden = false;
    adminContent.hidden = true;
  }

  loginBtn.addEventListener("click", async function () {
    loginError.hidden = true;
    loginBtn.disabled = true;
    try {
      await Store.signInWithPassword(ADMIN_EMAIL, passwordInput.value);
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

  logoutBtn.addEventListener("click", async function () {
    await Store.signOut();
    showLoggedOut();
  });

  (async function init() {
    var session = await Store.getSession();
    if (session) showLoggedIn();
    else showLoggedOut();
  })();
})();
