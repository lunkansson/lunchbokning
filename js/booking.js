(function () {
  "use strict";

  var Store = window.LunchStore;
  var DAYS = Store.WEEKDAYS_FULL;
  var MONTHS = Store.MONTHS;
  var LUNCH_TIME = Store.LUNCH_TIME;
  var d = Store.parseDate;
  var fmt = Store.formatShort;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var MONTHS_AHEAD = 12;

  var state = {
    empId: "", dayKey: "", month: 0,
    currentBooking: null, // { id, cancelToken }
    takenSlots: {},       // "date|time" -> true, refreshed from the server
    nextEligible: null,   // Date or null, refreshed per selected employee
    busy: false
  };

  var el = {
    empSelect: document.getElementById("emp"),
    statusTitle: document.getElementById("status-title"),
    statusBody: document.getElementById("status-body"),
    cooldownPhrase: document.getElementById("cooldown-phrase"),
    cooldownLabel: document.getElementById("cooldown-label"),
    calendarHint: document.getElementById("calendar-hint"),
    calMonth: document.getElementById("cal-month"),
    calGrid: document.getElementById("cal-grid"),
    calPrev: document.getElementById("cal-prev"),
    calNext: document.getElementById("cal-next"),
    timeSection: document.getElementById("time-section"),
    dayLine: document.getElementById("day-line"),
    placeInput: document.getElementById("place-input"),
    confirmBtn: document.getElementById("confirm-btn"),
    confirmHint: document.getElementById("confirm-hint"),
    bookingView: document.getElementById("booking-view"),
    confirmedView: document.getElementById("confirmed-view"),
    receiptTag: document.getElementById("receipt-tag"),
    receiptTitle: document.getElementById("receipt-title"),
    receiptBody: document.getElementById("receipt-body"),
    receiptPlace: document.getElementById("receipt-place"),
    receiptNext: document.getElementById("receipt-next"),
    cancelBtn: document.getElementById("cancel-btn"),
    resetBtn: document.getElementById("reset-btn"),
    map: document.getElementById("map")
  };

  // Navigable a year ahead of whichever month holds today.
  function monthsShown() {
    var out = [];
    for (var i = 0; i < MONTHS_AHEAD; i++) {
      var dt = new Date(today.getFullYear(), today.getMonth() + i, 1);
      out.push({ year: dt.getFullYear(), month: dt.getMonth(), label: MONTHS[dt.getMonth()] + " " + dt.getFullYear() });
    }
    return out;
  }
  var months = monthsShown();

  function currentEmployee() {
    return Store.EMPLOYEES.find(function (e) { return e.id === state.empId; }) || null;
  }

  function isSlotTaken(date, time) {
    return !!state.takenSlots[date + "|" + time];
  }

  function dayState(iso, emp, next) {
    var dt = d(iso);
    if (dt < today) return "past";
    if (isSlotTaken(iso, LUNCH_TIME)) return "full";
    if (emp && next && dt < next) return "locked";
    return Store.isLunchDay(dt) ? "open" : "request";
  }

  function populateEmployeeSelect() {
    Store.EMPLOYEES.forEach(function (e) {
      var opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      el.empSelect.appendChild(opt);
    });
  }

  function renderCalendar(emp, next) {
    var mi = Math.min(state.month, months.length - 1);
    var m = months[mi];
    el.calMonth.textContent = m.label;
    el.calPrev.disabled = mi === 0;
    el.calNext.disabled = mi === months.length - 1;

    var first = new Date(m.year, m.month, 1);
    var lead = (first.getDay() + 6) % 7;
    var total = new Date(m.year, m.month + 1, 0).getDate();

    el.calGrid.innerHTML = "";

    for (var i = 0; i < lead; i++) {
      var blank = document.createElement("div");
      blank.className = "day-cell";
      el.calGrid.appendChild(blank);
    }

    for (var n = 1; n <= total; n++) {
      var iso = m.year + "-" + String(m.month + 1).padStart(2, "0") + "-" + String(n).padStart(2, "0");
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";

      var numSpan = document.createElement("span");
      numSpan.textContent = String(n);
      var dot = document.createElement("span");
      dot.className = "day-dot";
      cell.appendChild(numSpan);
      cell.appendChild(dot);

      var st = dayState(iso, emp, next);
      if (st === "open" || st === "request") {
        var selected = state.dayKey === iso;
        cell.classList.add(st === "open" ? "day-cell--open" : "day-cell--request");
        if (!emp) cell.classList.add("day-cell--noemp");
        if (selected) cell.classList.add("day-cell--selected");
        cell.disabled = !emp;
        cell.addEventListener("click", (function (isoDate) {
          return function () {
            state.dayKey = isoDate;
            renderTimesAndConfirm();
          };
        })(iso));
      } else if (st === "full") {
        cell.classList.add("day-cell--full");
        cell.disabled = true;
      } else if (st === "locked") {
        cell.classList.add("day-cell--locked");
        cell.disabled = true;
      } else {
        cell.disabled = true;
      }
      el.calGrid.appendChild(cell);
    }
  }

  function renderTimesAndConfirm() {
    var chosenIso = state.dayKey || null;
    var isRequest = chosenIso && !Store.isLunchDay(d(chosenIso));
    el.timeSection.hidden = !chosenIso;
    if (chosenIso) {
      el.dayLine.textContent = DAYS[d(chosenIso).getDay()] + " " + fmt(d(chosenIso)) + ", kl " + LUNCH_TIME;
    }
    var emp = currentEmployee();
    var place = el.placeInput.value.trim();
    var canConfirm = !!(emp && chosenIso && place && !isSlotTaken(chosenIso, LUNCH_TIME) && !state.busy);
    el.confirmBtn.disabled = !canConfirm;
    el.confirmBtn.textContent = isRequest ? "Skicka förfrågan" : "Boka lunchen";
    el.confirmHint.textContent = state.busy ? (isRequest ? "Skickar…" : "Bokar…")
      : !canConfirm ? "Skriv var du vill äta."
      : isRequest ? "Fredrik godkänner innan den blir bokad."
      : "Du kan avboka fram till dagen före.";
    renderCalendar(emp, state.nextEligible);
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
        el.statusTitle.textContent = "Du kan boka vilken ledig dag du vill";
        el.statusBody.textContent = lastTxt;
      } else {
        el.statusTitle.textContent = "Din tur igen från " + fmt(next);
        el.statusBody.textContent = lastTxt + " Dagar före dess är låsta.";
      }
    } else {
      el.statusTitle.classList.remove("status-title--active");
      el.statusTitle.textContent = "Välj ditt namn så öppnar kalendern";
      el.statusBody.textContent = "En lunch per person var " + Store.COOLDOWN_WEEKS + ":e vecka. Dagar du inte får ta ännu ligger släckta.";
    }

    el.calendarHint.textContent = emp
      ? "Torsdagar bokas direkt kl " + LUNCH_TIME + ". Andra dagar skickas som en förfrågan till Fredrik."
      : "Torsdagar bokas direkt, andra dagar är en förfrågan — välj ditt namn ovan för att kunna boka.";

    renderTimesAndConfirm();
  }

  el.empSelect.addEventListener("change", function (ev) {
    state.empId = ev.target.value;
    state.dayKey = "";
    render();
  });
  el.calPrev.addEventListener("click", function () { state.month = Math.max(0, state.month - 1); renderTimesAndConfirm(); });
  el.calNext.addEventListener("click", function () { state.month = Math.min(months.length - 1, state.month + 1); renderTimesAndConfirm(); });
  el.placeInput.addEventListener("input", renderTimesAndConfirm);

  el.confirmBtn.addEventListener("click", async function () {
    var emp = currentEmployee();
    var chosenIso = state.dayKey || null;
    var place = el.placeInput.value.trim();
    if (!emp || !chosenIso || !place || isSlotTaken(chosenIso, LUNCH_TIME) || state.busy) return;
    var isRequest = !Store.isLunchDay(d(chosenIso));

    state.busy = true;
    renderTimesAndConfirm();
    try {
      var record = await Store.createBooking({ employeeId: emp.id, employeeName: emp.name, date: chosenIso, time: LUNCH_TIME, place: place });
      state.currentBooking = { id: record.id, cancelToken: record.cancel_token };
      var pending = record.status === "pending";

      var dayLabel = DAYS[d(chosenIso).getDay()] + " " + fmt(d(chosenIso)) + ", kl " + LUNCH_TIME;
      el.receiptTag.textContent = pending ? "Väntar" : "Bokat";
      el.receiptTag.className = pending ? "tag tag-neutral" : "tag tag-accent";
      el.receiptTitle.textContent = dayLabel;
      el.receiptBody.textContent = pending
        ? "Tack " + emp.name.split(" ")[0] + " — skickat till Fredrik för godkännande. Du får inget besked här automatiskt, men om han godkänner ligger den i kalendern."
        : "Tack " + emp.name.split(" ")[0] + " — det ligger i kalendern. Du får en påminnelse dagen före, och hör av dig om något krånglar.";
      el.receiptPlace.textContent = place;
      el.receiptNext.textContent = "Du kan boka igen från " + fmt(new Date(d(chosenIso).getTime() + Store.COOLDOWN_WEEKS * 7 * 86400000));
      el.cancelBtn.textContent = pending ? "Dra tillbaka förfrågan" : "Avboka";

      el.bookingView.hidden = true;
      el.confirmedView.hidden = false;
    } catch (err) {
      var reason = err && err.message;
      if (reason === "slot_taken") el.confirmHint.textContent = "Just tagen av någon annan — välj en annan dag.";
      else if (reason === "cooldown_active") el.confirmHint.textContent = "Den där dagen är låst av 6-veckorsregeln.";
      else el.confirmHint.textContent = (isRequest ? "Kunde inte skicka förfrågan" : "Kunde inte boka") + " — försök igen.";
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
