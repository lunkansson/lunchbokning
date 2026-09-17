(function () {
  "use strict";

  var Store = window.LunchStore;
  var DAYS = Store.WEEKDAYS_FULL;
  var LUNCH_TIME = Store.LUNCH_TIME;
  var d = Store.parseDate;
  var fmt = Store.formatShort;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var VISIBLE_STEP = 8;
  var MAX_VISIBLE = 52; // about a year of Thursdays

  var state = {
    empId: "", dayKey: "",
    currentBooking: null, // { id, cancelToken }
    takenSlots: {},       // "date|time" -> true, refreshed from the server
    nextEligible: null,   // Date or null, refreshed per selected employee
    visibleCount: VISIBLE_STEP,
    busy: false
  };

  var el = {
    empSelect: document.getElementById("emp"),
    statusTitle: document.getElementById("status-title"),
    statusBody: document.getElementById("status-body"),
    cooldownPhrase: document.getElementById("cooldown-phrase"),
    cooldownLabel: document.getElementById("cooldown-label"),
    calendarHint: document.getElementById("calendar-hint"),
    thursdayList: document.getElementById("thursday-list"),
    loadMoreBtn: document.getElementById("load-more-btn"),
    timeSection: document.getElementById("time-section"),
    dayLine: document.getElementById("day-line"),
    placeInput: document.getElementById("place-input"),
    confirmBtn: document.getElementById("confirm-btn"),
    confirmHint: document.getElementById("confirm-hint"),
    bookingView: document.getElementById("booking-view"),
    confirmedView: document.getElementById("confirmed-view"),
    receiptTitle: document.getElementById("receipt-title"),
    receiptBody: document.getElementById("receipt-body"),
    receiptPlace: document.getElementById("receipt-place"),
    receiptNext: document.getElementById("receipt-next"),
    cancelBtn: document.getElementById("cancel-btn"),
    resetBtn: document.getElementById("reset-btn"),
    map: document.getElementById("map")
  };

  function isoOf(dt) {
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  function firstThursdayOnOrAfter(dt) {
    var day = new Date(dt);
    day.setDate(day.getDate() + ((4 - day.getDay() + 7) % 7));
    return day;
  }

  function upcomingThursdays(count) {
    var out = [];
    var cur = firstThursdayOnOrAfter(today);
    for (var i = 0; i < count; i++) {
      out.push(isoOf(cur));
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  }

  function currentEmployee() {
    return Store.EMPLOYEES.find(function (e) { return e.id === state.empId; }) || null;
  }

  function isSlotTaken(date, time) {
    return !!state.takenSlots[date + "|" + time];
  }

  function dayState(iso, emp, next) {
    if (isSlotTaken(iso, LUNCH_TIME)) return "full";
    if (emp && next && d(iso) < next) return "locked";
    return "open";
  }

  function populateEmployeeSelect() {
    Store.EMPLOYEES.forEach(function (e) {
      var opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      el.empSelect.appendChild(opt);
    });
  }

  function renderThursdayList(emp, next) {
    var isos = upcomingThursdays(state.visibleCount);
    el.thursdayList.innerHTML = "";

    isos.forEach(function (iso) {
      var st = dayState(iso, emp, next);
      var selected = state.dayKey === iso;
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "thu-pill";

      var label = document.createElement("span");
      label.textContent = DAYS[d(iso).getDay()] + " " + fmt(d(iso));
      var note = document.createElement("span");
      note.className = "thu-note";

      if (st === "full") {
        pill.classList.add("thu-pill--full");
        note.textContent = "Fullt";
        pill.disabled = true;
      } else if (st === "locked") {
        pill.classList.add("thu-pill--locked");
        note.textContent = "Låst";
        pill.disabled = true;
      } else {
        pill.classList.add("thu-pill--open");
        if (!emp) pill.classList.add("thu-pill--noemp");
        if (selected) pill.classList.add("thu-pill--selected");
        note.textContent = selected ? "Din dag" : "Ledig";
        pill.disabled = !emp;
        pill.addEventListener("click", (function (isoDate) {
          return function () {
            state.dayKey = isoDate;
            renderTimesAndConfirm();
          };
        })(iso));
      }

      pill.appendChild(label);
      pill.appendChild(note);
      el.thursdayList.appendChild(pill);
    });

    el.loadMoreBtn.hidden = state.visibleCount >= MAX_VISIBLE;
  }

  function renderTimesAndConfirm() {
    var chosenIso = state.dayKey || null;
    el.timeSection.hidden = !chosenIso;
    if (chosenIso) {
      el.dayLine.textContent = DAYS[d(chosenIso).getDay()] + " " + fmt(d(chosenIso)) + ", kl " + LUNCH_TIME;
    }
    var emp = currentEmployee();
    var place = el.placeInput.value.trim();
    var canConfirm = !!(emp && chosenIso && place && !isSlotTaken(chosenIso, LUNCH_TIME) && !state.busy);
    el.confirmBtn.disabled = !canConfirm;
    el.confirmHint.textContent = state.busy ? "Bokar…" : (canConfirm ? "Du kan avboka fram till dagen före." : "Skriv var du vill äta.");
    renderThursdayList(emp, state.nextEligible);
  }

  async function refreshTakenSlots() {
    try {
      state.takenSlots = await Store.fetchTakenSlots();
    } catch (e) {
      state.takenSlots = {};
    }
  }

  async function refreshCooldown(emp) {
    if (!emp) { state.nextEligible = null; return null; }
    var last = null;
    try {
      last = await Store.lastLunchFor(emp.id);
    } catch (e) {
      last = null;
    }
    if (!last) { state.nextEligible = null; return null; }
    var n = d(last);
    n.setDate(n.getDate() + Store.COOLDOWN_WEEKS * 7);
    state.nextEligible = n;
    return last;
  }

  async function render() {
    var emp = currentEmployee();

    el.cooldownPhrase.textContent = "var " + Store.COOLDOWN_WEEKS + ":e vecka";
    el.cooldownLabel.textContent = "Låst av " + Store.COOLDOWN_WEEKS + "-veckorsregeln";
    el.empSelect.value = state.empId;

    await refreshTakenSlots();
    var lastLunch = await refreshCooldown(emp);
    var next = state.nextEligible;

    if (emp) {
      var lastTxt = lastLunch ? "Senaste lunchen: " + fmt(d(lastLunch)) + "." : "Vi har inte hunnit äta lunch än.";
      el.statusTitle.classList.add("status-title--active");
      if (!next || next <= today) {
        el.statusTitle.textContent = "Du kan boka vilken ledig torsdag du vill";
        el.statusBody.textContent = lastTxt;
      } else {
        el.statusTitle.textContent = "Din tur igen från " + fmt(next);
        el.statusBody.textContent = lastTxt + " Torsdagar före dess är låsta.";
      }
    } else {
      el.statusTitle.classList.remove("status-title--active");
      el.statusTitle.textContent = "Välj ditt namn så öppnar listan";
      el.statusBody.textContent = "En lunch per person var " + Store.COOLDOWN_WEEKS + ":e vecka. Torsdagar du inte får ta ännu ligger släckta.";
    }

    el.calendarHint.textContent = emp
      ? "Varje torsdag kl " + LUNCH_TIME + "."
      : "Varje torsdag kl " + LUNCH_TIME + " — välj ditt namn ovan för att kunna boka.";

    renderTimesAndConfirm();
  }

  el.empSelect.addEventListener("change", function (ev) {
    state.empId = ev.target.value;
    state.dayKey = "";
    render();
  });
  el.loadMoreBtn.addEventListener("click", function () {
    state.visibleCount = Math.min(MAX_VISIBLE, state.visibleCount + VISIBLE_STEP);
    renderTimesAndConfirm();
  });
  el.placeInput.addEventListener("input", renderTimesAndConfirm);

  el.confirmBtn.addEventListener("click", async function () {
    var emp = currentEmployee();
    var chosenIso = state.dayKey || null;
    var place = el.placeInput.value.trim();
    if (!emp || !chosenIso || !place || isSlotTaken(chosenIso, LUNCH_TIME) || state.busy) return;

    state.busy = true;
    renderTimesAndConfirm();
    try {
      var record = await Store.createBooking({ employeeId: emp.id, employeeName: emp.name, date: chosenIso, time: LUNCH_TIME, place: place });
      state.currentBooking = { id: record.id, cancelToken: record.cancel_token };

      el.receiptTitle.textContent = DAYS[d(chosenIso).getDay()] + " " + fmt(d(chosenIso)) + ", kl " + LUNCH_TIME;
      el.receiptBody.textContent = "Tack " + emp.name.split(" ")[0] + " — det ligger i kalendern. Du får en påminnelse dagen före, och hör av dig om något krånglar.";
      el.receiptPlace.textContent = place;
      el.receiptNext.textContent = "Du kan boka igen från " + fmt(new Date(d(chosenIso).getTime() + Store.COOLDOWN_WEEKS * 7 * 86400000));

      el.bookingView.hidden = true;
      el.confirmedView.hidden = false;
    } catch (err) {
      var reason = err && err.message;
      if (reason === "slot_taken") el.confirmHint.textContent = "Just tagen av någon annan — välj en annan torsdag.";
      else if (reason === "cooldown_active") el.confirmHint.textContent = "Den där dagen är låst av 6-veckorsregeln.";
      else el.confirmHint.textContent = "Kunde inte boka — försök igen.";
      await refreshTakenSlots();
    } finally {
      state.busy = false;
      renderTimesAndConfirm();
    }
  });

  el.cancelBtn.addEventListener("click", async function () {
    if (state.currentBooking) {
      try { await Store.cancelBooking(state.currentBooking.id, state.currentBooking.cancelToken); } catch (e) { /* ignore */ }
    }
    state.currentBooking = null;
    el.placeInput.value = "";
    el.confirmedView.hidden = true;
    el.bookingView.hidden = false;
    render();
  });

  el.resetBtn.addEventListener("click", function () {
    state.empId = "";
    state.dayKey = "";
    state.currentBooking = null;
    el.placeInput.value = "";
    el.confirmedView.hidden = true;
    el.bookingView.hidden = false;
    render();
  });

  // — background map (no fixed markers — the booker types their own place) —
  function initMap(tries) {
    if (!el.map) return;
    if (!window.L) {
      if ((tries || 0) > 60) return;
      setTimeout(function () { initMap((tries || 0) + 1); }, 150);
      return;
    }
    var L = window.L;
    var map = L.map(el.map, { center: [57.7035, 11.9628], zoom: 14, zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      subdomains: "abc", maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  populateEmployeeSelect();
  initMap();
  render();
})();
