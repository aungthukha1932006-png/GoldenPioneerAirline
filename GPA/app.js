// SkyWings front-end (Flow A): Tickets → Seats → (optional) Food → Payment
// - Searchable Tickets results
// - Guard: cannot open Food or Payment without seats
// - Seats page builds grid, calculates totals, saves selected seats
// - Food page uses cart; guarded by seats
// - Payment page (No Stripe): validates, simulates payment, builds printable invoice + signed QR + PDF
// - NEW: Auth guard — user must be logged in to select seats / buy

(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const cap = s => s ? s[0].toUpperCase()+s.slice(1) : s;
  const fmt = n => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

  // === Server API base === (adjust if your server runs elsewhere)
  const API_BASE = "http://localhost:5174";

  // footer year + active nav
  $("#year") && ($("#year").textContent = new Date().getFullYear());
  const path = location.pathname.split("/").pop() || "index.html";
  $$(".nav a").forEach(a => a.getAttribute("href") === path && a.classList.add("active"));

  // ------------------- LocalStorage Keys -------------------
  const KEYS = {
    DEST:  "skywings_selected_destination",
    FLIGHT:"skywings_selected_flight",
    SEATS: "skywings_selected_seats",
    CART:  "skywings_cart",
    PREFILL_TICKET: "skywings_prefill_ticket", // pass data Destinations -> Tickets
    AUTH_USER: "skywings_auth_user"           // NEW: logged-in user
  };

  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const load = (k, d=null) => { try { return JSON.parse(localStorage.getItem(k) || (d===null?"null":JSON.stringify(d))); } catch { return d; } };
  const hasSeats = () => (load(KEYS.SEATS, []) || []).length > 0;

  // ------------------- Default demo credentials -------------------
  const DEFAULT_AUTH = {
    email: "demo@skywings.test",
    password: "demo123",
    name: "Demo User"
  };

  // ------------------- Auth helpers -------------------
  const getUser = () => load(KEYS.AUTH_USER, null);
  const isLoggedIn = () => !!getUser();
  const requireLogin = (returnTo) => {
    if (!isLoggedIn()) {
      const ret = returnTo || (location.pathname.split("/").pop() || "index.html");
      location.href = `login.html?return=${encodeURIComponent(ret)}`;
      return false;
    }
    return true;
  };

  // Header auth UI
  const navLogin = $("#navLogin");
  const navLogout = $("#navLogout");
  function updateAuthUI() {
    const user = getUser();
    if (navLogin)  navLogin.hidden  = !!user;
    if (navLogout) navLogout.hidden = !user;
  }
  updateAuthUI();

  navLogout?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(KEYS.AUTH_USER);
    updateAuthUI();
    location.href = "index.html";
  });

  // ------------------- Global Guards on Nav Links -------------------
  function guardLinks() {
    const needsSeats = (href) => href.endsWith("food.html") || href.endsWith("payment.html");
    const needsLogin = (href) => href.endsWith("seats.html") || href.endsWith("food.html") || href.endsWith("payment.html");

    document.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      // 1) Auth requirement first
      if (needsLogin(href) && !isLoggedIn()) {
        e.preventDefault();
        alert("Please log in to continue.");
        location.href = `login.html?return=${encodeURIComponent(href)}`;
        return;
      }

      // 2) Seat selection requirement for Food/Payment
      if (needsSeats(href) && !hasSeats()) {
        e.preventDefault();
        alert("Please select your seats first.");
        location.href = "seats.html";
        return;
      }
    });
  }
  guardLinks();

  // =================================================================
  // LOGIN — default email/password (client-side demo auth)
  // =================================================================
  if (document.body.dataset.page === "login") {
    const form = $("#loginForm");
    const emailEl = $("#loginEmail");
    const passEl  = $("#loginPassword");
    const status  = $("#loginStatus");

    // Prefill with defaults for convenience (optional)
    if (emailEl && !emailEl.value) emailEl.value = DEFAULT_AUTH.email;
    if (passEl  && !passEl.value)  passEl.value  = DEFAULT_AUTH.password;

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      status.textContent = "";

      const email = (emailEl?.value || "").trim();
      const pass  = (passEl?.value  || "");

      if (email === DEFAULT_AUTH.email && pass === DEFAULT_AUTH.password) {
        const user = { email, name: DEFAULT_AUTH.name, loginAt: new Date().toISOString() };
        save(KEYS.AUTH_USER, user);
        updateAuthUI();

        const params = new URLSearchParams(location.search);
        const ret = params.get("return") || "seats.html";
        location.href = ret;
        return;
      }

      status.textContent = "Invalid email or password.";
    });
  }

  // =================================================================
  // DESTINATIONS → Prefill Tickets
  // =================================================================
  if (document.body.dataset.page === "destinations") {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.choose");
      if (!btn) return;
      e.preventDefault();

      const tile = btn.closest(".tile") || document;
      const h3 = tile.querySelector("h3");
      const title = (h3?.textContent || "").trim();
      let parsedFrom = "", parsedTo = "";
      if (title.includes("→")) {
        const [lhs, rhs] = title.split("→").map(s => s.trim());
        parsedFrom = lhs || "";
        parsedTo = rhs || "";
      }

      const from = btn.dataset.from || parsedFrom || "Yangon";
      const to   = btn.dataset.to   || btn.dataset.destination || parsedTo || "";
      const depart = btn.dataset.depart || "";
      const pax    = Number(btn.dataset.pax || 1) || 1;

      const payload = { from, to, depart, pax };
      localStorage.setItem(KEYS.PREFILL_TICKET, JSON.stringify(payload));
      location.href = "tickets.html";
    });
  }

  // =================================================================
  // TICKETS (searchable) → Select Seats
  // =================================================================
  const sampleFlights = [
    { from: "Yangon", to: "Singapore",      depart: "2026-03-15", flightNo: "SW101", time: "09:30", priceEconomy:129, priceBusiness:259, img: "sga.jpg" },
    { from: "Yangon", to: "Bangkok",        depart: "2026-03-16", flightNo: "SW202", time: "13:10", priceEconomy: 89, priceBusiness:199, img: "bga.jpg" },
    { from: "Yangon", to: "Dubai",          depart: "2026-03-17", flightNo: "SW303", time: "22:05", priceEconomy:399, priceBusiness:699, img: "dba.jpg" },
    { from: "Yangon", to: "Tokyo",          depart: "2026-03-18", flightNo: "SW404", time: "07:20", priceEconomy:459, priceBusiness:799, img: "tka.jpg" },
    { from: "Yangon", to: "Seoul",          depart: "2026-03-19", flightNo: "SW505", time: "11:45", priceEconomy:349, priceBusiness:629, img: "sa.jpg" },
    { from: "Yangon", to: "Kuala Lumpur",   depart: "2026-03-20", flightNo: "SW606", time: "16:35", priceEconomy:119, priceBusiness:239, img: "kla.jpg" },
    { from: "New York", to: "Yangon",      depart: "2026-03-15",  flightNo: "SW707", time: "09:30", priceEconomy:129, priceBusiness:259, img: "yga.jpg" },
    { from: "Mandalay", to: "Yokohama",      depart: "2026-03-15",flightNo: "SW808", time: "09:30", priceEconomy:129, priceBusiness:259, img: "yokoa.jpg" },
    { from: "Seoul", to: "Mandalay",      depart: "2026-03-15",flightNo: "SW909", time: "09:30", priceEconomy:129, priceBusiness:259, img: "mdy.jpg" },

  ];

  if (document.body.dataset.page === "tickets") {
    const form = $("#ticketForm"), results = $("#results");

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const q = {
        from: (fd.get("from")||"").toString().trim(),
        to: (fd.get("to")||"").toString().trim(),
        depart: (fd.get("depart")||"").toString(),
        pax: Number((fd.get("pax")||"1").toString()) || 1,
        maxPrice: Number((fd.get("maxPrice")||"").toString()) || Infinity,
        sort: (fd.get("sort")||"price").toString(),
        window: (fd.get("window")||"").toString()
      };

      const inWindow = (t) => {
        if (!q.window) return true;
        const [hh, mm] = t.split(":").map(Number);
        const mins = hh*60+mm;
        if (q.window==="morning")   return mins>=300  && mins<=719;  // 05:00-11:59
        if (q.window==="afternoon") return mins>=720  && mins<=1079; // 12:00-17:59
        if (q.window==="evening")   return mins>=1080 && mins<=1439; // 18:00-23:59
        return true;
      };

      let matches = sampleFlights.filter(f =>
        (!q.from   || f.from.toLowerCase().includes(q.from.toLowerCase())) &&
        (!q.to     || f.to.toLowerCase().includes(q.to.toLowerCase()))     &&
        (!q.depart || f.depart === q.depart)                               &&
        (Math.min(f.priceEconomy, f.priceBusiness) <= q.maxPrice)          &&
        inWindow(f.time)
      );

      if (q.sort === "price") {
        matches = matches.sort((a,b)=>Math.min(a.priceEconomy,a.priceBusiness)-Math.min(b.priceEconomy,b.priceBusiness));
      } else {
        matches = matches.sort((a,b)=>a.time.localeCompare(b.time));
      }

      if (!matches.length) { results.innerHTML = `<p>No flights found. Try different filters.</p>`; return; }

      results.innerHTML = matches.map(f => `
        <article class="flight">
          <img src="${f.img}" alt="">
          <div class="meta">
            <h3>${f.from} → ${f.to}</h3>
            <p><strong>${f.flightNo}</strong> · ${f.time} · ${f.depart}</p>
            <div class="actions">
              <p>Economy from <strong>${fmt(f.priceEconomy)}</strong> &nbsp;|&nbsp; Business from <strong>${fmt(f.priceBusiness)}</strong></p>
              <a class="btn primary select-seats"
                 href="seats.html"
                 data-from="${f.from}" data-to="${f.to}" data-depart="${f.depart}"
                 data-flight="${f.flightNo}" data-price-economy="${f.priceEconomy}"
                 data-price-business="${f.priceBusiness}" data-pax="${q.pax}">
                Select Seats
              </a>
            </div>
          </div>
        </article>
      `).join("");
    });

    // Prefill from Destinations
    (function prefillFromDestinations(){
      let prefill = null;
      try { prefill = JSON.parse(localStorage.getItem(KEYS.PREFILL_TICKET) || "null"); } catch {}
      if (!prefill) return;

      const fromEl   = document.querySelector('input[name="from"]');
      const toEl     = document.querySelector('input[name="to"]');
      const departEl = document.querySelector('input[name="depart"]'); // type="date"
      const paxEl    = document.querySelector('input[name="pax"], select[name="pax"]');

      if (fromEl)   fromEl.value   = prefill.from   || fromEl.value || "";
      if (toEl)     toEl.value     = prefill.to     || toEl.value   || "";
      if (departEl) departEl.value = prefill.depart || departEl.value || "";
      if (paxEl)    paxEl.value    = String(prefill.pax || paxEl.value || "1");

      const AUTO_SUBMIT = false;
      if (AUTO_SUBMIT && form) {
        setTimeout(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })), 0);
      }
      localStorage.removeItem(KEYS.PREFILL_TICKET);
    })();

    // Save selected flight and go to Seats (LOGIN REQUIRED)
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a.select-seats");
      if (!a) return;
      e.preventDefault();

      const flight = {
        from: a.dataset.from,
        to: a.dataset.to,
        depart: a.dataset.depart,
        flightNo: a.dataset.flight,
        priceEconomy: Number(a.dataset.priceEconomy || 0),
        priceBusiness: Number(a.dataset.priceBusiness || 0),
        pax: Number(a.dataset.pax || 1)
      };

      // Save selection prior to login so user resumes smoothly
      save(KEYS.FLIGHT, flight);
      // clear old seats/cart
      localStorage.removeItem(KEYS.SEATS);
      localStorage.removeItem(KEYS.CART);

      // Require login before going to seats
      if (!isLoggedIn()) {
        alert("Please log in to select seats.");
        location.href = `login.html?return=${encodeURIComponent("seats.html")}`;
        return;
      }
      location.href = "seats.html";
    });
  }

  // =================================================================
  // SEATS → Continue to Food / Skip to Payment
  // =================================================================
  const FEES = {
    business: { window: 25, aisle: 20, middle: 10 },
    economy:  { window: 15, aisle: 10, middle:  0 }
  };
  const DEFAULT_BASE = { economy: 99, business: 199 };
  const seatTypeFromCol = (c) => (c===1||c===6) ? "window" : (c===3||c===4) ? "aisle" : "middle";
  const seatClassFromRow = (r) => (["A","B"].includes(r) ? "business" : "economy");

  if (document.body.dataset.page === "seats") {
    // HARD GUARD: must be logged in
    if (!requireLogin("seats.html")) return;

    const flight = load(KEYS.FLIGHT);
    if (!flight) {
      alert("Please search and select a flight first.");
      location.replace("tickets.html"); return;
    }

    const baseEco = flight.priceEconomy ?? DEFAULT_BASE.economy;
    const baseBiz = flight.priceBusiness ?? DEFAULT_BASE.business;

    const cabin = $("#cabin");
    const selectedList = $("#selectedList");
    const baseTotalEl = $("#baseTotal");
    const feesTotalEl = $("#feesTotal");
    const grandTotalEl = $("#grandTotal");
    const routeLine = $("#routeLine");
    const clearBtn = $("#clearSel");
    const toFoodBtn = $("#toFood");
    const toPayBtn  = $("#toPayment");

    routeLine && (routeLine.textContent =
      `${flight.from} → ${flight.to} on ${flight.depart} · ${flight.flightNo} · Base fares: Economy ${fmt(baseEco)} · Business ${fmt(baseBiz)} · Pax: ${flight.pax||1}`);

    // Build cabin
    const rows = ["A","B","C","D","E","F"];
    const left=[1,2,3], right=[4,5,6];
    const reserved = new Set(["A2","B5","C3","E1"]);
    const prev = load(KEYS.SEATS, []);

    function makeSeat(id, r, col){
      const sClass = seatClassFromRow(r);
      const sType  = seatTypeFromCol(col);
      const el = document.createElement("button");
      el.type="button"; el.className="seat"; el.textContent=id;
      el.dataset.seat = id; el.dataset.class=sClass; el.dataset.type=sType;
      el.dataset.base = (sClass==="business"? baseBiz : baseEco);
      el.dataset.fee  = FEES[sClass][sType];
      if (reserved.has(id)) el.classList.add("reserved");
      if (prev.find(x=>x.id===id)) el.classList.add("selected");
      el.title = `${cap(sClass)} · ${cap(sType)} · ${fmt(Number(el.dataset.base))} + ${fmt(Number(el.dataset.fee))}`;
      return el;
    }

    if (cabin) {
      rows.forEach(r=>{
        const row = document.createElement("div"); row.className="row";
        left.forEach(c => row.appendChild(makeSeat(`${r}${c}`, r, c)));
        const gap = document.createElement("div"); gap.style.width="28px"; row.appendChild(gap);
        right.forEach(c => row.appendChild(makeSeat(`${r}${c}`, r, c)));
        cabin.appendChild(row);
      });

      cabin.addEventListener("click", (e)=>{
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        if (!t.classList.contains("seat") || t.classList.contains("reserved")) return;
        t.classList.toggle("selected");
        updateSummary();
      });
    }

    function getChosen(){
      return $$(".seat.selected", cabin).map(s => ({
        id: s.dataset.seat,
        class: s.dataset.class,
        type: s.dataset.type,
        base: Number(s.dataset.base||0),
        fee:  Number(s.dataset.fee||0)
      }));
    }

    function updateSummary(){
      const chosen = getChosen();
      selectedList.innerHTML = chosen.length
        ? chosen.map(c => `<li><span>${c.id} · ${cap(c.class)} · ${cap(c.type)}</span><strong>${fmt(c.base)} + ${fmt(c.fee)}</strong></li>`).join("")
        : `<li><span>No seats selected.</span><span></span></li>`;

      const baseTotal = chosen.reduce((s,c)=>s+c.base,0);
      const feesTotal = chosen.reduce((s,c)=>s+c.fee,0);
      const grand = baseTotal + feesTotal;
      baseTotalEl.textContent = fmt(baseTotal);
      feesTotalEl.textContent = fmt(feesTotal);
      grandTotalEl.textContent = fmt(grand);

      save(KEYS.SEATS, chosen);
    }

    clearBtn?.addEventListener("click", ()=>{
      $$(".seat.selected", cabin).forEach(s=>s.classList.remove("selected"));
      updateSummary();
    });

    toFoodBtn?.addEventListener("click", ()=>{
      if (!hasSeats()) { alert("Please select at least one seat."); return; }
      location.href = "food.html";
    });

    toPayBtn?.addEventListener("click", ()=>{
      if (!hasSeats()) { alert("Please select at least one seat."); return; }
      location.href = "payment.html";
    });

    updateSummary();
  }

  // =================================================================
  // FOOD (guarded by seats) → Proceed to Payment
  // =================================================================
  if (document.body.dataset.page === "food") {
    // HARD GUARD: must be logged in
    if (!requireLogin("food.html")) return;

    if (!hasSeats()) {
      $("#seatGuardMsg")?.removeAttribute("hidden");
      setTimeout(()=> location.replace("seats.html"), 900);
      return;
    }

    const cartKey = KEYS.CART;
    const readCart = () => load(cartKey, []);
    const writeCart = (items) => save(cartKey, items);
    const renderCart = () => {
      const list = $("#cartList");
      const items = readCart();
      if (!items.length){ list.innerHTML = "<li><span>No items yet.</span><span></span></li>"; return; }
      list.innerHTML = items.map((it,i)=>`<li><span>${i+1}. ${it.name}</span><strong>${fmt(it.price)}</strong></li>`).join("");
    };

    $$(".add").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const items = readCart();
        items.push({ name: btn.dataset.item, price: Number(btn.dataset.price||0) });
        writeCart(items); renderCart();
      });
    });

    $("#clearCart")?.addEventListener("click", ()=>{ writeCart([]); renderCart(); });
    $("#toPaymentFromFood")?.addEventListener("click", ()=>{
      if (!hasSeats()) { alert("Please select seats first."); location.href="seats.html"; return; }
      location.href = "payment.html";
    });

    renderCart();
  }

  // =================================================================
  // PAYMENT (No Stripe) — seats required, food optional
  // =================================================================
  if (document.body.dataset.page === "payment") {
    // HARD GUARD: must be logged in
    if (!requireLogin("payment.html")) return;

    if (!hasSeats()) { alert("Please select seats first."); location.replace("seats.html"); return; }

    // Helpers specific to payment
    const currency = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n||0));
    const onlyDigits = (s) => (s||"").replace(/\D/g, "");
    const maskCardLast4 = (s) => {
      const d = onlyDigits(s);
      return d ? `Card (•••• ${d.slice(-4)})` : 'Card';
    };
    const validCard = (num) => {
      const d = onlyDigits(num||"");
      return d.length >= 12 && d.length <= 19;
    };
    const validExpiry = (mmYY) => {
      const m = (mmYY||"").match(/^(\d{2})\/(\d{2})$/);
      if (!m) return false;
      const mm = +m[1], yy = +m[2];
      if (mm < 1 || mm > 12) return false;
      const year = 2000 + yy;
      const exp = new Date(year, mm, 0, 23, 59, 59);
      return exp >= new Date();
    };
    const validCVC = (cvc) => {
      const d = onlyDigits(cvc||"");
      return d.length === 3 || d.length === 4;
    };
    const rand = (len) => Array(len).fill(0).map(()=>Math.floor(Math.random()*10)).join('');
    const genPNR = () => {
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      return Array(6).fill(0).map(()=>letters[Math.floor(Math.random()*letters.length)]).join('');
    };
    const genInvoiceNo = () => {
      const d = new Date();
      return `INV-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${rand(4)}`;
    };
    const todayDisplay = () =>
      new Date().toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    // Gather data to show summary
    const flight = load(KEYS.FLIGHT);
    const seats  = load(KEYS.SEATS, []);
    const cart   = load(KEYS.CART, []);

    const routeLine = $("#routeLine");
    const baseTotalEl = $("#baseTotal");
    const feesTotalEl = $("#feesTotal");
    const grandTotalEl = $("#grandTotal");
    const orderList = $("#orderList");

    // Totals (client preview)
    const baseTotal = seats.reduce((s,c)=>s+c.base,0);
    const seatFees  = seats.reduce((s,c)=>s+c.fee,0);
    const foodTotal = cart.reduce((s,c)=>s+c.price,0);
    const grand     = baseTotal + seatFees + foodTotal;

    routeLine && (routeLine.textContent = flight
      ? `${flight.from} → ${flight.to} on ${flight.depart} · ${flight.flightNo}`
      : `Route`);

    baseTotalEl && (baseTotalEl.textContent = fmt(baseTotal));
    feesTotalEl && (feesTotalEl.textContent = fmt(seatFees + foodTotal));
    grandTotalEl && (grandTotalEl.textContent = fmt(grand));

    if (orderList) {
      const seatLines = seats.map(s => `<li><span>${s.id} · ${cap(s.class)} · ${cap(s.type)}</span><strong>${fmt(s.base)} + ${fmt(s.fee)}</strong></li>`);
      const foodLines = cart.map((m,i) => `<li><span>Meal ${i+1}: ${m.name}</span><strong>${fmt(m.price)}</strong></li>`);
      orderList.innerHTML = seatLines.concat(foodLines).join("") || "<li><span>No items.</span><span></span></li>";
    }

    // Form + Success + Invoice elements
    const form = $("#paymentForm");
    const status = $("#payStatus");
    const payBtn = $("#payNow");
    const cancelBtn = $("#cancelPay");
    const agree = $("#agree");
    const successBox = $("#successBox");
    const pnrCode = $("#pnrCode");
    const confEmail = $("#confEmail");
    const printBtn = $("#printReceipt");
    const downloadBtn = $("#downloadPdf");

    const invoice = $("#invoice");
    const invNumber = $("#invNumber");
    const invDate = $("#invDate");
    const invPNR = $("#invPNR");
    const invBillToName = $("#invBillToName");
    const invBillToEmail = $("#invBillToEmail");
    const invRoute = $("#invRoute");
    const invFlightMeta = $("#invFlightMeta");
    const invItems = $("#invItems");
    const invSubtotal = $("#invSubtotal");
    const invSeatFees = $("#invSeatFees");
    const invGrand = $("#invGrand");
    const invPayMethod = $("#invPayMethod");
    const invPaidOn = $("#invPaidOn");

    // === QR Code elements & helpers ===
    const invQRCanvas = $("#invQR");
    const invQRText   = $("#invQRText");

    function buildTicketQRObject({ pnr, name, email, flight, seats, total, paidOn }) {
      return {
        v: 1,
        pnr,
        n: name || "",
        e: email || "",
        f: flight?.flightNo || "",
        r: `${flight?.from || ""}-${flight?.to || ""}`,
        d: flight?.depart || "",
        s: (seats || []).map(s => s.id).join(","), // seat ids
        t: Number((total || 0).toFixed ? total.toFixed(2) : total),
        ts: new Date(paidOn || Date.now()).toISOString()
      };
    }

    function renderInvoiceQR(payloadJson) {
      if (!invQRCanvas) return;
      const lib = window.QRCode || window.qrcode;
      if (lib && typeof lib.toCanvas === "function") {
        lib.toCanvas(invQRCanvas, payloadJson, { width: 192, margin: 1 }, (err) => {
          if (err) console.error("QR render failed:", err);
        });
      } else if (typeof window.QRCode === "function") {
        try { window.QRCode(invQRCanvas, payloadJson, { width: 192, margin: 1 }); }
        catch (e) { console.warn("QRCode function call failed:", e); }
      } else {
        console.warn("QRCode library not found; QR will be skipped.");
      }
      if (invQRText) {
        invQRText.textContent = payloadJson;
        // invQRText.hidden = false; // show if you want raw payload visible
      }
    }

    async function downloadInvoicePDF({ invoice, qrPayloadJson }) {
      try {
        const resp = await fetch(`${API_BASE}/api/invoice-pdf`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ invoice, qrPayload: JSON.parse(qrPayloadJson) })
        });
        if (!resp.ok) throw new Error("PDF request failed");
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `SkyWings-${invoice.pnr}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
      } catch (err) {
        console.error(err);
        alert("Could not download PDF. Please try again.");
      }
    }

    cancelBtn?.addEventListener("click", () => { location.href = "seats.html"; });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";

      const name = $("#billName").value.trim();
      const email = $("#billEmail").value.trim();
      const card = $("#cardNumber").value.trim();
      const exp  = $("#cardExpiry").value.trim();
      const cvc  = $("#cardCvc").value.trim();

      if (!name || !email)         { status.textContent = "Please fill in your name and email."; return; }
      if (!validCard(card))        { status.textContent = "Please enter a valid card number (13–19 digits)."; return; }
      if (!validExpiry(exp))       { status.textContent = "Please enter a valid expiry (MM/YY)."; return; }
      if (!validCVC(cvc))          { status.textContent = "Please enter a valid CVC (3–4 digits)."; return; }
      if (!agree.checked)          { status.textContent = "You must agree to the Terms & Privacy Policy."; return; }

      payBtn.disabled = true;
      status.textContent = "Processing payment…";
      await new Promise(r => setTimeout(r, 1200)); // simulate

      // Success
      const pnr = genPNR();
      const invoiceNo = genInvoiceNo();
      pnrCode.textContent = pnr;
      confEmail.textContent = email;

      // Build invoice line-items
      invItems.innerHTML = "";
      seats.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>Seat ${s.id} — ${cap(s.class)} / ${cap(s.type)} (base)</td>
          <td class="num">1</td>
          <td class="num">${currency(s.base)}</td>
          <td class="num">${currency(s.base)}</td>`;
        invItems.appendChild(tr);
      });
      cart.forEach((m, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>Meal ${i+1}: ${m.name}</td>
          <td class="num">1</td>
          <td class="num">${currency(m.price)}</td>
          <td class="num">${currency(m.price)}</td>`;
        invItems.appendChild(tr);
      });

      // Totals
      const subtotal = seats.reduce((s,c)=>s+c.base,0) + cart.reduce((s,c)=>s+c.price,0);
      const seatFees = seats.reduce((s,c)=>s+c.fee,0);
      invSubtotal.textContent = currency(subtotal);
      invSeatFees.textContent = currency(seatFees);
      invGrand.textContent = currency(subtotal + seatFees);

      // Invoice meta
      invNumber.textContent = invoiceNo;
      invDate.textContent = new Date().toLocaleDateString();
      invPNR.textContent = pnr;
      invBillToName.textContent = name;
      invBillToEmail.textContent = email;
      invRoute.textContent = flight
        ? `${flight.from} → ${flight.to} on ${flight.depart} · ${flight.flightNo}`
        : "Flight booking";
      invFlightMeta.textContent = `${seats.length} seat(s) • ${flight?.pax || seats.length} passenger(s)`;
      invPayMethod.textContent = maskCardLast4(card);
      invPaidOn.textContent = todayDisplay();

      // Prepare models for server
      const grandTotalNumber = subtotal + seatFees;
      const unsignedQR = buildTicketQRObject({
        pnr, name, email, flight, seats, total: grandTotalNumber, paidOn: new Date()
      });

      // Ask server to finalize order (authoritative invoice # + signed QR)
      let qrPayloadSigned = null;
      try {
        const resp = await fetch(`${API_BASE}/api/finalize-order`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({
            invoice: { pnr, email, grand: grandTotalNumber },
            qrPayload: unsignedQR
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.invoiceNumber) invNumber.textContent = data.invoiceNumber;
          qrPayloadSigned = data.qr?.payload || null;
        }
      } catch (e) {
        console.warn("finalize-order failed, will try sign-qr fallback:", e);
      }

      // Fallback: sign QR separately if finalize failed
      if (!qrPayloadSigned) {
        try {
          const resp = await fetch(`${API_BASE}/api/sign-qr`, {
            method: "POST",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify({ payload: unsignedQR })
          });
          if (resp.ok) {
            const data = await resp.json();
            qrPayloadSigned = data.payload || null;
          }
        } catch (e) {
          console.warn("sign-qr fallback failed:", e);
        }
      }

      const qrJson = JSON.stringify(qrPayloadSigned || unsignedQR);
      renderInvoiceQR(qrJson);

      // Reveal success + invoice
      successBox.hidden = false;
      invoice.hidden = false;
      invoice.setAttribute('aria-hidden', 'false');

      status.textContent = "Payment completed.";
      form.setAttribute('aria-hidden', 'true');
      form.style.display = 'none';

      // Wire buttons
      printBtn?.addEventListener("click", () => {
        if (invoice.hidden) {
          invoice.hidden = false;
          invoice.setAttribute('aria-hidden', 'false');
        }
        window.print();
      });

      downloadBtn?.addEventListener("click", () => {
        const invoiceModel = {
          number: invNumber.textContent,
          date: new Date().toLocaleString(),
          pnr,
          billToName: name,
          billToEmail: email,
          route: invRoute.textContent,
          flightMeta: invFlightMeta.textContent,
          items: [
            ...seats.map(s => ({
              desc: `Seat ${s.id} — ${cap(s.class)} / ${cap(s.type)} (base)`,
              qty: 1,
              unit: currency(s.base),
              amount: currency(s.base)
            })),
            ...cart.map((m,i)=>({
              desc: `Meal ${i+1}: ${m.name}`,
              qty: 1,
              unit: currency(m.price),
              amount: currency(m.price)
            }))
          ],
          subtotal: invSubtotal.textContent,
          seatFees: invSeatFees.textContent,
          grand: invGrand.textContent,
          payMethod: invPayMethod.textContent,
          paidOn: invPaidOn.textContent
        };
        downloadInvoicePDF({ invoice: invoiceModel, qrPayloadJson: qrJson });
      });
    });
  }
})();