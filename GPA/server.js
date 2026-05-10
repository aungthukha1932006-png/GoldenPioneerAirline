import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5174;

// --- CORS ---
const allowedOrigins = (process.env.SKYWINGS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (e.g., file://) or explicitly allowed origins
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  }
}));

app.use(express.json({ limit: "1mb" }));

// --- HMAC helpers ---
const SECRET = process.env.SKYWINGS_QR_SECRET || "dev-secret-change-me";
const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const canonicalize = (obj) => {
  const out = {};
  Object.keys(obj || {}).filter(k => k !== "sig").sort().forEach(k => { out[k] = obj[k]; });
  return JSON.stringify(out);
};
const signPayload = (obj) => {
  const h = crypto.createHmac("sha256", SECRET).update(canonicalize(obj));
  return base64url(h.digest());
};
const verifyPayload = (objWithSig) => {
  if (!objWithSig || !objWithSig.sig) return false;
  const { sig, ...rest } = objWithSig;
  return signPayload(rest) === sig;
};

/**
 * POST /api/sign-qr
 * body: { payload: { v, pnr, n, e, f, r, d, s, t, ts } }  // no sig
 * ret : { sig, payload: { ...payload, sig } }
 */
app.post("/api/sign-qr", (req, res) => {
  try {
    const { payload } = req.body || {};
    if (!payload || !payload.pnr) return res.status(400).json({ error: "Missing payload or PNR" });
    const sig = signPayload(payload);
    return res.json({ sig, payload: { ...payload, sig } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "sign-qr failed" });
  }
});

/**
 * POST /api/verify-qr
 * body: { payload: { ... including sig } }
 * ret : { valid: boolean, reason?, payload }
 */
app.post("/api/verify-qr", (req, res) => {
  try {
    const { payload } = req.body || {};
    if (!payload) return res.status(400).json({ valid: false, reason: "Missing payload" });
    const valid = verifyPayload(payload);
    return res.json({ valid, reason: valid ? undefined : "Bad signature", payload });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ valid: false, reason: "verify-qr failed" });
  }
});

/**
 * POST /api/finalize-order
 * body: { invoice: { pnr, email, grand }, qrPayload: {...} }
 * ret : { ok: true, invoiceNumber, qr: { sig, payload } }
 *
 * Fake finalize: issues an invoice number & signs QR; add DB persistence if needed.
 */
app.post("/api/finalize-order", (req, res) => {
  try {
    const { invoice = {}, qrPayload = {} } = req.body || {};
    if (!invoice || !invoice.pnr || !invoice.email || typeof invoice.grand === "undefined") {
      return res.status(400).json({ error: "Missing invoice fields (pnr,email,grand)" });
    }

    const now = new Date();
    const invNo = `INV-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`;

    // Ensure QR is signed
    const payloadBare = { ...qrPayload };
    delete payloadBare.sig;
    const sig = signPayload(payloadBare);
    const payloadSigned = { ...payloadBare, sig };

    // TODO: persist to DB here

    return res.json({ ok: true, invoiceNumber: invNo, qr: { sig, payload: payloadSigned } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "finalize-order failed" });
  }
});

/**
 * POST /api/invoice-pdf
 * body: {
 *   invoice: {
 *     number, date, pnr, billToName, billToEmail,
 *     route, flightMeta, items:[{desc, qty, unit, amount}],
 *     subtotal, seatFees, grand, payMethod, paidOn
 *   },
 *   qrPayload: { v, pnr, n, e, f, r, d, s, t, ts, sig? }
 * }
 * ret : application/pdf (download)
 */
app.post("/api/invoice-pdf", async (req, res) => {
  try {
    const { invoice = {}, qrPayload = {} } = req.body || {};
    if (!invoice || !invoice.number || !invoice.pnr) {
      return res.status(400).json({ error: "Missing invoice.number or invoice.pnr" });
    }

    // Ensure QR is signed (sign if missing)
    const bare = { ...qrPayload }; delete bare.sig;
    const sig = qrPayload.sig || signPayload(bare);
    const payloadSigned = { ...bare, sig };

    // Generate QR PNG data URL
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(payloadSigned), { margin: 1, width: 192 });

    // Build PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="SkyWings-${invoice.pnr}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    // Brand header
    doc
      .fontSize(20).fillColor("#0b1f3b").text("SkyWings Airline", { continued: true })
      .fontSize(10).fillColor("#666").text("   www.skywings.example • support@skywings.example");
    doc.moveDown(0.5);
    doc.fillColor("#111");

    // Meta
    doc.fontSize(12).text(`Invoice #: ${invoice.number}`);
    doc.text(`Invoice Date: ${invoice.date || new Date().toLocaleString()}`);
    doc.text(`PNR: ${invoice.pnr}`);
    doc.moveDown(0.5);

    // Parties & Flight
    const startY = doc.y;
    doc.fontSize(12).text("Bill To", { underline: true });
    doc.text(invoice.billToName || "");
    doc.fillColor("#555").text(invoice.billToEmail || "").fillColor("#111");
    doc.moveTo(300, startY).lineTo(300, startY + 100).strokeColor("#eee").stroke();
    doc.text("Flight", 320, startY, { underline: true });
    doc.text(invoice.route || "", 320);
    doc.fillColor("#555").text(invoice.flightMeta || "", 320).fillColor("#111");
    doc.moveDown(1);

    // Items table (simple)
    doc.fontSize(12).text("Items", { underline: true });
    doc.moveDown(0.25);
    const th = ["Description", "Qty", "Unit", "Amount"];
    const colX = [48, 330, 380, 450];
    doc.fontSize(11).fillColor("#0b1f3b");
    th.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i !== th.length-1 }));
    doc.fillColor("#111").moveDown(0.3);
    doc.moveTo(48, doc.y).lineTo(550, doc.y).strokeColor("#eee").stroke();

    (invoice.items || []).forEach(it => {
      doc.moveDown(0.15);
      doc.text(String(it.desc || ""), colX[0], doc.y, { width: 270 });
      doc.text(String(it.qty || ""), colX[1]);
      doc.text(String(it.unit || ""), colX[2]);
      doc.text(String(it.amount || ""), colX[3]);
    });
    doc.moveDown(0.3);
    doc.moveTo(48, doc.y).lineTo(550, doc.y).strokeColor("#eee").stroke();

    // Totals
    doc.moveDown(0.5);
    const label = (l, v, bold=false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(l, 330, y);
      doc.text(v, 450, y);
      doc.font("Helvetica");
    };
    label("Subtotal", invoice.subtotal || "$0");
    label("Seat Fees", invoice.seatFees || "$0");
    label("Grand Total", invoice.grand || "$0", true);

    // Pay info + QR
    doc.moveDown(0.75);
    doc.text("Payment Method: " + (invoice.payMethod || "Card"));
    doc.text("Paid On: " + (invoice.paidOn || new Date().toLocaleString()));
    doc.moveDown(0.5);

    // Draw QR on page
    const qrY = doc.y;
    doc.text("Boarding QR Code");
    const qrImg = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    doc.image(Buffer.from(qrImg, "base64"), 48, qrY + 12, { width: 120, height: 120 });
    doc.rect(48, qrY + 12, 120, 120).strokeColor("#eee").stroke();
    doc.moveDown(9);

    doc.fillColor("#666").fontSize(10).text("Thank you for choosing SkyWings. This is a system-generated invoice for your records.", 48, doc.y + 6);
    doc.end();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "invoice-pdf failed" });
  }
});

app.listen(PORT, () => {
  console.log(`SkyWings server running on http://localhost:${PORT}`);
});