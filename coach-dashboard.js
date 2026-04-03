const api = window.GridironData;
const session = api.getSession();
if (!session || session.role !== "coach") window.location.href = "/index.html";

const teamForm = document.getElementById("team-form");
const teamLogoUpload = document.getElementById("team-logo-upload");
const clearTeamLogoButton = document.getElementById("clear-team-logo");
const teamLogoPreview = document.getElementById("team-logo-preview");
const teamLogoImage = document.getElementById("team-logo-image");
const teamLocationDisplay = document.getElementById("team-location-display");
const teamSportDisplay = document.getElementById("team-sport-display");
const teamLocationEditor = document.getElementById("team-location-editor");
const teamSportEditor = document.getElementById("team-sport-editor");
const editTeamLocationButton = document.getElementById("edit-team-location");
const editTeamSportButton = document.getElementById("edit-team-sport");
const teamLocationOutsideUs = document.getElementById("team-location-outside-us");
const teamLocationState = document.getElementById("team-location-state");
const manualPlayerForm = document.getElementById("manual-player-form");
const rosterBody = document.getElementById("roster-body");
const processCsvButton = document.getElementById("process-csv");
const csvUploadInput = document.getElementById("csv-upload");
const csvPreviewSection = document.getElementById("csv-preview-section");
const csvPreviewBody = document.getElementById("csv-preview-body");
const csvAddRowButton = document.getElementById("csv-add-row");
const csvConfirmSaveButton = document.getElementById("csv-confirm-save");
const csvProcessingBackdrop = document.getElementById("csv-processing-backdrop");
const logoutButton = document.getElementById("coach-logout");
const previewCard = document.getElementById("player-preview-card");
const previewContent = document.getElementById("player-preview-content");
const coachSetupPayoutsButton = document.getElementById("coach-setup-payouts");
const coachStripeDashboardButton = document.getElementById("coach-open-stripe-dashboard");
const coachPayoutActions = document.getElementById("coach-payout-actions");
const coachPayoutCopy = document.getElementById("coach-payout-copy");
const recipientModeGroup = document.getElementById("recipient-mode-group");
const coachModalBackdrop = document.getElementById("coach-modal-backdrop");
const coachStripeSetupModal = document.getElementById("coach-stripe-setup-modal");
const coachStripeSetupScroll = document.getElementById("coach-stripe-setup-scroll");
const continueCoachStripeSetupButton = document.getElementById("continue-coach-stripe-setup");
const coachModalCloseButtons = [...document.querySelectorAll("[data-coach-modal-close]")];
const sharedEquipmentCard = document.getElementById("shared-equipment-card");
const sharedEquipmentList = document.getElementById("shared-equipment-list");
const sharedEquipmentAddButton = document.getElementById("shared-equipment-add");
const sharedEquipmentSaveButton = document.getElementById("shared-equipment-save");
const transactionsBody = document.getElementById("coach-transactions-body");
const coachTabButtons = [...document.querySelectorAll("[data-coach-tab]")];
const coachRosterPanel = document.getElementById("coach-tab-panel-roster");
const coachDonationsPanel = document.getElementById("coach-tab-panel-donations");
const donationSummaryCredited = document.getElementById("donation-summary-credited");
const donationSummaryCheckout = document.getElementById("donation-summary-checkout");
const donationSummaryCount = document.getElementById("donation-summary-count");
const donationSummaryAverage = document.getElementById("donation-summary-average");
const donationSearchInput = document.getElementById("coach-donation-search");
const donationPlayerFilter = document.getElementById("coach-donation-player-filter");

let state = {
  mode: "local",
  coach: null,
  team: null,
  players: [],
  teamEquipment: [],
  transactions: []
};
let csvPreviewRows = [];
let pendingTeamLogoDataUrl = "";
let activeCoachTab = "roster";
let locationEditEnabled = false;
let sportEditEnabled = false;

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    cache: "no-store",
    headers,
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

function setFeedback(id, message, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", Boolean(isError));
}

function showAction(message, isError = false) {
  if (typeof window.showActionMessage === "function") {
    window.showActionMessage(message, { isError });
  }
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function prettySportLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseTeamLocation(value) {
  const raw = String(value || "").trim();
  if (!raw) return { city: "", state: "", outsideUs: false };
  if (raw.endsWith("(International)")) {
    return {
      city: raw.replace(/\s*\(International\)$/u, "").trim(),
      state: "",
      outsideUs: true
    };
  }
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts.slice(0, -1).join(", "),
      state: parts.at(-1)?.toUpperCase() || "",
      outsideUs: false
    };
  }
  return { city: raw, state: "", outsideUs: false };
}

function composeTeamLocationFromEditor() {
  const city = String(teamForm?.teamLocationCity?.value || "").trim();
  const state = String(teamForm?.teamLocationState?.value || "").trim().toUpperCase();
  const outsideUs = Boolean(teamLocationOutsideUs?.checked);
  if (!city) throw new Error("Please enter your team city.");
  if (outsideUs) return `${city} (International)`;
  if (!state) throw new Error("Please choose your team state.");
  return `${city}, ${state}`;
}

function syncLocationEditorState() {
  if (!teamLocationState || !teamLocationOutsideUs) return;
  const outsideUs = teamLocationOutsideUs.checked;
  teamLocationState.disabled = outsideUs;
  teamLocationState.required = !outsideUs && locationEditEnabled;
  if (outsideUs) teamLocationState.value = "";
}

function renderTeamDetailEditors() {
  if (teamLocationEditor) teamLocationEditor.hidden = !locationEditEnabled;
  if (teamSportEditor) teamSportEditor.hidden = !sportEditEnabled;
  editTeamLocationButton?.classList.toggle("is-active", locationEditEnabled);
  editTeamSportButton?.classList.toggle("is-active", sportEditEnabled);
  syncLocationEditorState();
}

function openCoachModal() {
  if (!coachModalBackdrop || !coachStripeSetupModal) return;
  coachModalBackdrop.hidden = false;
  coachStripeSetupModal.hidden = false;
}

function closeCoachModal() {
  if (!coachModalBackdrop || !coachStripeSetupModal) return;
  coachModalBackdrop.hidden = true;
  coachStripeSetupModal.hidden = true;
}

function evaluateCoachStripeSetupGate() {
  if (!coachStripeSetupScroll || !continueCoachStripeSetupButton) return;
  if (coachStripeSetupScroll.scrollHeight <= coachStripeSetupScroll.clientHeight + 8) {
    continueCoachStripeSetupButton.disabled = false;
    return;
  }
  const threshold = coachStripeSetupScroll.scrollHeight - coachStripeSetupScroll.clientHeight - 8;
  continueCoachStripeSetupButton.disabled = coachStripeSetupScroll.scrollTop < Math.max(0, threshold);
}

function resetCoachStripeSetupGate() {
  if (coachStripeSetupScroll) coachStripeSetupScroll.scrollTop = 0;
  if (continueCoachStripeSetupButton) continueCoachStripeSetupButton.disabled = false;
  evaluateCoachStripeSetupGate();
}

function showCsvProcessing() {
  if (csvProcessingBackdrop) csvProcessingBackdrop.hidden = false;
}

function hideCsvProcessing() {
  if (csvProcessingBackdrop) csvProcessingBackdrop.hidden = true;
}

function percentRaised(player) {
  const goal = Number(player.goalTotal || player.goal_total || 0);
  const raised = Number(player.raisedTotal || player.raised_total || 0);
  if (!goal) return 0;
  return Math.min(100, Math.round((raised / goal) * 100));
}

function updateTeamForm() {
  if (!teamForm || !state.team) return;
  teamForm.teamName.value = state.team.name || "";
  if (teamLocationDisplay) teamLocationDisplay.textContent = state.team.location || "Not set";
  if (teamSportDisplay) teamSportDisplay.textContent = prettySportLabel(state.team.sport) || "Not set";
  const parsedLocation = parseTeamLocation(state.team.location);
  if (teamForm.teamLocationCity) teamForm.teamLocationCity.value = parsedLocation.city;
  if (teamForm.teamLocationState) teamForm.teamLocationState.value = parsedLocation.state;
  if (teamLocationOutsideUs) teamLocationOutsideUs.checked = parsedLocation.outsideUs;
  if (teamForm.teamSport) teamForm.teamSport.value = state.team.sport || "";
  locationEditEnabled = false;
  sportEditEnabled = false;
  renderTeamDetailEditors();
  pendingTeamLogoDataUrl = String(state.team.logo_data_url || "");
  renderTeamLogoPreview();
  const recipientMode = String(state.team.recipient_mode || state.team.recipientMode || "coach");
  const recipientInputs = [...teamForm.querySelectorAll('input[name="recipientMode"]')];
  recipientInputs.forEach((input) => {
    const matches = input.value === recipientMode;
    input.checked = matches;
    input.disabled = true;
    const label = input.closest(".choice-card");
    if (label) label.hidden = !matches;
  });
  if (recipientModeGroup) {
    recipientModeGroup.dataset.lockedMode = recipientMode;
  }
}

function renderTeamLogoPreview() {
  if (!teamLogoPreview || !teamLogoImage) return;
  const hasLogo = Boolean(pendingTeamLogoDataUrl);
  teamLogoPreview.hidden = !hasLogo;
  if (hasLogo) {
    teamLogoImage.src = pendingTeamLogoDataUrl;
  } else {
    teamLogoImage.removeAttribute("src");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read team logo."));
    reader.readAsDataURL(file);
  });
}

function isCoachRecipientMode() {
  return String(state.team?.recipient_mode || state.team?.recipientMode || "coach") === "coach";
}

function renderCoachPayoutSection() {
  if (!coachPayoutActions || !coachPayoutCopy) return;
  const show = state.mode === "backend" && isCoachRecipientMode();
  coachPayoutActions.hidden = !show;
  coachPayoutCopy.hidden = !show;
  if (!show) return;
  const connected = Boolean(state.coach?.stripe_account_id);
  const complete = Number(state.coach?.stripe_onboarding_complete || 0) === 1;
  coachSetupPayoutsButton.textContent = complete ? "Team Stripe Connected" : "Connect Team Stripe";
  coachStripeDashboardButton.hidden = !connected;
  coachPayoutCopy.textContent = complete
    ? "Team Stripe setup is complete. Donations for players on this team route to the connected coach account."
    : "Connect Stripe for the team so donor payments can route to the coach on behalf of selected players.";
}

function filteredTransactions() {
  const rows = Array.isArray(state.transactions) ? state.transactions : [];
  const search = String(donationSearchInput?.value || "").trim().toLowerCase();
  const playerFilter = String(donationPlayerFilter?.value || "").trim();
  return rows.filter((row) => {
    const playerName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    if (playerFilter && playerName !== playerFilter) return false;
    if (!search) return true;
    const haystack = [
      row.donor_name,
      row.donor_email,
      playerName,
      row.equipment_name
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function populateDonationPlayerFilter() {
  if (!donationPlayerFilter) return;
  const currentValue = donationPlayerFilter.value;
  const names = Array.from(
    new Set(
      (Array.isArray(state.transactions) ? state.transactions : [])
        .map((row) => `${row.first_name || ""} ${row.last_name || ""}`.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  donationPlayerFilter.innerHTML = '<option value="">All players</option>';
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    donationPlayerFilter.appendChild(option);
  });
  donationPlayerFilter.value = names.includes(currentValue) ? currentValue : "";
}

function renderTransactionSummary(rows) {
  if (!donationSummaryCredited || !donationSummaryCheckout || !donationSummaryCount || !donationSummaryAverage) {
    return;
  }
  const totalCredited = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalCheckout = rows.reduce((sum, row) => sum + Number(row.checkout_total_amount || 0), 0);
  const count = rows.length;
  donationSummaryCredited.textContent = money(totalCredited);
  donationSummaryCheckout.textContent = money(totalCheckout);
  donationSummaryCount.textContent = String(count);
  donationSummaryAverage.textContent = money(count ? totalCheckout / count : 0);
}

function renderTransactions() {
  if (!transactionsBody) return;
  const show = isCoachRecipientMode();
  if (coachDonationsPanel) coachDonationsPanel.hidden = !show || activeCoachTab !== "donations";
  if (!show) return;
  populateDonationPlayerFilter();
  const rows = filteredTransactions();
  renderTransactionSummary(rows);
  transactionsBody.innerHTML = "";
  if (!rows.length) {
    transactionsBody.innerHTML = '<tr><td colspan="7" class="subtle-copy">No team transactions match this view yet.</td></tr>';
    return;
  }
  rows.forEach((row) => {
    const donorDisplay =
      Number(row.anonymous) === 1
        ? `${row.donor_name || "Anonymous"} (Anonymous)`
        : `${row.donor_name || "Donor"}${row.donor_email ? `<br /><span class="subtle-copy">${row.donor_email}</span>` : ""}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${String(row.created_at || "").slice(0, 10) || "-"}</td>
      <td>${donorDisplay}</td>
      <td>${row.first_name || ""} ${row.last_name || ""}</td>
      <td>${row.equipment_name || "General Donation"}</td>
      <td>$${Number(row.amount || 0).toFixed(2)}</td>
      <td>$${Number(row.checkout_total_amount || 0).toFixed(2)}</td>
      <td>$${Number(row.application_fee_amount || 0).toFixed(2)}</td>
    `;
    transactionsBody.appendChild(tr);
  });
}

function setCoachTab(nextTab) {
  activeCoachTab = nextTab === "donations" ? "donations" : "roster";
  coachTabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.coachTab === activeCoachTab);
  });
  if (coachRosterPanel) coachRosterPanel.hidden = activeCoachTab !== "roster";
  if (coachDonationsPanel) coachDonationsPanel.hidden = activeCoachTab !== "donations" || !isCoachRecipientMode();
  if (activeCoachTab === "donations") renderTransactions();
}

function renderSharedEquipment() {
  if (!sharedEquipmentCard || !sharedEquipmentList) return;
  const show = isCoachRecipientMode();
  sharedEquipmentCard.hidden = !show;
  if (!show) return;
  sharedEquipmentList.innerHTML = "";
  const rows = Array.isArray(state.teamEquipment) ? state.teamEquipment : [];
  if (!rows.length) {
    sharedEquipmentList.innerHTML = "<p class=\"subtle-copy\">No shared equipment pricing yet.</p>";
    return;
  }
  rows.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "equipment-row equipment-row-edit";
    row.dataset.equipmentIndex = String(index);
    row.innerHTML = `
      <div class="equipment-card-topline">
        <label class="toggle-label compact-toggle">
          <input type="checkbox" data-shared-field="enabled" data-index="${index}" ${
            Number(item.enabled) === 0 ? "" : "checked"
          } />
          Active for roster
        </label>
        <button class="btn btn-danger-ghost btn-small" type="button" data-remove-shared="${index}">Remove</button>
      </div>
      <div class="equipment-card-center">
        <label class="equipment-card-field">
          <span class="field-caption">Equipment</span>
          <input type="text" data-shared-field="name" data-index="${index}" value="${String(item.name || "").replace(/"/g, "&quot;")}" />
        </label>
        <p class="equipment-card-price" data-shared-price="${index}">$${Number(item.goal || 0).toFixed(0)}</p>
        <label class="equipment-card-field equipment-card-goal">
          <span class="field-caption">Set Goal</span>
          <div class="goal-input-wrap">
            <span>$</span>
            <input type="number" min="0" step="1" data-shared-field="goal" data-index="${index}" value="${Number(item.goal || 0)}" />
          </div>
        </label>
        <div class="equipment-card-meta">
          <span class="meta-pill">${item.category || "General"}</span>
          <span class="meta-pill meta-pill-muted">Typical price: ${item.price_range || item.priceRange || "Not set"}</span>
        </div>
      </div>
    `;
    sharedEquipmentList.appendChild(row);
  });
}

function updateSharedEquipmentPricePreview(index) {
  const priceEl = sharedEquipmentList?.querySelector(`[data-shared-price="${index}"]`);
  const goalInput = sharedEquipmentList?.querySelector(`input[data-shared-field="goal"][data-index="${index}"]`);
  if (!priceEl || !(goalInput instanceof HTMLInputElement)) return;
  priceEl.textContent = `$${Number(goalInput.value || 0).toFixed(0)}`;
}

function serializeSharedEquipmentFromDom() {
  const rows = [...(sharedEquipmentList?.querySelectorAll(".equipment-row-edit") || [])];
  return rows.map((row, index) => {
    const base = state.teamEquipment[index] || {};
    const nameInput = row.querySelector(`input[data-shared-field="name"][data-index="${index}"]`);
    const goalInput = row.querySelector(`input[data-shared-field="goal"][data-index="${index}"]`);
    const enabledInput = row.querySelector(`input[data-shared-field="enabled"][data-index="${index}"]`);
    return {
      id: base.id || "",
      name: nameInput instanceof HTMLInputElement ? nameInput.value : String(base.name || "Equipment"),
      category: String(base.category || "General"),
      price_range: String(base.price_range || base.priceRange || ""),
      goal: goalInput instanceof HTMLInputElement ? Number(goalInput.value || 0) : Number(base.goal || 0),
      enabled: enabledInput instanceof HTMLInputElement ? (enabledInput.checked ? 1 : 0) : Number(base.enabled) === 0 ? 0 : 1,
      sort_order: Number(base.sort_order ?? index)
    };
  });
}

async function refreshCoachStripeStatus() {
  if (state.mode !== "backend" || !state.coach?.stripe_account_id) return;
  try {
    const status = await apiRequest("/api/stripe/coach-status", {
      method: "POST",
      body: JSON.stringify({ coachId: state.coach.id })
    });
    state.coach.stripe_account_id = String(status.stripe_account_id || state.coach.stripe_account_id || "");
    state.coach.stripe_onboarding_complete = Boolean(status.onboarding_complete) ? 1 : 0;
    renderCoachPayoutSection();
  } catch {}
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const rows = lines.map((line) => line.split(",").map((entry) => entry.trim()));
  const firstRow = rows[0] || [];
  const normalizedHeader = firstRow.map((entry) => entry.toLowerCase().replace(/[^a-z]/g, ""));
  const looksLikeHeader = normalizedHeader.some((entry) =>
    ["firstname", "first", "lastname", "last", "email", "emailaddress"].includes(entry)
  );

  const findIndex = (candidates) => normalizedHeader.findIndex((entry) => candidates.includes(entry));
  const firstIndex = findIndex(["firstname", "first", "fname", "givenname"]);
  const lastIndex = findIndex(["lastname", "last", "lname", "surname", "familyname"]);
  const emailIndex = findIndex(["email", "emailaddress", "mail"]);

  const startIndex = looksLikeHeader ? 1 : 0;
  return rows.slice(startIndex).map((cells) => ({
    firstName: cells[firstIndex >= 0 ? firstIndex : 0] || "",
    lastName: cells[lastIndex >= 0 ? lastIndex : 1] || "",
    email: cells[emailIndex >= 0 ? emailIndex : 2] || ""
  }));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function validateCsvPreviewRows(rows) {
  const errors = [];
  rows.forEach((row, idx) => {
    const line = idx + 1;
    const first = String(row.firstName || "").trim();
    const last = String(row.lastName || "").trim();
    const email = String(row.email || "").trim();
    if (!first) errors.push(`Row ${line}: First Name is required.`);
    if (!last) errors.push(`Row ${line}: Last Name is required.`);
    if (!email) errors.push(`Row ${line}: Email is required.`);
    else if (!isValidEmail(email)) errors.push(`Row ${line}: Email format is invalid.`);
  });
  return errors;
}

function renderCsvPreview() {
  if (!csvPreviewSection || !csvPreviewBody) return;
  csvPreviewBody.innerHTML = "";
  if (!csvPreviewRows.length) {
    csvPreviewSection.hidden = true;
    return;
  }
  csvPreviewSection.hidden = false;
  csvPreviewRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" data-preview-field="firstName" data-preview-index="${index}" value="${String(
        row.firstName || ""
      ).replace(/"/g, "&quot;")}" /></td>
      <td><input type="text" data-preview-field="lastName" data-preview-index="${index}" value="${String(
        row.lastName || ""
      ).replace(/"/g, "&quot;")}" /></td>
      <td><input type="email" data-preview-field="email" data-preview-index="${index}" value="${String(
        row.email || ""
      ).replace(/"/g, "&quot;")}" /></td>
      <td><button class="btn btn-danger-ghost btn-small" type="button" data-preview-remove="${index}">Delete</button></td>
    `;
    csvPreviewBody.appendChild(tr);
  });
}

function renderPreviewLocal(playerId) {
  const player = api.getPlayerByInternalId(playerId);
  if (!player || !previewCard || !previewContent || !state.team) return;
  const fullName = `${player.firstName} ${player.lastName}`.trim();
  const goal = Number(player.goalTotal || 0);
  const raised = Number(player.raisedTotal || 0);
  const pct = percentRaised(player);
  const visibleEquipment = (player.equipment || []).filter((item) => item.enabled !== false);
  const equipmentRows = visibleEquipment
    .map(
      (item) =>
        `<li><strong>${item.name}</strong> (${item.category || "General"}) - $${Number(
          item.raised || 0
        ).toFixed(2)} raised of $${Number(item.goal || 0).toFixed(2)}</li>`
    )
    .join("");

  previewContent.innerHTML = `
    <div class="preview-grid">
      <div>
        <p class="preview-name">${fullName}</p>
        <p class="subtle-copy">${state.team.name}</p>
      </div>
      <div>
        <p><strong>$${raised.toFixed(2)}</strong> raised of <strong>$${goal.toFixed(2)}</strong> (${pct}%)</p>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
    <ul class="preview-list">${equipmentRows || "<li>No enabled gear configured yet.</li>"}</ul>
  `;
  previewCard.hidden = false;
}

async function renderPreviewBackend(playerId) {
  if (!previewCard || !previewContent || !state.team) return;
  try {
    const data = await apiRequest(`/api/players/${encodeURIComponent(playerId)}/dashboard`);
    const player = data.player;
    const visibleEquipment = (player.equipment || []).filter((item) => Number(item.enabled) === 1);
    const goal = Number(player.goalTotal || 0);
    const raised = Number(player.raisedTotal || 0);
    const pct = goal > 0 ? Math.round((raised / goal) * 100) : 0;
    const equipmentRows = visibleEquipment
      .map(
        (item) =>
          `<li><strong>${item.name}</strong> (${item.category || "General"}) - $${Number(
            item.raised || 0
          ).toFixed(2)} raised of $${Number(item.goal || 0).toFixed(2)}</li>`
      )
      .join("");

    previewContent.innerHTML = `
      <div class="preview-grid">
        <div>
          <p class="preview-name">${player.first_name} ${player.last_name}</p>
          <p class="subtle-copy">${state.team.name}</p>
        </div>
        <div>
          <p><strong>$${raised.toFixed(2)}</strong> raised of <strong>$${goal.toFixed(2)}</strong> (${pct}%)</p>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <ul class="preview-list">${equipmentRows || "<li>No enabled gear configured yet.</li>"}</ul>
    `;
    previewCard.hidden = false;
  } catch {
    setFeedback("team-feedback", "Unable to load player preview from backend.", true);
  }
}

function renderRoster() {
  if (!rosterBody) return;
  const players = state.players || [];
  rosterBody.innerHTML = "";
  if (!players.length) {
    rosterBody.innerHTML = '<tr><td colspan="7" class="subtle-copy">No players yet. Add one above.</td></tr>';
    return;
  }

  players.forEach((player) => {
    const isBackend = state.mode === "backend";
    const id = isBackend ? player.id : player.id;
    const firstName = isBackend ? player.first_name : player.firstName;
    const lastName = isBackend ? player.last_name : player.lastName;
    const email = isBackend ? player.email : player.email;
    const publicId = isBackend ? player.player_public_id : player.playerId;
    const registered = isBackend ? Number(player.registered) === 1 : Boolean(player.registered);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="table-name-link" type="button" data-preview="${id}">${firstName}</button></td>
      <td><button class="table-name-link" type="button" data-preview="${id}">${lastName}</button></td>
      <td>${email}</td>
      <td>${publicId}</td>
      <td><span class="${registered ? "status-yes" : "status-no"}">${registered ? "✓" : "✕"}</span></td>
      <td>${percentRaised(player)}%</td>
      <td class="action-row">
        <button class="btn btn-ghost btn-small" data-preview="${id}">View</button>
        <button class="btn btn-danger-ghost btn-small" data-remove="${id}">Remove</button>
      </td>
    `;
    rosterBody.appendChild(tr);
  });
}

async function loadBackendDashboard() {
  if (!session.backendId) throw new Error("No backend coach session");
  const data = await apiRequest(`/api/coaches/${encodeURIComponent(session.backendId)}/dashboard`);
  state = {
    mode: "backend",
    coach: data.coach,
    team: data.team,
    players: data.players || [],
    teamEquipment: data.teamEquipment || [],
    transactions: data.transactions || []
  };
}

function loadLocalDashboard() {
  const bundle = api.getCoachWithTeam(session.id);
  if (!bundle || !bundle.team) throw new Error("Local coach data not found.");
  state = {
    mode: "local",
    coach: bundle.coach,
    team: bundle.team,
    players: api.playersForTeam(bundle.team.id),
    teamEquipment: [],
    transactions: []
  };
}

async function loadDashboard() {
  if (session.backendId) {
    try {
      await loadBackendDashboard();
      return;
    } catch {
      // fallback below
    }
  }
  loadLocalDashboard();
}

teamForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  let nextLocation = state.team.location || "";
  let nextSport = String(state.team.sport || "").trim().toLowerCase();
  try {
    if (locationEditEnabled) nextLocation = composeTeamLocationFromEditor();
    if (sportEditEnabled) {
      nextSport = String(teamForm.teamSport.value || "").trim().toLowerCase();
      if (!nextSport) throw new Error("Please select your team sport.");
    }
  } catch (error) {
    setFeedback("team-feedback", error.message || "Please review your team details.", true);
    showAction(error.message || "Please review your team details.", true);
    return;
  }
  try {
    if (state.mode === "backend") {
      await apiRequest(`/api/teams/${encodeURIComponent(state.team.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: teamForm.teamName.value,
          location: nextLocation,
          sport: nextSport,
          imageDataUrl: pendingTeamLogoDataUrl
        })
      });
      await loadBackendDashboard();
    } else {
      api.updateTeam(state.team.id, {
        name: teamForm.teamName.value,
        location: nextLocation,
        sport: nextSport
      });
      loadLocalDashboard();
    }
    setFeedback("team-feedback", "Team profile saved.");
    showAction("Team profile saved.");
    updateTeamForm();
    renderRoster();
    renderCoachPayoutSection();
    renderSharedEquipment();
    renderTransactions();
    setCoachTab(activeCoachTab);
  } catch (error) {
    setFeedback("team-feedback", error.message || "Could not save team profile.", true);
    showAction(error.message || "Could not save team profile.", true);
  }
});

teamLogoUpload?.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) {
      throw new Error("Team logo must be under 5 MB.");
    }
    pendingTeamLogoDataUrl = await readFileAsDataUrl(file);
    renderTeamLogoPreview();
    setFeedback("team-feedback", "Team logo ready to save with your profile.");
  } catch (error) {
    target.value = "";
    setFeedback("team-feedback", error.message || "Could not load team logo.", true);
    showAction(error.message || "Could not load team logo.", true);
  }
});

clearTeamLogoButton?.addEventListener("click", () => {
  pendingTeamLogoDataUrl = "";
  if (teamLogoUpload) teamLogoUpload.value = "";
  renderTeamLogoPreview();
  setFeedback("team-feedback", "Team logo removed. Save team profile to publish the change.");
});

coachTabButtons.forEach((button) => {
  button.addEventListener("click", () => setCoachTab(button.dataset.coachTab || "roster"));
});

donationSearchInput?.addEventListener("input", renderTransactions);
donationPlayerFilter?.addEventListener("change", renderTransactions);
editTeamLocationButton?.addEventListener("click", () => {
  locationEditEnabled = !locationEditEnabled;
  renderTeamDetailEditors();
});
editTeamSportButton?.addEventListener("click", () => {
  sportEditEnabled = !sportEditEnabled;
  renderTeamDetailEditors();
});
teamLocationOutsideUs?.addEventListener("change", syncLocationEditorState);

manualPlayerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (state.mode === "backend") {
      const result = await apiRequest("/api/players/upsert", {
        method: "POST",
        body: JSON.stringify({
          teamId: state.team.id,
          firstName: manualPlayerForm.firstName.value,
          lastName: manualPlayerForm.lastName.value,
          email: manualPlayerForm.email.value
        })
      });
      await loadBackendDashboard();
      if (result.created && result.inviteSent) {
        const message = `Player added. Invite email sent with PlayerID ${result.playerPublicId}.`;
        setFeedback("manual-feedback", message);
        showAction(message);
      } else if (result.created && !result.inviteSent) {
        const message = `Player added, but invite email failed. ${
          result.inviteError || "Check email configuration."
        } PlayerID: ${result.playerPublicId}`;
        setFeedback("manual-feedback", message, true);
        showAction(message, true);
      } else {
        const message = "Player already existed; roster entry updated.";
        setFeedback("manual-feedback", message);
        showAction(message);
      }
    } else {
      api.upsertPlayerByEmail({
        teamId: state.team.id,
        firstName: manualPlayerForm.firstName.value,
        lastName: manualPlayerForm.lastName.value,
        email: manualPlayerForm.email.value
      });
      loadLocalDashboard();
      const message = "Player added to roster.";
      setFeedback("manual-feedback", message);
      showAction(message);
    }
    manualPlayerForm.reset();
    renderRoster();
  } catch (error) {
    setFeedback("manual-feedback", error.message || "Could not add player.", true);
    showAction(error.message || "Could not add player.", true);
  }
});

processCsvButton?.addEventListener("click", async () => {
  const file = csvUploadInput?.files?.[0];
  if (!file) {
    setFeedback("csv-feedback", "Select a CSV file first.", true);
    showAction("Select a CSV file first.", true);
    return;
  }
  try {
    showCsvProcessing();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rows = parseCsv(await file.text()).map((row) => ({
      firstName: String(row.firstName || "").trim(),
      lastName: String(row.lastName || "").trim(),
      email: String(row.email || "").trim()
    }));
    const nonEmptyRows = rows.filter((row) => row.firstName || row.lastName || row.email);
    const errors = validateCsvPreviewRows(nonEmptyRows);
    csvPreviewRows = nonEmptyRows;
    renderCsvPreview();
    hideCsvProcessing();
    if (errors.length) {
      const message = `CSV has ${errors.length} issue(s). Please edit preview rows before saving.`;
      setFeedback("csv-feedback", message, true);
      showAction(`${message}\n${errors.slice(0, 5).join("\n")}`, true);
      return;
    }
    const message = `Roster preview ready with ${csvPreviewRows.length} row(s). Review and click Confirm & Save Roster.`;
    setFeedback("csv-feedback", message);
    showAction(message);
  } catch (error) {
    hideCsvProcessing();
    setFeedback("csv-feedback", error.message || "CSV processing failed.", true);
    showAction(error.message || "CSV processing failed.", true);
  }
});

csvPreviewBody?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const field = target.dataset.previewField;
  const index = Number(target.dataset.previewIndex);
  if (!field || Number.isNaN(index) || !csvPreviewRows[index]) return;
  csvPreviewRows[index][field] = target.value;
});

csvPreviewBody?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeIndex = target.dataset.previewRemove;
  if (removeIndex === undefined) return;
  csvPreviewRows.splice(Number(removeIndex), 1);
  renderCsvPreview();
});

csvAddRowButton?.addEventListener("click", () => {
  csvPreviewRows.push({ firstName: "", lastName: "", email: "" });
  renderCsvPreview();
});

csvConfirmSaveButton?.addEventListener("click", async () => {
  if (!csvPreviewRows.length) {
    showAction("No preview rows to save.", true);
    return;
  }
  const rows = csvPreviewRows.map((row) => ({
    firstName: String(row.firstName || "").trim(),
    lastName: String(row.lastName || "").trim(),
    email: String(row.email || "").trim().toLowerCase()
  }));
  const errors = validateCsvPreviewRows(rows);
  if (errors.length) {
    showAction(`Please fix CSV preview errors before saving.\n${errors.slice(0, 5).join("\n")}`, true);
    return;
  }
  try {
    showCsvProcessing();
    await new Promise((resolve) => setTimeout(resolve, 300));
    let count = 0;
    let createdCount = 0;
    let emailedCount = 0;
    let emailFailedCount = 0;
    for (const row of rows) {
      if (state.mode === "backend") {
        const result = await apiRequest("/api/players/upsert", {
          method: "POST",
          body: JSON.stringify({
            teamId: state.team.id,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email
          })
        });
        if (result.created) {
          createdCount += 1;
          if (result.inviteSent) emailedCount += 1;
          else emailFailedCount += 1;
        }
      } else {
        api.upsertPlayerByEmail({
          teamId: state.team.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email
        });
      }
      count += 1;
    }
    if (state.mode === "backend") {
      await loadBackendDashboard();
      const message = `Roster saved. Processed ${count}. New: ${createdCount}. Invite emails sent: ${emailedCount}. Failed: ${emailFailedCount}.`;
      setFeedback("csv-feedback", message, emailFailedCount > 0);
      showAction(message, emailFailedCount > 0);
    } else {
      loadLocalDashboard();
      const message = `Roster saved with ${count} player record(s).`;
      setFeedback("csv-feedback", message);
      showAction(message);
    }
    csvPreviewRows = [];
    renderCsvPreview();
    renderRoster();
  } catch (error) {
    setFeedback("csv-feedback", error.message || "Could not save roster.", true);
    showAction(error.message || "Could not save roster.", true);
  } finally {
    hideCsvProcessing();
  }
});

rosterBody?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeId = target.dataset.remove;
  const previewId = target.dataset.preview;

  if (removeId) {
    try {
      if (state.mode === "backend") {
        await apiRequest(`/api/players/${encodeURIComponent(removeId)}`, { method: "DELETE" });
        await loadBackendDashboard();
      } else {
        api.removePlayer(removeId);
        loadLocalDashboard();
      }
      renderRoster();
      showAction("Player removed from roster.");
    } catch (error) {
      setFeedback("team-feedback", error.message || "Could not remove player.", true);
      showAction(error.message || "Could not remove player.", true);
    }
    return;
  }
  if (previewId) {
    if (state.mode === "backend") await renderPreviewBackend(previewId);
    else renderPreviewLocal(previewId);
  }
});

sharedEquipmentList?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const field = target.dataset.sharedField;
  const index = Number(target.dataset.index);
  if (!field || Number.isNaN(index) || !state.teamEquipment[index]) return;
  if (field === "enabled") {
    state.teamEquipment[index].enabled = target.checked ? 1 : 0;
    return;
  }
  if (field === "goal") {
    state.teamEquipment[index].goal = Number(target.value || 0);
    updateSharedEquipmentPricePreview(index);
    return;
  }
  state.teamEquipment[index][field] = target.value;
});

sharedEquipmentList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeIndex = target.dataset.removeShared;
  if (removeIndex === undefined) return;
  state.teamEquipment.splice(Number(removeIndex), 1);
  renderSharedEquipment();
});

sharedEquipmentAddButton?.addEventListener("click", () => {
  state.teamEquipment.push({
    id: "",
    name: "New Team Item",
    category: "General",
    price_range: "",
    goal: 0,
    enabled: 1
  });
  renderSharedEquipment();
});

sharedEquipmentSaveButton?.addEventListener("click", async () => {
  if (state.mode !== "backend" || !state.team) return;
  try {
    state.teamEquipment = serializeSharedEquipmentFromDom();
    const result = await apiRequest(`/api/teams/${encodeURIComponent(state.team.id)}/shared-equipment`, {
      method: "PUT",
      body: JSON.stringify({ items: state.teamEquipment })
    });
    if (Array.isArray(result?.items)) {
      state.teamEquipment = result.items;
    }
    await loadBackendDashboard();
    renderSharedEquipment();
    renderRoster();
    renderTransactions();
    setCoachTab(activeCoachTab);
    setFeedback("shared-equipment-feedback", "Team pricing saved and synced across the roster.");
    showAction("Team pricing saved and synced across the roster.");
  } catch (error) {
    setFeedback("shared-equipment-feedback", error.message || "Could not save team pricing.", true);
    showAction(error.message || "Could not save team pricing.", true);
  }
});

coachSetupPayoutsButton?.addEventListener("click", async () => {
  if (state.mode !== "backend" || !state.coach) return;
  resetCoachStripeSetupGate();
  openCoachModal();
});

continueCoachStripeSetupButton?.addEventListener("click", async () => {
  if (state.mode !== "backend" || !state.coach) return;
  closeCoachModal();
  let newWindow = null;
  try {
    newWindow = window.open("", "_blank");
    if (newWindow) {
      newWindow.document.open();
      newWindow.document.write(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>Redirecting To Stripe</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                font-family: Nunito, Arial, sans-serif;
                background: #f4f8ff;
                color: #14213d;
              }
              .wrap {
                text-align: center;
              }
            </style>
          </head>
          <body>
            <div class="wrap">
              <h2>Redirecting to Stripe...</h2>
              <p>You can return to Gridiron Give after team setup is complete.</p>
            </div>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
    const response = await apiRequest("/onboard-coach", {
      method: "POST",
      body: JSON.stringify({ coachId: state.coach.id })
    });
    if (response?.mock) {
      try {
        if (newWindow && !newWindow.closed) newWindow.close();
      } catch {}
      await loadBackendDashboard();
      renderCoachPayoutSection();
      showAction(response.message || "Local Stripe mock enabled. Team payouts marked complete.");
      return;
    }
    if (!response?.url) {
      throw new Error("Stripe onboarding link was not returned.");
    }
    if (newWindow && !newWindow.closed) newWindow.location.replace(response.url);
    else window.open(response.url, "_blank");
    await loadBackendDashboard();
    renderCoachPayoutSection();
  } catch (error) {
    try {
      if (newWindow && !newWindow.closed) newWindow.close();
    } catch {}
    showAction(error.message || "Could not start coach Stripe setup.", true);
  }
});

coachModalCloseButtons.forEach((button) => {
  button.addEventListener("click", closeCoachModal);
});

coachModalBackdrop?.addEventListener("click", (event) => {
  if (event.target === coachModalBackdrop) closeCoachModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCoachModal();
});

coachStripeSetupScroll?.addEventListener("scroll", evaluateCoachStripeSetupGate);

coachStripeDashboardButton?.addEventListener("click", async () => {
  if (state.mode !== "backend" || !state.coach) return;
  try {
    const response = await apiRequest("/stripe/dashboard-link", {
      method: "POST",
      body: JSON.stringify({ role: "coach", coachId: state.coach.id })
    });
    if (response?.mock) {
      showAction(response.message || "Local Stripe mock enabled. No Stripe dashboard opens on localhost.");
      return;
    }
    window.open(response.url, "_blank", "noopener");
  } catch (error) {
    showAction(error.message || "Could not open Stripe dashboard.", true);
  }
});

window.addEventListener("focus", () => {
  refreshCoachStripeStatus();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshCoachStripeStatus();
});

logoutButton?.addEventListener("click", () => {
  api.clearSession();
  window.location.href = "/index.html";
});

(async () => {
  try {
    await loadDashboard();
    updateTeamForm();
    renderRoster();
    renderCoachPayoutSection();
    renderSharedEquipment();
    renderTransactions();
    setCoachTab("roster");
  } catch {
    window.location.href = "/index.html";
  }
})();
