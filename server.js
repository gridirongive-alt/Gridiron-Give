import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import Stripe from "stripe";
import {
  db,
  uid,
  playerPublicId,
  equipmentTemplateForSport,
  recoveryKey,
  passwordHash,
  isBcryptHash,
  writeLatestBackupSnapshot,
  latestJsonBackupPath,
  latestExcelBackupPath
} from "./db/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const adminEnabled = String(process.env.ADMIN_ENABLED || "false").toLowerCase() === "true";
const adminFullUsername = String(process.env.ADMIN_FULL_USERNAME || "AdminUser");
const adminFullPassword = String(process.env.ADMIN_FULL_PASSWORD || "");
const adminReadOnlyUsername = String(process.env.ADMIN_READONLY_USERNAME || "DBmanagerUser");
const adminReadOnlyPassword = String(process.env.ADMIN_READONLY_PASSWORD || "");
const adminSessionSecret = String(process.env.ADMIN_SESSION_SECRET || "");
const isProduction = process.env.NODE_ENV === "production";
const equipmentItemColumns = new Set(
  db.prepare("PRAGMA table_info(equipment_items)").all().map((col) => String(col.name))
);
const hasEquipmentSortOrder = equipmentItemColumns.has("sort_order");
const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

const jsonParser = express.json({ limit: "5mb" });

app.use("/stripe/webhook", express.raw({ type: "application/json" }));
app.use((req, res, next) => {
  if (req.path === "/stripe/webhook") return next();
  return jsonParser(req, res, next);
});

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return {};
  return Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        const key = index >= 0 ? part.slice(0, index).trim() : part.trim();
        const value = index >= 0 ? part.slice(index + 1).trim() : "";
        return [key, decodeURIComponent(value)];
      })
  );
}

function signAdminPayload(payload) {
  return createHmac("sha256", adminSessionSecret).update(payload).digest("hex");
}

function adminAuthConfigured() {
  return Boolean(
    adminEnabled &&
      adminSessionSecret &&
      adminFullUsername &&
      adminFullPassword &&
      adminReadOnlyUsername &&
      adminReadOnlyPassword
  );
}

function createAdminSessionCookieValue({ username, role }) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24 * 7;
  const payload = `${username}|${role}|${expiry}`;
  const signature = signAdminPayload(payload);
  return `${payload}|${signature}`;
}

function verifyAdminSession(req) {
  if (!adminAuthConfigured()) return null;
  const cookies = parseCookies(req);
  const raw = String(cookies.admin_session || "");
  const parts = raw.split("|");
  if (parts.length !== 4) return null;
  const [username, role, expiryRaw, signature] = parts;
  const expectedRole =
    username === adminFullUsername
      ? "full"
      : username === adminReadOnlyUsername
        ? "readonly"
        : "";
  if (!expectedRole || role !== expectedRole) return null;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  const payload = `${username}|${role}|${expiryRaw}`;
  const expected = signAdminPayload(payload);
  try {
    const valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) return null;
    return { username, role };
  } catch {
    return null;
  }
}

function setAdminSessionCookie(res, session) {
  const cookieValue = encodeURIComponent(createAdminSessionCookieValue(session));
  const secure = isProduction ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `admin_session=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
  );
}

function clearAdminSessionCookie(res) {
  const secure = isProduction ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function requireAdminPage(req, res, next) {
  if (!adminEnabled) return res.status(404).send("Not found");
  const session = verifyAdminSession(req);
  if (session) {
    req.adminSession = session;
    return next();
  }
  return res.redirect("/admin-login");
}

function requireAdminApi(req, res, next) {
  if (!adminEnabled) return res.status(404).json({ error: "Admin disabled." });
  const session = verifyAdminSession(req);
  if (session) {
    req.adminSession = session;
    return next();
  }
  return res.status(401).json({ error: "Admin authentication required." });
}

function requireAdminWriteApi(req, res, next) {
  if (!req.adminSession) return res.status(401).json({ error: "Admin authentication required." });
  if (req.adminSession.role !== "full") {
    return res.status(403).json({ error: "Read-only database manager cannot edit or delete records." });
  }
  return next();
}

app.use((req, res, next) => {
  const pathname = req.path;
  if (pathname === "/admin-db" || pathname === "/admin-db.html") {
    return requireAdminPage(req, res, next);
  }
  if (
    pathname.startsWith("/api/admin/") &&
    !pathname.startsWith("/api/admin/auth/")
  ) {
    return requireAdminApi(req, res, next);
  }
  next();
});

app.use((req, res, next) => {
  const pathname = String(req.path || "");
  if (pathname === "/data" || pathname.startsWith("/data/")) {
    return res.status(404).send("Not found");
  }
  return next();
});

app.use(express.static(__dirname));

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/u.test(String(value || ""));
}

function sanitizeSingleLineText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
}

function assertNoControlChars(value, fieldName) {
  if (hasControlChars(value)) {
    throw new Error(`${fieldName} contains invalid characters.`);
  }
}

function assertValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("Email is required.");
  if (normalized.length > 254) throw new Error("Email is too long.");
  assertNoControlChars(normalized, "Email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("Email format is invalid.");
  }
  return normalized;
}

function assertValidPlayerPublicId(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^GG-[A-Z0-9]{3}-[A-Z0-9]{4}$/u.test(normalized)) {
    throw new Error("PlayerID format is invalid.");
  }
  return normalized;
}

function assertValidRecoveryKey(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{48}$/u.test(normalized)) {
    throw new Error("Recovery Key format is invalid.");
  }
  return normalized;
}

function assertAllowedLength(value, maxLength, fieldName) {
  if (String(value || "").length > maxLength) {
    throw new Error(`${fieldName} is too long.`);
  }
}

function assertSafeName(value, fieldName, maxLength = 120) {
  const normalized = sanitizeSingleLineText(value);
  if (!normalized) throw new Error(`${fieldName} is required.`);
  assertAllowedLength(normalized, maxLength, fieldName);
  return normalized;
}

function assertSafeOptionalText(value, fieldName, maxLength = 200) {
  const normalized = sanitizeSingleLineText(value);
  assertAllowedLength(normalized, maxLength, fieldName);
  return normalized;
}

function assertSafeMessage(value, fieldName, maxLength = 1000) {
  const normalized = String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  assertAllowedLength(normalized, maxLength, fieldName);
  return normalized;
}

function comparePassword(input, stored) {
  const candidate = String(input || "");
  const hashed = String(stored || "");
  if (!hashed) return false;
  if (isBcryptHash(hashed)) return bcrypt.compareSync(candidate, hashed);
  return candidate === hashed;
}

function generateRecoveryKey() {
  return randomBytes(24).toString("hex");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/gu, "");
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/u, "");
}

function estimateStripeFeeCents(totalCents) {
  const safeTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.round(safeTotal * 0.029) + 30;
}

function minimumPlatformFeeCents(totalCents) {
  const safeTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.max(Math.round(safeTotal * 0.05), estimateStripeFeeCents(safeTotal));
}

function netPlayerAmountFromGrossCents(totalCents) {
  const safeTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.max(0, safeTotal - estimateStripeFeeCents(safeTotal) - minimumPlatformFeeCents(safeTotal));
}

function computeStripeDonationSplit(baseAmountCents, coverFees) {
  const base = Math.max(0, Math.round(Number(baseAmountCents || 0)));
  if (!base) {
    return {
      checkoutTotalCents: 0,
      stripeFeeCents: 0,
      applicationFeeCents: 0,
      playerAmountCents: 0,
      coverFees: Boolean(coverFees)
    };
  }

  if (!coverFees) {
    const stripeFeeCents = estimateStripeFeeCents(base);
    const applicationFeeCents = minimumPlatformFeeCents(base);
    return {
      checkoutTotalCents: base,
      stripeFeeCents,
      applicationFeeCents,
      playerAmountCents: Math.max(0, base - stripeFeeCents - applicationFeeCents),
      coverFees: false
    };
  }

  let checkoutTotalCents = base;
  for (let attempts = 0; attempts < 20000; attempts += 1) {
    const stripeFeeCents = estimateStripeFeeCents(checkoutTotalCents);
    if (checkoutTotalCents - stripeFeeCents - minimumPlatformFeeCents(checkoutTotalCents) >= base) {
      return {
        checkoutTotalCents,
        stripeFeeCents,
        applicationFeeCents: checkoutTotalCents - base - stripeFeeCents,
        playerAmountCents: base,
        coverFees: true
      };
    }
    checkoutTotalCents += 1;
  }

  throw new Error("Could not calculate Stripe donation totals.");
}

const appBaseUrl = trimTrailingSlash(process.env.APP_BASE_URL || `http://localhost:${PORT}`);
const publicSiteUrl = `${appBaseUrl}/`;
const gmailUser = process.env.GMAIL_USER || "";
const gmailAppPasswordRaw = process.env.GMAIL_APP_PASSWORD || "";
const gmailAppPassword = compactWhitespace(gmailAppPasswordRaw);
const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const stripePublishableKey = String(process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
const transporter =
  gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailAppPassword
        }
      })
    : null;

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

async function sendRecoveryEmail({ to, recoveryKeyValue, role }) {
  const resetLink = `${appBaseUrl}/reset-password.html?email=${encodeURIComponent(
    to
  )}&role=${encodeURIComponent(role)}`;
  const html = `
    <p>You requested a password reset for Gridiron Give.</p>
    <p><strong>Recovery Key:</strong> ${recoveryKeyValue}</p>
    <p><a href="${resetLink}">Reset your password</a></p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  if (!transporter) {
    // eslint-disable-next-line no-console
    console.log("[recovery-email:dev]", { to, role, recoveryKey: recoveryKeyValue, resetLink });
    return;
  }

  await transporter.sendMail({
    from: gmailUser,
    to,
    subject: "Gridiron Give Password Recovery",
    html
  });
}

async function sendRosterInviteEmail({ to, teamName, coachName, playerPublicId, recipientMode = "coach" }) {
  const setupLink = publicSiteUrl;
  const dashboardLink = `${appBaseUrl}/player-dashboard.html`;
  const coachManaged = String(recipientMode || "coach") === "coach";
  const html = `
    <h2>Welcome to Gridiron Give</h2>
    <p>Your coach has added you to the <strong>${teamName}</strong> roster.</p>
    <p><strong>Your Player ID:</strong> ${playerPublicId}</p>
    <p>Use this Player ID to create your account at <a href="${setupLink}">${setupLink}</a>.</p>
    <p><strong>Coach:</strong> ${coachName}</p>
    <hr />
    <h3>How to Use Your Player Dashboard</h3>
    <ol>
      <li>Sign up with your Player ID and create your password.</li>
      <li>${coachManaged ? "Upload your photo and publish your page so donors can find you." : "Set up your equipment list and donation goal amounts."}</li>
      <li>${coachManaged ? "Your coach manages shared equipment pricing and receives donations on behalf of players." : "Turn off items you do not need so donors only see relevant gear."}</li>
      <li>${coachManaged ? "You do not need to connect Stripe personally for this team setup." : "Save your goals to publish your page for donors."}</li>
    </ol>
    ${
      coachManaged
        ? `<p><strong>Stripe Payout Setup:</strong> Your coach handles Stripe collections for this team, so you do not need to complete personal payout setup.</p>`
        : `<h3>Stripe Payout Setup</h3>
    <ol>
      <li>Open your player dashboard after signup: <a href="${dashboardLink}">${dashboardLink}</a></li>
      <li>Click <strong>Set Up Payouts</strong> and read the Stripe instructions carefully.</li>
      <li>Use your real legal identity and banking information exactly as Stripe requests.</li>
      <li>
        If Stripe asks for an industry, choose
        <strong><u>Charities or social service organizations</u></strong>.
      </li>
      <li>Do not change Stripe's business framing, description, or account-type direction during setup.</li>
      <li>Finish every required Stripe step before returning to Gridiron Give.</li>
    </ol>
    <p><strong>Important:</strong> After Stripe setup is complete, come back to your dashboard and confirm it shows <strong>Payment Setup Complete</strong>.</p>`
    }
    <p>Tip: Ask your coach for realistic target prices so your totals are accurate for donors.</p>
  `;
  if (!transporter) {
    // eslint-disable-next-line no-console
    console.log("[roster-invite-email:dev]", { to, teamName, coachName, playerPublicId, setupLink, dashboardLink });
    return { sent: false, reason: "Email transporter not configured." };
  }
  await transporter.sendMail({
    from: gmailUser,
    to,
    subject: "You were added to your team roster on Gridiron Give",
    html
  });
  return { sent: true };
}

async function sendCoachWelcomeEmail({ to, coachName, teamName }) {
  const setupLink = publicSiteUrl;
  const html = `
    <h2>Welcome to Gridiron Give, ${coachName}</h2>
    <p>Your team account for <strong>${teamName}</strong> is ready.</p>
    <p>Go to your dashboard: <a href="${setupLink}">${setupLink}</a></p>
    <hr />
    <h3>Quick Start</h3>
    <ol>
      <li>Set your team location and sport first.</li>
      <li>Add players manually or by CSV.</li>
      <li>Use one consistent player email per athlete to preserve their Player ID.</li>
      <li>Check registration status in your roster table.</li>
    </ol>
    <h3>Roster Upload Best Practices</h3>
    <ul>
      <li>Use clear first name, last name, and email values for each player.</li>
      <li>Avoid duplicate rows for the same email.</li>
      <li>Double-check email spelling so invites are delivered.</li>
    </ul>
    <h3>Team Rollout Tips</h3>
    <ul>
      <li>Share expected equipment price ranges with players before they set goals.</li>
      <li>Ask players to remove non-needed gear items from public view.</li>
      <li>Review player pages before sharing with donors.</li>
    </ul>
  `;
  if (!transporter) {
    // eslint-disable-next-line no-console
    console.log("[coach-welcome-email:dev]", { to, coachName, teamName, setupLink });
    return { sent: false, reason: "Email transporter not configured." };
  }
  await transporter.sendMail({
    from: gmailUser,
    to,
    subject: "Welcome to Gridiron Give - Coach Setup Guide",
    html
  });
  return { sent: true };
}

async function sendPlayerDonationEmail({ to, playerName, donorName, amount, itemName, generalDonation }) {
  if (!transporter) return { sent: false, reason: "Email transporter not configured." };
  const donorLabel = donorName || "A donor";
  const subject = `New donation for ${playerName}`;
  const html = `
    <h2>You received a new donation on Gridiron Give</h2>
    <p><strong>${donorLabel}</strong> donated <strong>${money(amount)}</strong> to support your goals.</p>
    <p><strong>Donation type:</strong> ${generalDonation ? "General Donation" : itemName}</p>
    <p>Visit your dashboard to review your updated fundraising progress.</p>
    <p><a href="${appBaseUrl}/player-dashboard.html">Open Player Dashboard</a></p>
  `;
  await transporter.sendMail({
    from: gmailUser,
    to,
    subject,
    html
  });
  return { sent: true };
}

async function sendDonorReceiptEmail({
  to,
  donorName,
  playerName,
  amount,
  itemName,
  generalDonation
}) {
  if (!transporter) return { sent: false, reason: "Email transporter not configured." };
  const subject = "Your Gridiron Give donation receipt";
  const html = `
    <h2>Thank you for your donation</h2>
    <p>${donorName || "Supporter"}, your donation was received successfully.</p>
    <p><strong>Athlete:</strong> ${playerName}</p>
    <p><strong>Donation amount:</strong> ${money(amount)}</p>
    <p><strong>Applied to:</strong> ${generalDonation ? "General Donation" : itemName}</p>
    <p>Thank you for supporting youth athletics through Gridiron Give.</p>
  `;
  await transporter.sendMail({
    from: gmailUser,
    to,
    subject,
    html
  });
  return { sent: true };
}

function listEnabledItemsWithRemaining(playerId) {
  return db
    .prepare(
      `SELECT *
       FROM equipment_items
       WHERE player_id=? AND enabled=1`
    )
    .all(playerId)
    .map((item) => ({
      ...item,
      remaining: Math.max(0, Number(item.goal || 0) - Number(item.raised || 0))
    }));
}

function teamEquipmentTemplateRows(teamId) {
  return db
    .prepare(
      `SELECT id, team_id, name, category, price_range, goal, enabled, sort_order
       FROM team_equipment_templates
       WHERE team_id=?
       ORDER BY sort_order ASC, rowid ASC`
    )
    .all(teamId);
}

function ensureTeamSharedEquipmentTemplates(team) {
  if (!team?.id) return [];
  let rows = teamEquipmentTemplateRows(team.id);
  if (rows.length) return rows;
  const templates = equipmentTemplateForSport(team.sport);
  const tx = db.transaction(() => {
    templates.forEach((row, index) => {
      db.prepare(
        `INSERT INTO team_equipment_templates
        (id, team_id, name, category, price_range, goal, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?)`
      ).run(uid("teq"), team.id, row[0], row[1], row[2], index);
    });
  });
  tx();
  rows = teamEquipmentTemplateRows(team.id);
  return rows;
}

function syncTeamSharedEquipmentToPlayers(teamId) {
  const templates = teamEquipmentTemplateRows(teamId);
  if (!templates.length) return;
  const players = db.prepare("SELECT id FROM players WHERE team_id=?").all(teamId);
  const tx = db.transaction(() => {
    players.forEach((player) => {
      const existingRows = db
        .prepare("SELECT id, name, category, raised FROM equipment_items WHERE player_id=?")
        .all(player.id);
      const raisedByKey = new Map(
        existingRows.map((row) => [
          `${String(row.name || "").trim().toLowerCase()}::${String(row.category || "").trim().toLowerCase()}`,
          Number(row.raised || 0)
        ])
      );
      db.prepare("DELETE FROM equipment_items WHERE player_id=?").run(player.id);
      templates.forEach((item, index) => {
        const key = `${String(item.name || "").trim().toLowerCase()}::${String(item.category || "")
          .trim()
          .toLowerCase()}`;
        const raised = raisedByKey.get(key) || 0;
        if (hasEquipmentSortOrder) {
          db.prepare(
            `INSERT INTO equipment_items
            (id, player_id, name, category, price_range, goal, raised, enabled, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            uid("eq"),
            player.id,
            String(item.name || "Equipment"),
            String(item.category || "General"),
            String(item.price_range || ""),
            Number(item.goal || 0),
            raised,
            Number(item.enabled) === 0 ? 0 : 1,
            Number(item.sort_order ?? index)
          );
          return;
        }
        db.prepare(
          `INSERT INTO equipment_items
          (id, player_id, name, category, price_range, goal, raised, enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uid("eq"),
          player.id,
          String(item.name || "Equipment"),
          String(item.category || "General"),
          String(item.price_range || ""),
          Number(item.goal || 0),
          raised,
          Number(item.enabled) === 0 ? 0 : 1
        );
      });
    });
  });
  tx();
}

function payoutContextForPlayer(playerId) {
  const row = db
    .prepare(
      `SELECT
        p.id AS player_id,
        p.first_name,
        p.last_name,
        p.email AS player_email,
        p.stripe_account_id AS player_stripe_account_id,
        p.stripe_onboarding_complete AS player_stripe_onboarding_complete,
        t.id AS team_id,
        t.name AS team_name,
        t.recipient_mode,
        c.id AS coach_id,
        c.name AS coach_name,
        c.email AS coach_email,
        c.stripe_account_id AS coach_stripe_account_id,
        c.stripe_onboarding_complete AS coach_stripe_onboarding_complete
       FROM players p
       JOIN teams t ON t.id = p.team_id
       JOIN coaches c ON c.id = t.coach_id
       WHERE p.id=?`
    )
    .get(playerId);
  if (!row) return null;
  const recipientMode = String(row.recipient_mode || "coach");
  const recipientType = recipientMode === "coach" ? "coach" : "player";
  const recipientId = recipientType === "coach" ? row.coach_id : row.player_id;
  const stripeAccountId =
    recipientType === "coach"
      ? String(row.coach_stripe_account_id || "")
      : String(row.player_stripe_account_id || "");
  const onboardingComplete =
    recipientType === "coach"
      ? Number(row.coach_stripe_onboarding_complete) === 1
      : Number(row.player_stripe_onboarding_complete) === 1;
  return {
    playerId: row.player_id,
    playerName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    playerEmail: String(row.player_email || ""),
    teamId: row.team_id,
    teamName: String(row.team_name || ""),
    recipientMode,
    recipientType,
    recipientId,
    recipientName: recipientType === "coach" ? String(row.coach_name || "") : `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    recipientEmail: recipientType === "coach" ? String(row.coach_email || "") : String(row.player_email || ""),
    stripeAccountId,
    onboardingComplete
  };
}

function applyDonationToDatabase({
  playerId,
  teamId = "",
  donationType,
  equipmentItemId,
  donorName,
  donorEmail,
  donorMessage,
  anonymous,
  amount,
  payoutRecipientType = "",
  payoutRecipientId = "",
  stripeDestinationAccountId = "",
  stripeCheckoutSessionId = "",
  stripePaymentIntentId = "",
  stripeChargeId = "",
  checkoutTotalAmount = 0,
  applicationFeeAmount = 0
}) {
  if (!playerId || !donorName || !donorEmail || !amount) {
    throw new Error("Missing required donation fields.");
  }

  const safeDonorName = assertSafeName(donorName, "Donor name", 120);
  const safeDonorEmail = assertValidEmail(donorEmail);
  const safeDonorMessage = assertSafeMessage(donorMessage || "", "Donor message", 1000);

  const value = Number(amount);
  if (value <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  if (donationType === "team-general") {
    const safeTeamId = String(teamId || "").trim();
    if (!safeTeamId) throw new Error("Team is required for general team donation.");
    const players = db.prepare("SELECT id FROM players WHERE team_id=? ORDER BY first_name, last_name").all(safeTeamId);
    if (!players.length) throw new Error("No players are available for this team donation.");
    const totalCents = Math.round(value * 100);
    const baseShare = Math.floor(totalCents / players.length);
    const remainder = totalCents % players.length;
    const results = [];
    players.forEach((player, index) => {
      const shareCents = baseShare + (index < remainder ? 1 : 0);
      if (shareCents <= 0) return;
      results.push(
        applyDonationToDatabase({
          playerId: player.id,
          teamId: safeTeamId,
          donationType: "general",
          donorName,
          donorEmail,
          donorMessage,
          anonymous,
          amount: shareCents / 100,
          payoutRecipientType,
          payoutRecipientId,
          stripeDestinationAccountId,
          stripeCheckoutSessionId,
          stripePaymentIntentId,
          stripeChargeId,
          checkoutTotalAmount,
          applicationFeeAmount
        })
      );
    });
    return {
      donationIds: results.flatMap((entry) => entry.donationIds || (entry.donationId ? [entry.donationId] : [])),
      amount: value
    };
  }

  const payoutContext = payoutContextForPlayer(playerId);
  if (!payoutContext) {
    throw new Error("Player not found for donation.");
  }
  const donationTeamId = String(teamId || payoutContext.teamId || "").trim();
  const donationRecipientType = String(payoutRecipientType || payoutContext.recipientType || "player");
  const donationRecipientId = String(payoutRecipientId || payoutContext.recipientId || "").trim();
  const destinationAccountId = String(stripeDestinationAccountId || payoutContext.stripeAccountId || "").trim();

  const enabledItems = listEnabledItemsWithRemaining(playerId);

  if (donationType === "general") {
    const overallRemaining = enabledItems.reduce((sum, item) => sum + item.remaining, 0);
    if (overallRemaining > 0 && value > overallRemaining) {
      throw new Error(`Amount exceeds remaining overall goal ($${overallRemaining.toFixed(2)}).`);
    }
    const allocationTargets = enabledItems
      .filter((item) => item.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining || b.goal - a.goal || a.name.localeCompare(b.name));
    if (!allocationTargets.length) {
      throw new Error("No equipment items are available for general donation.");
    }

    let remainingDonation = value;
    const allocations = [];
    allocationTargets.forEach((item) => {
      if (remainingDonation <= 0) return;
      const applied = Math.min(item.remaining, remainingDonation);
      if (applied <= 0) return;
      allocations.push({ item, applied });
      remainingDonation -= applied;
    });

    const donationIds = [];
    const tx = db.transaction(() => {
      allocations.forEach(({ item, applied }) => {
        const donationId = uid("don");
        donationIds.push(donationId);
        db.prepare("UPDATE equipment_items SET raised = raised + ? WHERE id=?").run(applied, item.id);
        db.prepare(
          `INSERT INTO donations
          (
            id, team_id, player_id, equipment_item_id, donor_name, donor_email, donor_message, anonymous, amount,
            payout_recipient_type, payout_recipient_id, stripe_destination_account_id,
            stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, checkout_total_amount, application_fee_amount
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          donationId,
          donationTeamId,
          playerId,
          item.id,
          safeDonorName,
          safeDonorEmail,
          safeDonorMessage,
          anonymous ? 1 : 0,
          applied,
          donationRecipientType,
          donationRecipientId,
          destinationAccountId,
          String(stripeCheckoutSessionId || ""),
          String(stripePaymentIntentId || ""),
          String(stripeChargeId || ""),
          Number(checkoutTotalAmount || 0),
          Number(applicationFeeAmount || 0)
        );
      });
    });
    tx();
    return {
      donationId: donationIds[0],
      donationIds,
      amount: value,
      allocations: allocations.map(({ item, applied }) => ({
        equipmentItemId: item.id,
        equipmentName: item.name,
        amount: applied
      }))
    };
  }

  const item = db
    .prepare("SELECT * FROM equipment_items WHERE id=? AND player_id=? AND enabled=1")
    .get(equipmentItemId, playerId);
  if (!item) {
    throw new Error("Equipment item unavailable.");
  }
  const remaining = Math.max(0, Number(item.goal) - Number(item.raised));
  if (remaining > 0 && value > remaining) {
    throw new Error(`Amount exceeds remaining goal ($${remaining.toFixed(2)}).`);
  }

  const donationId = uid("don");
  const tx = db.transaction(() => {
    db.prepare("UPDATE equipment_items SET raised = raised + ? WHERE id=?").run(value, equipmentItemId);
    db.prepare(
      `INSERT INTO donations
      (
        id, team_id, player_id, equipment_item_id, donor_name, donor_email, donor_message, anonymous, amount,
        payout_recipient_type, payout_recipient_id, stripe_destination_account_id,
        stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, checkout_total_amount, application_fee_amount
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      donationId,
      donationTeamId,
      playerId,
      equipmentItemId,
      safeDonorName,
      safeDonorEmail,
      safeDonorMessage,
      anonymous ? 1 : 0,
      value,
      donationRecipientType,
      donationRecipientId,
      destinationAccountId,
      String(stripeCheckoutSessionId || ""),
      String(stripePaymentIntentId || ""),
      String(stripeChargeId || ""),
      Number(checkoutTotalAmount || 0),
      Number(applicationFeeAmount || 0)
    );
  });
  tx();
  return { donationId, amount: value };
}

function playerTotals(playerId) {
  return db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN enabled = 1 THEN goal ELSE 0 END), 0) AS goal_total,
        COALESCE(SUM(CASE WHEN enabled = 1 THEN raised ELSE 0 END), 0) AS raised_total
      FROM equipment_items
      WHERE player_id = ?`
    )
    .get(playerId);
}

function equipmentRows(playerId, includeHidden = true) {
  const where = includeHidden ? "" : "AND enabled = 1";
  const selectSortOrder = hasEquipmentSortOrder ? ", sort_order" : "";
  const orderBy = hasEquipmentSortOrder ? "sort_order ASC, rowid ASC" : "rowid ASC";
  const rows = db
    .prepare(
      `SELECT id, name, category, price_range, goal, raised, enabled${selectSortOrder}
       FROM equipment_items
       WHERE player_id = ? ${where}
       ORDER BY ${orderBy}`
    )
    .all(playerId);
  return rows.map((row, index) => ({
    ...row,
    sort_order: hasEquipmentSortOrder ? Number(row.sort_order ?? index) : index
  }));
}

function teamByCoachId(coachId) {
  return db.prepare("SELECT * FROM teams WHERE coach_id = ?").get(coachId);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/auth/session", (req, res) => {
  if (!adminEnabled) return res.status(404).json({ error: "Admin disabled." });
  const session = verifyAdminSession(req);
  if (!session) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    username: session.username,
    role: session.role
  });
});

app.post("/api/admin/auth/login", (req, res) => {
  if (!adminEnabled) return res.status(404).json({ error: "Admin disabled." });
  if (!adminAuthConfigured()) {
    return res.status(500).json({ error: "Admin credentials are not fully configured." });
  }
  const { username, password } = req.body || {};
  const candidateUsername = String(username || "").trim();
  const candidatePassword = String(password || "");
  const normalizedCandidateUsername = candidateUsername.toLowerCase();
  const normalizedFullUsername = adminFullUsername.toLowerCase();
  const normalizedReadOnlyUsername = adminReadOnlyUsername.toLowerCase();
  let session = null;
  if (
    normalizedCandidateUsername === normalizedFullUsername &&
    comparePassword(candidatePassword, adminFullPassword)
  ) {
    session = { username: adminFullUsername, role: "full" };
  }
  if (
    normalizedCandidateUsername === normalizedReadOnlyUsername &&
    comparePassword(candidatePassword, adminReadOnlyPassword)
  ) {
    session = { username: adminReadOnlyUsername, role: "readonly" };
  }
  if (!session) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }
  setAdminSessionCookie(res, session);
  return res.json({ ok: true, username: session.username, role: session.role });
});

app.post("/api/admin/auth/logout", (_req, res) => {
  clearAdminSessionCookie(res);
  return res.json({ ok: true });
});

app.get("/api/stripe/config", (_req, res) => {
  res.json({
    configured: Boolean(stripe && stripePublishableKey),
    publishableKey: stripePublishableKey || ""
  });
});

function ensureStripePlayerAccount(player) {
  return stripe.accounts.create({
    type: "express",
    country: "US",
    email: normalizeEmail(player.email),
    business_type: "individual",
    business_profile: {
      product_description: "Youth sports equipment fundraising payouts on Gridiron Give"
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      playerId: player.id,
      playerName: `${player.first_name || ""} ${player.last_name || ""}`.trim()
    }
  });
}

function ensureStripeCoachAccount(coach, team) {
  return stripe.accounts.create({
    type: "express",
    country: "US",
    email: normalizeEmail(coach.email),
    business_type: "individual",
    business_profile: {
      product_description: `${team?.name || "Team"} youth sports fundraising collections on Gridiron Give`
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      coachId: coach.id,
      coachName: String(coach.name || "").trim(),
      teamId: team?.id || "",
      teamName: String(team?.name || "").trim()
    }
  });
}

async function syncStripePlayerAccountCapabilities({ stripeAccountId, player }) {
  if (!stripeAccountId) return null;
  const updatePayload = {
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    }
  };
  if (player) {
    updatePayload.metadata = {
      playerId: player.id,
      playerName: `${player.first_name || ""} ${player.last_name || ""}`.trim()
    };
  }
  return stripe.accounts.update(stripeAccountId, updatePayload);
}

async function syncStripeCoachAccountCapabilities({ stripeAccountId, coach, team }) {
  if (!stripeAccountId) return null;
  const updatePayload = {
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    }
  };
  updatePayload.metadata = {
    coachId: coach?.id || "",
    coachName: String(coach?.name || "").trim(),
    teamId: team?.id || "",
    teamName: String(team?.name || "").trim()
  };
  return stripe.accounts.update(stripeAccountId, updatePayload);
}

async function createOrLoadStripeAccountId({ playerId, stripeAccountId }) {
  const player = playerId
    ? db
        .prepare("SELECT id, email, first_name, last_name, stripe_account_id FROM players WHERE id=?")
        .get(playerId)
    : null;

  if (stripeAccountId) {
    return { stripeAccountId: String(stripeAccountId).trim(), player };
  }
  if (!player) {
    throw new Error("Player not found.");
  }

  let nextStripeAccountId = String(player.stripe_account_id || "").trim();
  if (!nextStripeAccountId) {
    const account = await ensureStripePlayerAccount(player);
    nextStripeAccountId = account.id;
    db.prepare("UPDATE players SET stripe_account_id=?, stripe_onboarding_complete=0 WHERE id=?").run(
      nextStripeAccountId,
      player.id
    );
  } else {
    await syncStripePlayerAccountCapabilities({ stripeAccountId: nextStripeAccountId, player });
  }

  return { stripeAccountId: nextStripeAccountId, player };
}

async function createOrLoadCoachStripeAccountId({ coachId, stripeAccountId }) {
  const coach = coachId
    ? db.prepare("SELECT id, name, email, stripe_account_id FROM coaches WHERE id=?").get(coachId)
    : null;
  const team = coachId ? db.prepare("SELECT id, name FROM teams WHERE coach_id=?").get(coachId) : null;

  if (stripeAccountId) {
    return { stripeAccountId: String(stripeAccountId).trim(), coach, team };
  }
  if (!coach) {
    throw new Error("Coach not found.");
  }

  let nextStripeAccountId = String(coach.stripe_account_id || "").trim();
  if (!nextStripeAccountId) {
    const account = await ensureStripeCoachAccount(coach, team);
    nextStripeAccountId = account.id;
    db.prepare("UPDATE coaches SET stripe_account_id=?, stripe_onboarding_complete=0 WHERE id=?").run(
      nextStripeAccountId,
      coach.id
    );
  } else {
    await syncStripeCoachAccountCapabilities({ stripeAccountId: nextStripeAccountId, coach, team });
  }

  return { stripeAccountId: nextStripeAccountId, coach, team };
}

async function onboardPlayerHandler(req, res) {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const playerId = String(req.body?.playerId || "").trim();
  const incomingStripeAccountId = String(req.body?.stripe_account_id || "").trim();
  if (!playerId && !incomingStripeAccountId) {
    return res.status(400).json({ error: "Player id or stripe_account_id is required." });
  }

  try {
    const { stripeAccountId } = await createOrLoadStripeAccountId({
      playerId,
      stripeAccountId: incomingStripeAccountId
    });

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appBaseUrl}/player-dashboard.html?stripe=refresh`,
      return_url: `${appBaseUrl}/player-dashboard.html`,
      type: "account_onboarding"
    });

    return res.json({
      ok: true,
      url: accountLink.url,
      stripeAccountId
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not start Stripe onboarding." });
  }
}

app.post("/api/stripe/onboard-player", onboardPlayerHandler);
app.post("/onboard-player", onboardPlayerHandler);

async function createAccountSessionHandler(req, res) {
  if (!stripe || !stripePublishableKey) {
    return res.status(500).json({ error: "Stripe embedded onboarding is not configured yet." });
  }

  const playerId = String(req.body?.playerId || "").trim();
  const incomingStripeAccountId = String(req.body?.stripe_account_id || "").trim();
  if (!playerId && !incomingStripeAccountId) {
    return res.status(400).json({ error: "Player id or stripe_account_id is required." });
  }

  try {
    const { stripeAccountId } = await createOrLoadStripeAccountId({
      playerId,
      stripeAccountId: incomingStripeAccountId
    });
    const accountSession = await stripe.accountSessions.create({
      account: stripeAccountId,
      components: {
        account_onboarding: {
          enabled: true
        }
      }
    });
    return res.json({
      client_secret: accountSession.client_secret,
      stripe_account_id: stripeAccountId
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not create account session." });
  }
}

app.post("/api/stripe/create-account-session", createAccountSessionHandler);
app.post("/create-account-session", createAccountSessionHandler);

app.post("/api/stripe/player-status", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const playerId = String(req.body?.playerId || "").trim();
  if (!playerId) {
    return res.status(400).json({ error: "Player id is required." });
  }

  const player = db.prepare("SELECT id, stripe_account_id FROM players WHERE id=?").get(playerId);
  if (!player) {
    return res.status(404).json({ error: "Player not found." });
  }

  const stripeAccountId = String(player.stripe_account_id || "").trim();
  if (!stripeAccountId) {
    db.prepare("UPDATE players SET stripe_onboarding_complete=0 WHERE id=?").run(playerId);
    return res.json({ stripe_account_id: "", onboarding_complete: false });
  }

  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const onboardingComplete = Boolean(account.details_submitted);
    const transfersCapability = String(account.capabilities?.transfers || "");
    const cardPaymentsCapability = String(account.capabilities?.card_payments || "");
    db.prepare("UPDATE players SET stripe_onboarding_complete=? WHERE id=?").run(
      onboardingComplete ? 1 : 0,
      playerId
    );
    return res.json({
      stripe_account_id: stripeAccountId,
      onboarding_complete: onboardingComplete,
      transfers_capability: transfersCapability,
      card_payments_capability: cardPaymentsCapability,
      payouts_enabled: Boolean(account.payouts_enabled),
      charges_enabled: Boolean(account.charges_enabled)
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not refresh Stripe status." });
  }
});

async function onboardCoachHandler(req, res) {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const coachId = String(req.body?.coachId || "").trim();
  const incomingStripeAccountId = String(req.body?.stripe_account_id || "").trim();
  if (!coachId && !incomingStripeAccountId) {
    return res.status(400).json({ error: "Coach id or stripe_account_id is required." });
  }

  try {
    const { stripeAccountId } = await createOrLoadCoachStripeAccountId({
      coachId,
      stripeAccountId: incomingStripeAccountId
    });
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appBaseUrl}/coach-dashboard.html?stripe=refresh`,
      return_url: `${appBaseUrl}/coach-dashboard.html`,
      type: "account_onboarding"
    });
    return res.json({ ok: true, url: accountLink.url, stripeAccountId });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not start coach Stripe onboarding." });
  }
}

app.post("/api/stripe/onboard-coach", onboardCoachHandler);
app.post("/onboard-coach", onboardCoachHandler);

app.post("/api/stripe/coach-status", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const coachId = String(req.body?.coachId || "").trim();
  if (!coachId) {
    return res.status(400).json({ error: "Coach id is required." });
  }
  const coach = db.prepare("SELECT id, stripe_account_id FROM coaches WHERE id=?").get(coachId);
  if (!coach) {
    return res.status(404).json({ error: "Coach not found." });
  }
  const stripeAccountId = String(coach.stripe_account_id || "").trim();
  if (!stripeAccountId) {
    db.prepare("UPDATE coaches SET stripe_onboarding_complete=0 WHERE id=?").run(coachId);
    return res.json({ stripe_account_id: "", onboarding_complete: false });
  }
  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const onboardingComplete = Boolean(account.details_submitted);
    const transfersCapability = String(account.capabilities?.transfers || "");
    const cardPaymentsCapability = String(account.capabilities?.card_payments || "");
    db.prepare("UPDATE coaches SET stripe_onboarding_complete=? WHERE id=?").run(
      onboardingComplete ? 1 : 0,
      coachId
    );
    return res.json({
      stripe_account_id: stripeAccountId,
      onboarding_complete: onboardingComplete,
      transfers_capability: transfersCapability,
      card_payments_capability: cardPaymentsCapability,
      payouts_enabled: Boolean(account.payouts_enabled),
      charges_enabled: Boolean(account.charges_enabled)
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not refresh coach Stripe status." });
  }
});

async function createStripeDashboardLinkHandler(req, res) {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const role = String(req.body?.role || "player").trim().toLowerCase();
  if (role === "coach") {
    const coachId = String(req.body?.coachId || "").trim();
    if (!coachId) {
      return res.status(400).json({ error: "Coach id is required." });
    }
    const coach = db.prepare("SELECT id, stripe_account_id FROM coaches WHERE id=?").get(coachId);
    if (!coach) {
      return res.status(404).json({ error: "Coach not found." });
    }
    const stripeAccountId = String(coach.stripe_account_id || "").trim();
    if (!stripeAccountId) {
      return res.status(400).json({ error: "Stripe is not connected for this coach yet." });
    }
    try {
      const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
      return res.json({ url: loginLink.url });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Could not open Stripe dashboard." });
    }
  }

  const playerId = String(req.body?.playerId || "").trim();
  if (!playerId) {
    return res.status(400).json({ error: "Player id is required." });
  }

  const player = db.prepare("SELECT id, stripe_account_id FROM players WHERE id=?").get(playerId);
  if (!player) {
    return res.status(404).json({ error: "Player not found." });
  }

  const stripeAccountId = String(player.stripe_account_id || "").trim();
  if (!stripeAccountId) {
    return res.status(400).json({ error: "Stripe is not connected for this player yet." });
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    return res.json({ url: loginLink.url });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not open Stripe dashboard." });
  }
}

app.post("/api/stripe/dashboard-link", createStripeDashboardLinkHandler);
app.post("/stripe/dashboard-link", createStripeDashboardLinkHandler);

async function createCheckoutSessionHandler(req, res) {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const {
    stripe_account_id: stripeAccountIdRaw,
    amount,
    coverFees,
    playerId,
    teamId,
    sourcePage,
    publicPlayerId,
    donationType,
    equipmentItemId,
    teamEquipmentName,
    donorName,
    donorEmail,
    donorMessage,
    anonymous
  } = req.body || {};

  const baseAmount = Number(amount || 0);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    return res.status(400).json({ error: "A valid amount is required." });
  }

  const cover = Boolean(coverFees);
  const split = computeStripeDonationSplit(baseAmount, cover);
  if (split.playerAmountCents <= 0) {
    return res.status(400).json({
      error:
        "This donation amount is too small after processing and platform fees. Please increase the amount or cover fees."
    });
  }

  try {
    const returnToTeam = String(sourcePage || "").trim().toLowerCase() === "team";
    let payoutRecipientType = "player";
    let payoutRecipientId = String(playerId || "").trim();
    let resolvedTeamId = String(teamId || "").trim();
    let resolvedStripeAccountId = String(stripeAccountIdRaw || "").trim();

    if (String(donationType || "").trim().toLowerCase() === "team-general") {
      const team = db.prepare("SELECT * FROM teams WHERE id=?").get(resolvedTeamId);
      if (!team) {
        return res.status(404).json({ error: "Team not found." });
      }
      const coach = db.prepare("SELECT id, stripe_account_id FROM coaches WHERE id=?").get(team.coach_id);
      payoutRecipientType = "coach";
      payoutRecipientId = String(coach?.id || "");
      resolvedStripeAccountId = String(coach?.stripe_account_id || "");
    } else {
      const payoutContext = payoutContextForPlayer(String(playerId || "").trim());
      if (!payoutContext) {
        return res.status(404).json({ error: "Player donation target not found." });
      }
      payoutRecipientType = payoutContext.recipientType;
      payoutRecipientId = payoutContext.recipientId;
      resolvedTeamId = payoutContext.teamId;
      resolvedStripeAccountId = payoutContext.stripeAccountId;
    }

    if (!resolvedStripeAccountId) {
      return res.status(400).json({ error: "This recipient has not connected Stripe yet." });
    }

    const destinationAccount = await stripe.accounts.retrieve(resolvedStripeAccountId);
    const transfersCapability = String(destinationAccount.capabilities?.transfers || "");
    const cardPaymentsCapability = String(destinationAccount.capabilities?.card_payments || "");
    if (transfersCapability !== "active") {
      return res.status(400).json({
        error:
          "This player’s Stripe account is not ready to receive transfers yet. Have the player reopen Stripe payout setup and finish all required steps."
      });
    }
    if (cardPaymentsCapability && cardPaymentsCapability !== "active") {
      return res.status(400).json({
        error:
          "This player’s Stripe account is still waiting on payment capability approval. Have the player reopen Stripe payout setup and complete Stripe verification."
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: split.checkoutTotalCents,
            product_data: {
              name: donationType === "general" ? "General Donation" : "Equipment Donation",
              description: "Gridiron Give athlete support donation"
            }
          }
        }
      ],
      success_url: returnToTeam
        ? `${appBaseUrl}/team-profile.html?teamId=${encodeURIComponent(resolvedTeamId)}&checkout=success`
        : `${appBaseUrl}/player-profile.html?playerId=${encodeURIComponent(publicPlayerId || "")}&checkout=success`,
      cancel_url: returnToTeam
        ? `${appBaseUrl}/team-profile.html?teamId=${encodeURIComponent(resolvedTeamId)}&checkout=cancelled`
        : `${appBaseUrl}/player-profile.html?playerId=${encodeURIComponent(publicPlayerId || "")}&checkout=cancelled`,
      customer_email: donorEmail ? normalizeEmail(donorEmail) : undefined,
      payment_intent_data: {
        on_behalf_of: resolvedStripeAccountId,
        transfer_data: {
          destination: resolvedStripeAccountId,
          amount: split.playerAmountCents
        }
      },
      metadata: {
        playerId: String(playerId || ""),
        teamId: resolvedTeamId,
        publicPlayerId: String(publicPlayerId || ""),
        donationType: String(donationType || "equipment"),
        equipmentItemId: String(equipmentItemId || ""),
        teamEquipmentName: String(teamEquipmentName || "").slice(0, 120),
        donorName: String(donorName || "").slice(0, 200),
        donorEmail: normalizeEmail(donorEmail || ""),
        donorMessage: String(donorMessage || "").slice(0, 400),
        anonymous: anonymous ? "true" : "false",
        baseAmount: String(Math.round(baseAmount)),
        playerAmount: String(split.playerAmountCents),
        stripeFeeAmount: String(split.stripeFeeCents),
        applicationFeeAmount: String(split.applicationFeeCents),
        payoutRecipientType,
        payoutRecipientId,
        stripeDestinationAccountId: resolvedStripeAccountId,
        coverFees: cover ? "true" : "false"
      }
    });

    return res.json({
      url: session.url,
      sessionId: session.id,
      totalAmount: split.checkoutTotalCents,
      playerAmount: split.playerAmountCents,
      applicationFeeAmount: split.applicationFeeCents,
      stripeFeeAmount: split.stripeFeeCents
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not create checkout session." });
  }
}

app.post("/api/stripe/create-checkout-session", createCheckoutSessionHandler);
app.post("/create-checkout-session", createCheckoutSessionHandler);

app.post("/stripe/webhook", (req, res) => {
  if (!stripe || !stripeWebhookSecret) {
    return res.status(500).send("Stripe webhook is not configured.");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).send("Missing Stripe signature.");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error?.message || "Invalid signature."}`);
  }

  Promise.resolve()
    .then(async () => {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const sessionId = String(session.id || "").trim();
        if (!sessionId) return;

        const alreadyProcessed = db
          .prepare("SELECT session_id FROM processed_checkout_sessions WHERE session_id=?")
          .get(sessionId);
        if (alreadyProcessed) return;

        const paymentIntentId =
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
        if (!paymentIntentId) {
          throw new Error("Checkout session completed without a payment intent.");
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge"]
        });
        const latestCharge =
          typeof paymentIntent.latest_charge === "string"
            ? await stripe.charges.retrieve(paymentIntent.latest_charge)
            : paymentIntent.latest_charge;

        const chargeTransferData = latestCharge?.transfer_data || null;
        const transferDestination =
          typeof chargeTransferData?.destination === "string"
            ? chargeTransferData.destination
            : chargeTransferData?.destination?.id || "";
        const transferId =
          typeof latestCharge?.transfer === "string" ? latestCharge.transfer : latestCharge?.transfer?.id || "";
        if (!transferDestination) {
          throw new Error("Stripe destination transfer was skipped for this payment.");
        }

        const metadata = session.metadata || {};
        const playerId = String(metadata.playerId || "").trim();
        const teamId = String(metadata.teamId || "").trim();
        const donationType = String(metadata.donationType || "equipment").trim().toLowerCase();
        const donorEmail = normalizeEmail(metadata.donorEmail || session.customer_details?.email || "");
        const donorName = String(metadata.donorName || session.customer_details?.name || "Supporter").trim();
        const donorMessage = String(metadata.donorMessage || "").trim();
        let equipmentItemId = String(metadata.equipmentItemId || "").trim();
        const teamEquipmentName = String(metadata.teamEquipmentName || "").trim();
        const anonymous = String(metadata.anonymous || "") === "true";
        const athleteAmount = Number(metadata.playerAmount || metadata.baseAmount || 0) / 100;
        const checkoutTotalAmount = Number(session.amount_total || 0) / 100;
        const applicationFeeAmount = Number(metadata.applicationFeeAmount || 0) / 100;
        const payoutRecipientType = String(metadata.payoutRecipientType || "player").trim().toLowerCase();
        const payoutRecipientId = String(metadata.payoutRecipientId || "").trim();
        const stripeDestinationAccountId = String(metadata.stripeDestinationAccountId || transferDestination || "").trim();

        if ((!playerId && donationType !== "team-general") || !donorEmail || athleteAmount <= 0) {
          throw new Error("Stripe checkout metadata is incomplete.");
        }
        if (!equipmentItemId && donationType === "equipment" && playerId && teamEquipmentName) {
          const matchedEquipment = db
            .prepare(
              "SELECT id FROM equipment_items WHERE player_id=? AND lower(name)=lower(?) AND enabled=1 ORDER BY rowid ASC LIMIT 1"
            )
            .get(playerId, teamEquipmentName);
          equipmentItemId = String(matchedEquipment?.id || "");
        }

        const donationResult = applyDonationToDatabase({
          playerId,
          teamId,
          donationType,
          equipmentItemId,
          donorName,
          donorEmail,
          donorMessage,
          anonymous,
          amount: athleteAmount,
          payoutRecipientType,
          payoutRecipientId,
          stripeDestinationAccountId,
          stripeCheckoutSessionId: sessionId,
          stripePaymentIntentId: paymentIntentId,
          stripeChargeId: String(latestCharge?.id || ""),
          checkoutTotalAmount,
          applicationFeeAmount
        });

        db.prepare(
          `INSERT INTO processed_checkout_sessions (session_id, payment_intent_id, charge_id, transfer_id, player_id)
           VALUES (?, ?, ?, ?, ?)`
        ).run(sessionId, paymentIntentId, String(latestCharge?.id || ""), transferId, playerId);

        const player = db
          .prepare("SELECT first_name, last_name, email FROM players WHERE id=?")
          .get(playerId);
        if (player?.email) {
          await sendPlayerDonationEmail({
            to: player.email,
            playerName: `${player.first_name || ""} ${player.last_name || ""}`.trim() || "your athlete profile",
            donorName: anonymous ? "An anonymous donor" : donorName,
            amount: athleteAmount,
            itemName:
              donationType === "general"
                ? "General Donation"
                : donationResult?.allocations?.[0]?.equipmentName || "Equipment Donation",
            generalDonation: donationType === "general"
          });
        }

        if (donorEmail) {
          await sendDonorReceiptEmail({
            to: donorEmail,
            donorName,
            playerName: `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || "Athlete",
            amount: athleteAmount,
            itemName:
              donationType === "general"
                ? "General Donation"
                : donationResult?.allocations?.[0]?.equipmentName || "Equipment Donation",
            generalDonation: donationType === "general"
          });
        }
      }
    })
    .then(() => {
      res.json({ received: true });
    })
    .catch((error) => {
      console.error("Stripe webhook processing failed:", error);
      res.status(500).send(error?.message || "Webhook processing failed.");
    });
});

app.get("/api/health/email", async (_req, res) => {
  const configured = Boolean(gmailUser && gmailAppPassword);
  const hasWhitespaceInRawPassword = /\s/u.test(gmailAppPasswordRaw);
  if (!configured || !transporter) {
    return res.json({
      configured: false,
      gmailUserConfigured: Boolean(gmailUser),
      appPasswordConfigured: Boolean(gmailAppPassword),
      hasWhitespaceInRawPassword
    });
  }

  try {
    await transporter.verify();
    return res.json({
      configured: true,
      verified: true,
      gmailUserConfigured: true,
      appPasswordConfigured: true,
      hasWhitespaceInRawPassword
    });
  } catch (error) {
    return res.status(500).json({
      configured: true,
      verified: false,
      gmailUserConfigured: true,
      appPasswordConfigured: true,
      hasWhitespaceInRawPassword,
      error: error?.message || "SMTP verification failed."
    });
  }
});

app.post("/api/coaches/signup", async (req, res) => {
  const { name, email, password, teamName, recipientMode } = req.body || {};
  let safeName;
  let safeEmail;
  let safeTeamName;
  const payoutMode = String(recipientMode || "coach").trim().toLowerCase() === "player" ? "player" : "coach";
  try {
    safeName = assertSafeName(name, "Name");
    safeEmail = assertValidEmail(email);
    safeTeamName = assertSafeName(teamName, "Team Name");
    if (!String(password || "").trim()) {
      throw new Error("Password is required.");
    }
  } catch (error) {
    return res.status(400).json({ error: error.message || "Missing required fields." });
  }
  const exists = db
    .prepare("SELECT id FROM coaches WHERE lower(email) = lower(?)")
    .get(safeEmail);
  if (exists) return res.status(409).json({ error: "Coach email already exists." });

  const coachId = uid("coach");
  const teamId = uid("team");
  const key = recoveryKey();
  const teamNameValue = safeTeamName;
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO coaches (id, name, email, password, "PW_Recovery_Key") VALUES (?, ?, ?, ?, ?)').run(
      coachId,
      safeName,
      safeEmail,
      passwordHash(String(password)),
      key
    );
    db.prepare("INSERT INTO teams (id, coach_id, name, location, sport, recipient_mode) VALUES (?, ?, ?, '', '', ?)").run(
      teamId,
      coachId,
      teamNameValue,
      payoutMode
    );
    db.prepare("UPDATE coaches SET team_name=? WHERE id=?").run(teamNameValue, coachId);
  });
  tx();
  if (payoutMode === "coach") {
    ensureTeamSharedEquipmentTemplates({ id: teamId, sport: "football" });
  }
  let welcomeEmailSent = false;
  let welcomeEmailError = "";
  try {
    const delivery = await sendCoachWelcomeEmail({
      to: safeEmail,
      coachName: safeName,
      teamName: teamNameValue
    });
    welcomeEmailSent = Boolean(delivery?.sent);
    welcomeEmailError = delivery?.reason ? String(delivery.reason) : "";
  } catch {
    // eslint-disable-next-line no-console
    console.error("Failed to send coach welcome email.");
    welcomeEmailSent = false;
    welcomeEmailError = "Email provider rejected send attempt.";
  }
  return res.json({ coachId, welcomeEmailSent, welcomeEmailError });
});

app.post("/api/coaches/signin", (req, res) => {
  const { email, password } = req.body || {};
  let safeEmail;
  try {
    safeEmail = assertValidEmail(email);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Email format is invalid." });
  }
  const coach = db
    .prepare("SELECT id, password FROM coaches WHERE lower(email)=lower(?)")
    .get(safeEmail);
  if (!coach || !comparePassword(password, coach.password)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  if (!isBcryptHash(coach.password)) {
    db.prepare("UPDATE coaches SET password=? WHERE id=?").run(passwordHash(String(password)), coach.id);
  }
  return res.json({ coachId: coach.id });
});

app.get("/api/coaches/:coachId/dashboard", (req, res) => {
  const { coachId } = req.params;
  const coach = db
    .prepare("SELECT id, name, email, stripe_account_id, stripe_onboarding_complete FROM coaches WHERE id = ?")
    .get(coachId);
  if (!coach) return res.status(404).json({ error: "Coach not found." });
  const team = teamByCoachId(coachId);
  if (String(team?.recipient_mode || "coach") === "coach") {
    ensureTeamSharedEquipmentTemplates(team);
    syncTeamSharedEquipmentToPlayers(team.id);
  }
  const players = db
    .prepare(
      `SELECT id, first_name, last_name, email, player_public_id, registered, published
       FROM players WHERE team_id = ? ORDER BY first_name, last_name`
    )
    .all(team.id)
    .map((player) => {
      const totals = playerTotals(player.id);
      const pct = totals.goal_total > 0 ? Math.round((totals.raised_total / totals.goal_total) * 100) : 0;
      return {
        ...player,
        goalTotal: totals.goal_total,
        raisedTotal: totals.raised_total,
        percentRaised: pct
      };
    });
  const teamEquipment =
    String(team?.recipient_mode || "coach") === "coach" ? teamEquipmentTemplateRows(team.id) : [];
  const transactions =
    String(team?.recipient_mode || "coach") === "coach"
      ? db
          .prepare(
            `SELECT
              d.id,
              d.amount,
              d.checkout_total_amount,
              d.application_fee_amount,
              d.created_at,
              p.first_name,
              p.last_name,
              COALESCE(e.name, 'General Donation') AS equipment_name
             FROM donations d
             JOIN players p ON p.id = d.player_id
             LEFT JOIN equipment_items e ON e.id = d.equipment_item_id
             WHERE d.team_id = ?
             ORDER BY d.created_at DESC
             LIMIT 200`
          )
          .all(team.id)
      : [];
  return res.json({ coach, team, players, teamEquipment, transactions });
});

app.patch("/api/teams/:teamId", (req, res) => {
  const { teamId } = req.params;
  const { name, location, sport, recipientMode } = req.body || {};
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId);
  if (!team) return res.status(404).json({ error: "Team not found." });
  let nextSport;
  let nextName;
  let nextLocation;
  const nextRecipientMode = String(recipientMode || team.recipient_mode || "coach").trim().toLowerCase() === "player"
    ? "player"
    : "coach";
  try {
    nextSport = sanitizeSingleLineText(sport ?? team.sport ?? "").toLowerCase();
    nextName = assertSafeName(name || team.name, "Team Name");
    nextLocation = assertSafeOptionalText(location || "", "Team Location", 120);
    if (nextSport && !["football", "hockey", "lacrosse", "baseball"].includes(nextSport)) {
      throw new Error("Sport selection is invalid.");
    }
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid team profile data." });
  }
  db.prepare("UPDATE teams SET name=?, location=?, sport=?, recipient_mode=? WHERE id=?").run(
    nextName,
    nextLocation,
    nextSport,
    nextRecipientMode,
    teamId
  );
  db.prepare("UPDATE coaches SET team_name=? WHERE id=?").run(nextName, team.coach_id);
  db.prepare("UPDATE players SET team_name=? WHERE team_id=?").run(nextName, teamId);
  if (nextRecipientMode === "coach") {
    ensureTeamSharedEquipmentTemplates({ id: teamId, sport: nextSport || "football" });
    syncTeamSharedEquipmentToPlayers(teamId);
  }
  return res.json({ ok: true });
});

app.put("/api/teams/:teamId/shared-equipment", (req, res) => {
  const { teamId } = req.params;
  const team = db.prepare("SELECT * FROM teams WHERE id=?").get(teamId);
  if (!team) return res.status(404).json({ error: "Team not found." });
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: "Shared equipment items are required." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM team_equipment_templates WHERE team_id=?").run(teamId);
    items.forEach((item, index) => {
      db.prepare(
        `INSERT INTO team_equipment_templates
        (id, team_id, name, category, price_range, goal, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id || uid("teq"),
        teamId,
        assertSafeName(item.name || "Equipment", "Equipment Name", 80),
        assertSafeOptionalText(item.category || "General", "Equipment Category", 60) || "General",
        assertSafeOptionalText(item.price_range || item.priceRange || "", "Typical Price Range", 80),
        Number(item.goal || 0),
        item.enabled === false ? 0 : 1,
        index
      );
    });
  });

  try {
    tx();
    syncTeamSharedEquipmentToPlayers(teamId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Could not save shared equipment." });
  }
});

app.post("/api/players/upsert", async (req, res) => {
  const { teamId, firstName, lastName, email } = req.body || {};
  let safeFirstName;
  let safeLastName;
  let safeEmail;
  try {
    safeFirstName = assertSafeName(firstName, "First Name", 80);
    safeLastName = assertSafeName(lastName, "Last Name", 80);
    safeEmail = assertValidEmail(email);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Missing required fields." });
  }
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId);
  if (!team) return res.status(404).json({ error: "Team not found." });
  const normalized = safeEmail;
  let player = db
    .prepare("SELECT * FROM players WHERE team_id=? AND lower(email)=lower(?)")
    .get(teamId, normalized);

  let created = false;
  let inviteSent = false;
  let inviteError = "";
  if (!player) {
    created = true;
    const id = uid("player");
    let publicId = playerPublicId();
    while (db.prepare("SELECT id FROM players WHERE player_public_id=?").get(publicId)) {
      publicId = playerPublicId();
    }
    db.prepare(
      `INSERT INTO players
      (id, team_id, first_name, last_name, email, team_name, player_public_id, password, "PW_Recovery_Key", registered, image_data_url, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 0, '', 0)`
    ).run(
      id,
      teamId,
      safeFirstName,
      safeLastName,
      normalized,
      team.name,
      publicId,
      recoveryKey()
    );
    player = db.prepare("SELECT * FROM players WHERE id=?").get(id);

    const sharedTemplates =
      String(team.recipient_mode || "coach") === "coach"
        ? ensureTeamSharedEquipmentTemplates(team)
        : [];
    const sourceRows = sharedTemplates.length
      ? sharedTemplates.map((row) => [row.name, row.category, row.price_range, row.goal, row.enabled, row.sort_order])
      : equipmentTemplateForSport(team.sport).map((row, index) => [row[0], row[1], row[2], 0, 1, index]);
    sourceRows.forEach((row, index) => {
      if (hasEquipmentSortOrder) {
        db.prepare(
          `INSERT INTO equipment_items
          (id, player_id, name, category, price_range, goal, raised, enabled, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(uid("eq"), id, row[0], row[1], row[2], Number(row[3] || 0), Number(row[4]) === 0 ? 0 : 1, Number(row[5] ?? index));
        return;
      }
      db.prepare(
        `INSERT INTO equipment_items
        (id, player_id, name, category, price_range, goal, raised, enabled)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(uid("eq"), id, row[0], row[1], row[2], Number(row[3] || 0), Number(row[4]) === 0 ? 0 : 1);
    });
  } else {
    db.prepare("UPDATE players SET first_name=?, last_name=?, team_name=? WHERE id=?").run(
      safeFirstName,
      safeLastName,
      team.name,
      player.id
    );
  }
  if (created) {
    const coach = db.prepare("SELECT c.name FROM coaches c JOIN teams t ON t.coach_id = c.id WHERE t.id=?").get(teamId);
    try {
      const delivery = await sendRosterInviteEmail({
        to: normalizeEmail(email),
        teamName: team.name,
        coachName: coach?.name || "Your coach",
        playerPublicId: player.player_public_id,
        recipientMode: team.recipient_mode || "coach"
      });
      inviteSent = Boolean(delivery?.sent);
      inviteError = delivery?.reason ? String(delivery.reason) : "";
    } catch {
      // eslint-disable-next-line no-console
      console.error("Failed to send roster invite email.");
      inviteSent = false;
      inviteError = "Email provider rejected send attempt.";
    }
  }
  return res.json({
    playerId: player.id,
    playerPublicId: player.player_public_id,
    created,
    inviteSent,
    inviteError
  });
});

app.delete("/api/players/:playerId", (req, res) => {
  db.prepare("DELETE FROM players WHERE id=?").run(req.params.playerId);
  return res.json({ ok: true });
});

app.post("/api/players/signup", (req, res) => {
  const { playerPublicId: publicId, password } = req.body || {};
  let safePublicId;
  try {
    safePublicId = assertValidPlayerPublicId(publicId);
    if (!String(password || "").trim()) throw new Error("Password is required.");
  } catch (error) {
    return res.status(400).json({ error: error.message || "Missing required fields." });
  }
  const player = db.prepare("SELECT * FROM players WHERE lower(player_public_id)=lower(?)").get(safePublicId);
  if (!player) return res.status(404).json({ error: "PlayerID not found." });
  db.prepare("UPDATE players SET password=?, registered=1 WHERE id=?").run(
    passwordHash(String(password)),
    player.id
  );
  return res.json({ playerId: player.id, email: player.email });
});

app.post("/api/players/signin", (req, res) => {
  const { email, password } = req.body || {};
  let safeEmail;
  try {
    safeEmail = assertValidEmail(email);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Email format is invalid." });
  }
  const player = db
    .prepare("SELECT id, password, registered FROM players WHERE lower(email)=lower(?)")
    .get(safeEmail);
  if (player && Number(player.registered) === 0) {
    return res.status(403).json({
      error: "Account not activated yet. Use Player Sign Up with your PlayerID first."
    });
  }
  if (!player || !comparePassword(password, player.password)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  if (!isBcryptHash(player.password)) {
    db.prepare("UPDATE players SET password=? WHERE id=?").run(passwordHash(String(password)), player.id);
  }
  return res.json({ playerId: player.id });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  let normalized;
  try {
    normalized = assertValidEmail(email);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Email is required." });
  }

  const coach = db
    .prepare('SELECT id, email, "PW_Recovery_Key" AS recovery_key FROM coaches WHERE lower(email)=lower(?)')
    .get(normalized);
  const player = db
    .prepare('SELECT id, email, "PW_Recovery_Key" AS recovery_key FROM players WHERE lower(email)=lower(?)')
    .get(normalized);

  const deliveries = [];
  try {
    if (coach) {
      const key = coach.recovery_key || generateRecoveryKey();
      if (!coach.recovery_key) {
        db.prepare('UPDATE coaches SET "PW_Recovery_Key"=? WHERE id=?').run(key, coach.id);
      }
      deliveries.push(sendRecoveryEmail({ to: coach.email, recoveryKeyValue: key, role: "coach" }));
    }
    if (player) {
      const key = player.recovery_key || generateRecoveryKey();
      if (!player.recovery_key) {
        db.prepare('UPDATE players SET "PW_Recovery_Key"=? WHERE id=?').run(key, player.id);
      }
      deliveries.push(sendRecoveryEmail({ to: player.email, recoveryKeyValue: key, role: "player" }));
    }
    await Promise.all(deliveries);
    return res.json({
      ok: true,
      message: "If an account exists for this email, recovery instructions were sent."
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not send recovery email." });
  }
});

app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body || {};
  let senderName;
  let senderEmail;
  let messageContent;
  try {
    senderName = assertSafeName(name, "Name", 120);
    senderEmail = assertValidEmail(email);
    messageContent = assertSafeMessage(message, "Message", 4000);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Name, email, and message are required." });
  }

  if (!senderName || !senderEmail || !messageContent) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }
  if (!transporter || !gmailUser) {
    return res.status(500).json({ error: "Contact email is not configured yet." });
  }

  const sentAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const subject = `CONTACT US - ${senderName}`;
  const text = `${messageContent}\n\nSender Email: ${senderEmail}\nSent: ${sentAt}`;

  try {
    await transporter.sendMail({
      from: gmailUser,
      to: gmailUser,
      subject,
      text
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Could not send contact message." });
  }
});

app.post("/api/auth/verify-recovery", (req, res) => {
  const { email, recoveryKey: key, role } = req.body || {};
  if (!email || !key) return res.status(400).json({ error: "Email and Recovery Key are required." });
  let normalized;
  let safeKey;
  try {
    normalized = assertValidEmail(email);
    safeKey = assertValidRecoveryKey(key);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid recovery details." });
  }
  const tableName = role === "coach" ? "coaches" : role === "player" ? "players" : null;

  const lookup = (table) =>
    db
      .prepare(`SELECT id FROM ${table} WHERE lower(email)=lower(?) AND "PW_Recovery_Key"=?`)
      .get(normalized, safeKey);

  const matched = tableName ? lookup(tableName) : lookup("coaches") || lookup("players");
  if (!matched) return res.status(401).json({ error: "Invalid recovery details." });
  return res.json({ ok: true });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { email, recoveryKey: key, newPassword, role } = req.body || {};
  if (!email || !key || !newPassword) {
    return res.status(400).json({ error: "Email, Recovery Key, and new password are required." });
  }
  let normalized;
  let safeKey;
  try {
    normalized = assertValidEmail(email);
    safeKey = assertValidRecoveryKey(key);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid recovery details." });
  }
  const tables = role === "coach" ? ["coaches"] : role === "player" ? ["players"] : ["coaches", "players"];
  const nextHash = passwordHash(String(newPassword));
  const nextRecovery = generateRecoveryKey();

  for (const table of tables) {
    const row = db
      .prepare(`SELECT id FROM ${table} WHERE lower(email)=lower(?) AND "PW_Recovery_Key"=?`)
      .get(normalized, safeKey);
    if (!row) continue;
    db.prepare(`UPDATE ${table} SET password=?, "PW_Recovery_Key"=? WHERE id=?`).run(
      nextHash,
      nextRecovery,
      row.id
    );
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "Invalid recovery details." });
});

app.get("/api/players/lookup/:publicId", (req, res) => {
  let safePublicId;
  try {
    safePublicId = assertValidPlayerPublicId(req.params.publicId || "");
  } catch (error) {
    return res.status(400).json({ error: error.message || "PlayerID not found." });
  }
  const player = db
    .prepare("SELECT id, email, player_public_id, registered FROM players WHERE lower(player_public_id)=lower(?)")
    .get(safePublicId);
  if (!player) return res.status(404).json({ error: "PlayerID not found." });
  return res.json(player);
});

app.get("/api/players/:playerId/dashboard", (req, res) => {
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.playerId);
  if (!player) return res.status(404).json({ error: "Player not found." });
  const team = db.prepare("SELECT * FROM teams WHERE id=?").get(player.team_id);
  const coach = team ? db.prepare("SELECT id, name, stripe_account_id, stripe_onboarding_complete FROM coaches WHERE id=?").get(team.coach_id) : null;
  const equipment = equipmentRows(player.id, true);
  const totals = playerTotals(player.id);
  return res.json({
    player: {
      ...player,
      teamName: team?.name || "",
      teamSport: team?.sport || "",
      teamRecipientMode: team?.recipient_mode || "coach",
      coachName: coach?.name || "",
      coachStripeAccountId: String(coach?.stripe_account_id || ""),
      coachStripeOnboardingComplete: Number(coach?.stripe_onboarding_complete || 0),
      goalTotal: totals.goal_total,
      raisedTotal: totals.raised_total,
      equipment
    }
  });
});

app.put("/api/players/:playerId/dashboard", (req, res) => {
  const playerId = req.params.playerId;
  const { imageDataUrl, published, equipment } = req.body || {};
  const player = db.prepare("SELECT * FROM players WHERE id=?").get(playerId);
  if (!player) return res.status(404).json({ error: "Player not found." });
  const team = db.prepare("SELECT * FROM teams WHERE id=?").get(player.team_id);

  let sanitizedEquipment = null;
  try {
    if (String(team?.recipient_mode || "coach") === "coach" && Array.isArray(equipment)) {
      throw new Error("Coach-managed teams set equipment pricing from the manager dashboard.");
    }
    if (Array.isArray(equipment)) {
      sanitizedEquipment = equipment.map((item) => ({
        id: String(item?.id || "").trim(),
        name: assertSafeName(item?.name || "Equipment", "Equipment name", 80),
        category: assertSafeOptionalText(item?.category || "General", "Equipment category", 60) || "General",
        priceRange: assertSafeOptionalText(item?.price_range || item?.priceRange || "", "Typical price range", 80),
        goal: Number(item?.goal || 0),
        raised: Number(item?.raised || 0),
        enabled: item?.enabled === false ? 0 : 1
      }));
      if (sanitizedEquipment.some((item) => !Number.isFinite(item.goal) || item.goal < 0)) {
        throw new Error("Equipment goal values are invalid.");
      }
      if (sanitizedEquipment.some((item) => !Number.isFinite(item.raised) || item.raised < 0)) {
        throw new Error("Equipment raised values are invalid.");
      }
    }
    if (typeof imageDataUrl === "string") {
      assertAllowedLength(imageDataUrl, 2_500_000, "Image upload");
    }
  } catch (error) {
    return res.status(400).json({ error: error.message || "Player dashboard update is invalid." });
  }

  const tx = db.transaction(() => {
    if (typeof imageDataUrl === "string") {
      db.prepare("UPDATE players SET image_data_url=? WHERE id=?").run(imageDataUrl, playerId);
    }
    if (typeof published === "boolean") {
      db.prepare("UPDATE players SET published=? WHERE id=?").run(published ? 1 : 0, playerId);
    }
    if (Array.isArray(sanitizedEquipment)) {
      db.prepare("DELETE FROM equipment_items WHERE player_id=?").run(playerId);
      sanitizedEquipment.forEach((item, index) => {
        if (hasEquipmentSortOrder) {
          db.prepare(
            `INSERT INTO equipment_items
            (id, player_id, name, category, price_range, goal, raised, enabled, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            item.id || uid("eq"),
            playerId,
            item.name,
            item.category,
            item.priceRange,
            item.goal,
            item.raised,
            item.enabled,
            index
          );
          return;
        }
        db.prepare(
          `INSERT INTO equipment_items
          (id, player_id, name, category, price_range, goal, raised, enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          item.id || uid("eq"),
          playerId,
          item.name,
          item.category,
          item.priceRange,
          item.goal,
          item.raised,
          item.enabled
        );
      });
    }
  });
  tx();
  return res.json({ ok: true });
});

app.get("/api/search/players", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = db
    .prepare(
      `SELECT p.id, p.player_public_id, p.first_name, p.last_name, t.id AS team_id, t.name AS team_name
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE lower(p.first_name || ' ' || p.last_name) LIKE lower(?)
       ORDER BY p.first_name, p.last_name
       LIMIT 10`
    )
    .all(`%${q}%`);
  return res.json(rows);
});

app.get("/api/search/teams", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = db
    .prepare("SELECT id, name FROM teams WHERE lower(name) LIKE lower(?) ORDER BY name LIMIT 10")
    .all(`%${q}%`);
  return res.json(rows);
});

app.get("/api/public/teams", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, sport
       FROM teams
       ORDER BY name
       LIMIT 100`
    )
    .all();
  return res.json(rows);
});

app.get("/api/public/players/:publicId", (req, res) => {
  const player = db
    .prepare(
      `SELECT
        p.*,
        t.name AS team_name,
        t.sport AS team_sport,
        t.recipient_mode,
        c.id AS coach_id,
        c.name AS coach_name,
        c.stripe_account_id AS coach_stripe_account_id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       JOIN coaches c ON c.id = t.coach_id
       WHERE lower(player_public_id) = lower(?)`
    )
    .get(String(req.params.publicId || ""));
  if (!player) return res.status(404).json({ error: "Player not found." });
  const equipment = equipmentRows(player.id, false);
  const totals = playerTotals(player.id);
  return res.json({
    player: {
      ...player,
      recipient_mode: player.recipient_mode || "coach",
      coach_name: player.coach_name || "",
      stripe_account_id:
        String(player.recipient_mode || "coach") === "coach"
          ? String(player.coach_stripe_account_id || "")
          : String(player.stripe_account_id || ""),
      equipment,
      goalTotal: totals.goal_total,
      raisedTotal: totals.raised_total
    }
  });
});

app.get("/api/public/teams/:teamId", (req, res) => {
  const team = db.prepare("SELECT * FROM teams WHERE id=?").get(req.params.teamId);
  if (!team) return res.status(404).json({ error: "Team not found." });
  const coach = db.prepare("SELECT id, name, stripe_account_id FROM coaches WHERE id=?").get(team.coach_id);
  if (String(team.recipient_mode || "coach") === "coach") {
    ensureTeamSharedEquipmentTemplates(team);
    syncTeamSharedEquipmentToPlayers(team.id);
  }
  const players = db
    .prepare("SELECT id, first_name, last_name, player_public_id FROM players WHERE team_id=?")
    .all(team.id)
    .map((p) => {
      const totals = playerTotals(p.id);
      return { ...p, goalTotal: totals.goal_total, raisedTotal: totals.raised_total };
    });
  const teamEquipment =
    String(team.recipient_mode || "coach") === "coach"
      ? teamEquipmentTemplateRows(team.id)
      : [];
  const totalTeamGoal =
    String(team.recipient_mode || "coach") === "coach"
      ? teamEquipment.reduce((sum, item) => sum + Number(item.goal || 0), 0) * players.length
      : players.reduce((sum, item) => sum + Number(item.goalTotal || 0), 0);
  const totalTeamRaised = players.reduce((sum, item) => sum + Number(item.raisedTotal || 0), 0);
  return res.json({ team: { ...team, coach_name: coach?.name || "", stripe_account_id: String(coach?.stripe_account_id || "") }, players, teamEquipment, totalTeamGoal, totalTeamRaised });
});

app.post("/api/donations", (req, res) => {
  const {
    playerId,
    donationType,
    equipmentItemId,
    donorName,
    donorEmail,
    donorMessage,
    anonymous,
    amount
  } = req.body || {};
  try {
    const result = applyDonationToDatabase({
      playerId,
      donationType,
      equipmentItemId,
      donorName,
      donorEmail,
      donorMessage,
      anonymous,
      amount
    });
    return res.json(result);
  } catch (error) {
    const message = error?.message || "Could not process donation.";
    const status =
      /unavailable|not found/i.test(message) ? 404 : /missing|amount exceeds|greater than zero/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

app.get("/api/admin/overview", (_req, res) => {
  const counts = {
    coaches: db.prepare("SELECT COUNT(*) AS count FROM coaches").get().count,
    teams: db.prepare("SELECT COUNT(*) AS count FROM teams").get().count,
    players: db.prepare("SELECT COUNT(*) AS count FROM players").get().count,
    equipmentItems: db.prepare("SELECT COUNT(*) AS count FROM equipment_items").get().count,
    donations: db.prepare("SELECT COUNT(*) AS count FROM donations").get().count
  };
  const recentDonations = db
    .prepare(
      `SELECT d.created_at, d.amount, d.donor_name, p.first_name, p.last_name, e.name AS equipment_name
       FROM donations d
       JOIN players p ON p.id = d.player_id
       JOIN equipment_items e ON e.id = d.equipment_item_id
       ORDER BY d.created_at DESC
       LIMIT 10`
    )
    .all();
  res.json({ counts, recentDonations });
});

app.get("/api/admin/table/:tableName", (req, res) => {
  const allowed = new Set(["coaches", "teams", "players", "equipment_items", "donations"]);
  const tableName = String(req.params.tableName || "");
  if (!allowed.has(tableName)) return res.status(400).json({ error: "Invalid table name." });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT ?`).all(limit);
  res.json({ tableName, rows });
});

app.get("/api/admin/columns/:tableName", (req, res) => {
  const allowed = new Set(["coaches", "teams", "players", "equipment_items", "donations"]);
  const tableName = String(req.params.tableName || "");
  if (!allowed.has(tableName)) return res.status(400).json({ error: "Invalid table name." });
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
  res.json({ tableName, columns });
});

app.get("/api/admin/backups/latest", (_req, res) => {
  if (!latestJsonBackupPath) return res.status(500).json({ error: "Backup path not available." });
  if (!pathExists(latestJsonBackupPath)) {
    runDatabaseBackup("admin-download");
  }
  return res.download(latestJsonBackupPath, "gridiron-give-backup-latest.json");
});

app.get("/api/admin/backups/latest-excel", (_req, res) => {
  if (!latestExcelBackupPath) return res.status(500).json({ error: "Backup path not available." });
  if (!pathExists(latestExcelBackupPath)) {
    runDatabaseBackup("admin-download");
  }
  res.setHeader("Content-Type", "application/vnd.ms-excel");
  return res.download(latestExcelBackupPath, "gridiron-give-backup-latest.xml");
});

app.post("/api/admin/sql", (req, res) => {
  const sql = String(req.body?.sql || "").trim();
  if (!sql) return res.status(400).json({ error: "SQL is required." });

  const normalized = sql.replace(/\s+/g, " ").trim();
  const firstWord = normalized.split(" ")[0]?.toUpperCase();
  const allowedFirstWord = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "WITH"]);
  if (!allowedFirstWord.has(firstWord)) {
    return res.status(400).json({ error: "Only SELECT, INSERT, UPDATE, DELETE, WITH statements are allowed." });
  }

  const blockedPatterns = [
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bATTACH\b/i,
    /\bDETACH\b/i,
    /\bPRAGMA\b/i,
    /\bVACUUM\b/i,
    /\bREINDEX\b/i,
    /\bTRIGGER\b/i,
    /\bCREATE\b/i
  ];
  if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
    return res.status(400).json({ error: "SQL contains blocked keywords for safety." });
  }

  const semicolonCount = (normalized.match(/;/g) || []).length;
  if (semicolonCount > 1 || (semicolonCount === 1 && !normalized.endsWith(";"))) {
    return res.status(400).json({ error: "Only a single SQL statement is allowed." });
  }

  const cleanSql = normalized.endsWith(";") ? normalized.slice(0, -1).trim() : normalized;
  try {
    const stmt = db.prepare(cleanSql);
    if (firstWord === "SELECT" || firstWord === "WITH") {
      const rows = stmt.all();
      return res.json({
        mode: "query",
        rowCount: rows.length,
        rows
      });
    }
    if (req.adminSession?.role !== "full") {
      return res.status(403).json({ error: "DBmanagerUser is query-only and cannot alter records." });
    }
    const result = stmt.run();
    return res.json({
      mode: "dml",
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid || 0)
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "SQL execution failed." });
  }
});

app.patch("/api/admin/row/:tableName/:id", requireAdminWriteApi, (req, res) => {
  const allowed = new Set(["coaches", "teams", "players", "equipment_items", "donations"]);
  const tableName = String(req.params.tableName || "");
  if (!allowed.has(tableName)) return res.status(400).json({ error: "Invalid table name." });

  const rowId = String(req.params.id || "");
  const updates = req.body?.updates;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Updates payload is required." });
  }

  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const editableColumns = new Set(
    tableInfo
      .map((col) => String(col.name))
      .filter((name) => !["id", "created_at"].includes(name))
  );
  const entries = Object.entries(updates).filter(([key]) => editableColumns.has(key));
  if (!entries.length) return res.status(400).json({ error: "No editable fields provided." });

  const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  const tx = db.transaction(() => {
    const result = db
      .prepare(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`)
      .run(...values, rowId);
    if (!result.changes) return result;

    if (tableName === "teams" && Object.prototype.hasOwnProperty.call(updates, "name")) {
      const team = db.prepare("SELECT id, coach_id, name FROM teams WHERE id=?").get(rowId);
      if (team) {
        db.prepare("UPDATE coaches SET team_name=? WHERE id=?").run(team.name, team.coach_id);
        db.prepare("UPDATE players SET team_name=? WHERE team_id=?").run(team.name, team.id);
      }
    }
    return result;
  });

  const result = tx();
  if (!result.changes) return res.status(404).json({ error: "Row not found." });
  return res.json({ ok: true, changes: result.changes });
});

app.delete("/api/admin/row/:tableName/:id", requireAdminWriteApi, (req, res) => {
  const allowed = new Set(["coaches", "teams", "players", "equipment_items", "donations"]);
  const tableName = String(req.params.tableName || "");
  if (!allowed.has(tableName)) return res.status(400).json({ error: "Invalid table name." });
  const rowId = String(req.params.id || "");
  const result = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(rowId);
  if (!result.changes) return res.status(404).json({ error: "Row not found." });
  return res.json({ ok: true, changes: result.changes });
});

app.get("/admin-login", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.get("/admin-db", requireAdminPage, (_req, res) => {
  res.sendFile(path.join(__dirname, "admin-db.html"));
});

app.get("/admin-db.html", requireAdminPage, (_req, res) => {
  res.sendFile(path.join(__dirname, "admin-db.html"));
});

function runDatabaseBackup(reason) {
  try {
    const backupPaths = writeLatestBackupSnapshot();
    console.log(
      `Database backup written (${reason}) -> json: ${backupPaths.jsonPath}, excel: ${backupPaths.excelPath}`
    );
  } catch (error) {
    console.error(`Database backup failed (${reason}):`, error?.message || error);
  }
}

function pathExists(targetPath) {
  try {
    return Boolean(targetPath) && fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Gridiron Give server running on http://localhost:${PORT}`);
  runDatabaseBackup("startup");
});

setInterval(() => {
  runDatabaseBackup("daily");
}, 24 * 60 * 60 * 1000);
