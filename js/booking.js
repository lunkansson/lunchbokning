(function () {
  "use strict";

  var Store = window.LunchStore;
  var DAYS = Store.WEEKDAYS_FULL;
  var MONTHS = Store.MONTHS;
  var d = Store.parseDate;
  var fmt = Store.formatShort;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var state = {
    empId: "", dayKey: "", time: "", month: 0,
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
    placeLine: document.getElementById("place-line"),
    timeGrid: document.getElementById("time-grid"),
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

  function monthsShown() {
    var out = [];
    Store.LUNCH_DAYS.forEach(function (day) {
      var dt = d(day.date);
      var key = dt.getFullYear() + "-" + dt.getMonth();
      if (!out.some(function (m) { return m.key === key; })) {
        out.push({ key: key, year: dt.getFullYear(), month: dt.getMonth(), label: MONTHS[dt.getMonth()] + " " + dt.getFullYear() });
      }
    });
    return out;
  }
  var months = monthsShown();
  (function pickInitialMonth() {
    var idx = months.findIndex(function (m) { return m.year === today.getFullYear() && m.month === today.getMonth(); });
    state.month = idx === -1 ? 0 : idx;
  })();

  function currentEmployee() {
    return Store.EMPLOYEES.find(function (e) { return e.id === state.empId; }) || null;
  }

  function isSlotTaken(date, time) {
    return !!state.takenSlots[date + "|" + time];
  }

  function freeTimes(day) {
    return day.times.filter(function (t) { return !isSlotTaken(day.date, t); });
  }

  function dayState(day, emp, next) {
    var dt = d(day.date);
    if (dt < today) return "past";
    if (!freeTimes(day).length) return "full";
    if (emp && next && dt < next) return "locked";
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
      var day = Store.LUNCH_DAYS.find(function (x) { return x.date === iso; });
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";

      var numSpan = document.createElement("span");
      numSpan.textContent = String(n);
      var dot = document.createElement("span");
      dot.className = "day-dot";
      cell.appendChild(numSpan);
      cell.appendChild(dot);

      if (day) {
        var st = dayState(day, emp, next);
        if (st === "open") {
          var selected = state.dayKey === iso;
          cell.classList.add("day-cell--open");
          if (!emp) cell.classList.add("day-cell--noemp");
          if (selected) cell.classList.add("day-cell--selected");
          cell.disabled = !emp;
          cell.addEventListener("click", (function (isoDate) {
            return function () {
              state.dayKey = isoDate;
              state.time = "";
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
      } else {
        cell.disabled = true;
      }
      el.calGrid.appendChild(cell);
    }
  }

  function renderTimes(chosenDay) {
    el.timeGrid.innerHTML = "";
    if (!chosenDay) return;
    chosenDay.times.forEach(function (t) {
      var taken = isSlotTaken(chosenDay.date, t);
      var selected = state.time === t;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time-btn";
      if (taken) btn.classList.add("time-btn--taken");
      else if (selected) btn.classList.add("time-btn--selected");

      var value = document.createElement("span");
      value.className = "time-value";
      value.textContent = t;
      var note = document.createElement("span");
      note.className = "time-note";
      note.textContent = taken ? "Bokad" : (selected ? "Din tid" : "Ledig");

      btn.appendChild(value);
      btn.appendChild(note);
      btn.disabled = taken;
      btn.addEventListener("click", function () {
        state.time = t;
        renderTimesAndConfirm();
      });
      el.timeGrid.appendChild(btn);
    });
  }

  function renderTimesAndConfirm() {
    var chosenDay = Store.LUNCH_DAYS.find(function (x) { return x.date === state.dayKey; }) || null;
    el.timeSection.hidden = !chosenDay;
    if (chosenDay) {
      el.dayLine.textContent = DAYS[d(chosenDay.date).getDay()] + " " + fmt(d(chosenDay.date));
      el.placeLine.textContent = chosenDay.place;
      renderTimes(chosenDay);
    }
    var emp = currentEmployee();
    var canConfirm = !!(emp && chosenDay && state.time && !isSlotTaken(chosenDay.date, state.time) && !state.busy);
    el.confirmBtn.disabled = !canConfirm;
    el.confirmHint.textContent = state.busy ? "Bokar…" : (canConfirm ? "Du kan avboka fram till dagen före." : "Välj en av tiderna ovan.");
    renderCalendar(emp, state.nextEligible);
    updateMapSelection(chosenDay);
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
      ? "Fyra lunchdagar i månaden, två sittningar per dag."
      : "Fyra lunchdagar i månaden — välj ditt namn ovan för att kunna boka.";

    renderTimesAndConfirm();
  }

  el.empSelect.addEventListener("change", function (ev) {
    state.empId = ev.target.value;
    state.dayKey = "";
    state.time = "";
    render();
  });
  el.calPrev.addEventListener("click", function () { state.month = Math.max(0, state.month - 1); renderTimesAndConfirm(); });
  el.calNext.addEventListener("click", function () { state.month = Math.min(months.length - 1, state.month + 1); renderTimesAndConfirm(); });

  el.confirmBtn.addEventListener("click", async function () {
    var emp = currentEmployee();
    var chosenDay = Store.LUNCH_DAYS.find(function (x) { return x.date === state.dayKey; }) || null;
    if (!emp || !chosenDay || !state.time || isSlotTaken(chosenDay.date, state.time) || state.busy) return;

    state.busy = true;
    renderTimesAndConfirm();
    try {
      var record = await Store.createBooking({ employeeId: emp.id, employeeName: emp.name, date: chosenDay.date, time: state.time, place: chosenDay.place });
      state.currentBooking = { id: record.id, cancelToken: record.cancel_token };

      el.receiptTitle.textContent = DAYS[d(chosenDay.date).getDay()] + " " + fmt(d(chosenDay.date)) + ", kl " + state.time;
      el.receiptBody.textContent = "Tack " + emp.name.split(" ")[0] + " — det ligger i kalendern. Du får en påminnelse dagen före, och hör av dig om något krånglar.";
      el.receiptPlace.textContent = chosenDay.place;
      el.receiptNext.textContent = "Du kan boka igen från " + fmt(new Date(d(chosenDay.date).getTime() + Store.COOLDOWN_WEEKS * 7 * 86400000));

      el.bookingView.hidden = true;
      el.confirmedView.hidden = false;
    } catch (err) {
      var reason = err && err.message;
      if (reason === "slot_taken") el.confirmHint.textContent = "Just tagen av någon annan — välj en annan tid.";
      else if (reason === "cooldown_active") el.confirmHint.textContent = "Den där tiden är låst av 6-veckorsregeln.";
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
    state.time = "";
    el.confirmedView.hidden = true;
    el.bookingView.hidden = false;
    render();
  });

  el.resetBtn.addEventListener("click", function () {
    state.empId = "";
    state.dayKey = "";
    state.time = "";
    state.currentBooking = null;
    el.confirmedView.hidden = true;
    el.bookingView.hidden = false;
    render();
  });

  // — background map —
  var map = null;
  var markers = {};

  function initMap(tries) {
    if (!el.map) return;
    if (!window.L) {
      if ((tries || 0) > 60) return;
      setTimeout(function () { initMap((tries || 0) + 1); }, 150);
      return;
    }
    var L = window.L;
    map = L.map(el.map, { center: [57.7035, 11.9628], zoom: 14, zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      subdomains: "abc", maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    var placeCoords = {};
    Store.LUNCH_DAYS.forEach(function (day) { placeCoords[day.place] = day.coords; });
    Object.keys(placeCoords).forEach(function (name) {
      var m = L.circleMarker(placeCoords[name], {
        radius: 9, color: "#6f61c4", weight: 2, fillColor: "#f3f5fe", fillOpacity: 1
      }).addTo(map).bindTooltip(name, { direction: "top", offset: [0, -6], permanent: true, className: "place-label" });
      markers[name] = m;
    });
    updateMapSelection(Store.LUNCH_DAYS.find(function (x) { return x.date === state.dayKey; }) || null);
  }

  function updateMapSelection(chosenDay) {
    if (!markers) return;
    var active = chosenDay ? chosenDay.place : null;
    Object.keys(markers).forEach(function (name) {
      var on = name === active;
      markers[name].setStyle({ radius: on ? 13 : 9, weight: on ? 3 : 2, fillColor: on ? "#6f61c4" : "#f3f5fe" });
    });
  }

  populateEmployeeSelect();
  initMap();
  render();
})();
