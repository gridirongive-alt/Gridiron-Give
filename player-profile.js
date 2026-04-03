const api = window.GridironData;
api.bootstrapDemoData();

const params = new URLSearchParams(window.location.search);
const publicPlayerId = params.get("playerId");
const checkoutStatus = params.get("checkout");

const donorNameHeading = document.getElementById("donor-name-heading");
const donorTeamCopy = document.getElementById("donor-team-copy");
const donorTeamLink = document.getElementById("donor-team-link");
const donorTeamLogoWrap = document.getElementById("donor-team-logo-wrap");
const donorTeamLogo = document.getElementById("donor-team-logo");
const donorStats = document.getElementById("donor-stats");
const playerImage = document.getElementById("donor-player-image");
const playerPlaceholder = document.getElementById("donor-player-placeholder");
const playerInitials = document.getElementById("donor-player-initials");
const playerTeam = document.getElementById("donor-player-team");
const equipmentGrid = document.getElementById("donor-equipment-grid");
const generalDonationCard = document.getElementById("general-donation-card");
const donationForm = document.getElementById("donation-form");
const donationHelp = document.getElementById("donation-help");
const donationFeedback = document.getElementById("donation-feedback");
const selectedEquipmentCopy = document.getElementById("selected-equipment-copy");
const fillRemainingButton = document.getElementById("fill-remaining");
const jumpToDonateButton = document.getElementById("jump-to-donate");
const topGeneralDonateButton = document.getElementById("top-general-donate");
const coverFeesCheckbox = document.getElementById("cover-fees-checkbox");
const coverFeesCopy = document.getElementById("cover-fees-copy");
const confirmDonationButton = document.getElementById("confirm-donation-button");
const donatePanel = document.getElementById("donate-panel");
const donorModalBackdrop = document.getElementById("donor-modal-backdrop");
const donationModal = document.getElementById("donation-modal");
const donorModalCloseButtons = [...document.querySelectorAll("[data-donor-modal-close]")];

let mode = "local";
let state = {
  player: null,
  team: null,
};
let selectedDonationMode = "equipment";
let selectedIndex = null;
let stripeConfig = null;

function showAction(message, isError = false) {
  if (typeof window.showActionMessage === "function") {
    window.showActionMessage(message, { isError });
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

function openDonationModal() {
  if (!donorModalBackdrop || !donationModal) return;
  donorModalBackdrop.hidden = false;
  donationModal.hidden = false;
}

function closeDonationModal() {
  if (!donorModalBackdrop || !donationModal) return;
  donorModalBackdrop.hidden = true;
  donationModal.hidden = true;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function percent(raised, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((Number(raised || 0) / Number(goal || 0)) * 100));
}

function normalizeBackendPlayer(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name || "",
    teamLogoDataUrl: row.team_logo_data_url || "",
    firstName: row.first_name,
    lastName: row.last_name,
    imageDataUrl: row.image_data_url || "",
    stripeAccountId: String(row.stripe_account_id || ""),
    goalTotal: Number(row.goalTotal || 0),
    raisedTotal: Number(row.raisedTotal || 0),
    equipment: (row.equipment || []).map((item) => ({
      id: item.id,
      name: String(item.name || "Equipment"),
      category: String(item.category || "General"),
      goal: Number(item.goal || 0),
      raised: Number(item.raised || 0),
      enabled: Number(item.enabled) === 1 || item.enabled === true,
    })),
  };
}

async function loadPlayer() {
  if (!publicPlayerId) throw new Error("Missing player id.");
  try {
    const data = await apiRequest(`/api/public/players/${encodeURIComponent(publicPlayerId)}`);
    mode = "backend";
    state.player = normalizeBackendPlayer(data.player);
    state.team = {
      id: data.player.team_id,
      name: data.player.team_name || "",
      logoDataUrl: data.player.team_logo_data_url || ""
    };
    return;
  } catch {}

  const localPlayer = api.getPlayerByPublicPlayerId(publicPlayerId);
  if (!localPlayer) throw new Error("Player not found.");
  mode = "local";
  state.player = localPlayer;
  state.team = api.getTeamById(localPlayer.teamId);
}

function currentPlayer() {
  if (mode === "local") {
    return api.getPlayerByInternalId(state.player?.id);
  }
  return state.player;
}

function renderTop() {
  const current = currentPlayer();
  if (!current || !donorStats) return;
  const pct = percent(current.raisedTotal, current.goalTotal);
  if (donorNameHeading) donorNameHeading.textContent = `${current.firstName} ${current.lastName}`;
  if (donorTeamCopy) donorTeamCopy.textContent = state.team?.name || "Team";
  if (donorTeamLink) {
    donorTeamLink.href = state.team?.id ? `/team-profile.html?teamId=${encodeURIComponent(state.team.id)}` : "/index.html";
  }
  if (donorTeamLogoWrap && donorTeamLogo) {
    const logoDataUrl = String(state.team?.logoDataUrl || current.teamLogoDataUrl || "");
    donorTeamLogoWrap.hidden = !logoDataUrl;
    if (logoDataUrl) donorTeamLogo.src = logoDataUrl;
    else donorTeamLogo.removeAttribute("src");
  }
  donorStats.innerHTML = `
    <div class="stat-pill"><span>${money(current.raisedTotal)}</span><small>Raised</small></div>
    <div class="stat-pill"><span>${money(current.goalTotal)}</span><small>Goal</small></div>
    <div class="stat-pill"><span>${pct}%</span><small>Progress</small></div>
  `;
}

function renderProfileInfo() {
  const current = currentPlayer();
  if (!current) return;
  playerTeam.textContent = state.team?.name || "";
  if (playerInitials) {
    playerInitials.textContent = `${String(current.firstName || "").slice(0, 1)}${String(current.lastName || "").slice(0, 1)}`.toUpperCase() || "GG";
  }
  if (current.imageDataUrl) {
    playerImage.src = current.imageDataUrl;
    playerImage.hidden = false;
    if (playerPlaceholder) playerPlaceholder.hidden = true;
  } else {
    playerImage.hidden = true;
    if (playerPlaceholder) playerPlaceholder.hidden = false;
  }
}

function visibleEquipment(current) {
  return (current.equipment || [])
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item.enabled !== false);
}

function totalRemaining(current) {
  return visibleEquipment(current).reduce(
    (sum, item) => sum + Math.max(0, Number(item.goal || 0) - Number(item.raised || 0)),
    0
  );
}

function centsToDollars(cents) {
  return Number(cents || 0) / 100;
}

function dollarsToCents(dollars) {
  return Math.round(Number(dollars || 0) * 100);
}

function estimateStripeFeeCents(totalCents) {
  const safeTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.round(safeTotal * 0.029) + 30;
}

function minimumPlatformFeeCents(totalCents) {
  const safeTotal = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.max(Math.round(safeTotal * 0.05), estimateStripeFeeCents(safeTotal));
}

function computeCheckoutAmounts(dollars, coverFees) {
  const baseCents = dollarsToCents(dollars);
  if (!baseCents) {
    return {
      athleteAmountCents: 0,
      checkoutTotalCents: 0,
      stripeFeeCents: 0,
      applicationFeeCents: 0,
      coverFees: Boolean(coverFees),
    };
  }
  if (!coverFees) {
    const stripeFeeCents = estimateStripeFeeCents(baseCents);
    const applicationFeeCents = minimumPlatformFeeCents(baseCents);
    return {
      athleteAmountCents: Math.max(0, baseCents - stripeFeeCents - applicationFeeCents),
      checkoutTotalCents: baseCents,
      stripeFeeCents,
      applicationFeeCents,
      coverFees: false,
    };
  }
  let checkoutTotalCents = baseCents;
  for (let attempts = 0; attempts < 20000; attempts += 1) {
    const stripeFeeCents = estimateStripeFeeCents(checkoutTotalCents);
    const minimumPlatformFee = minimumPlatformFeeCents(checkoutTotalCents);
    if (checkoutTotalCents - stripeFeeCents - minimumPlatformFee >= baseCents) {
      return {
        athleteAmountCents: baseCents,
        checkoutTotalCents,
        stripeFeeCents,
        applicationFeeCents: checkoutTotalCents - baseCents - stripeFeeCents,
        coverFees: true,
      };
    }
    checkoutTotalCents += 1;
  }
  return {
    athleteAmountCents: baseCents,
    checkoutTotalCents: baseCents,
    stripeFeeCents: 0,
    applicationFeeCents: 0,
    coverFees: true,
  };
}

function updateDonationButtonText() {
  if (!donationForm || !confirmDonationButton) return;
  const enteredAmount = Number(donationForm.amount.value || 0);
  const coverFees = coverFeesCheckbox?.checked === true;
  if (!enteredAmount || enteredAmount <= 0) {
    confirmDonationButton.textContent = "Donate";
    if (coverFeesCopy) {
      coverFeesCopy.textContent =
        "Keeping fee coverage on helps the athlete receive the full amount you intend to give.";
    }
    return;
  }
  const totals = computeCheckoutAmounts(enteredAmount, coverFees);
  confirmDonationButton.textContent = `Donate ${money(centsToDollars(totals.checkoutTotalCents))}`;
  if (coverFeesCopy) {
    if (coverFees) {
      coverFeesCopy.textContent = `Checkout total ${money(
        centsToDollars(totals.checkoutTotalCents)
      )}. The athlete receives the full ${money(centsToDollars(totals.athleteAmountCents))} donation.`;
    } else {
      coverFeesCopy.textContent = `If you turn this off, the athlete will receive ${money(
        centsToDollars(totals.athleteAmountCents)
      )}, which is less than your intended donation after card and platform fees.`;
    }
  }
}

async function ensureStripeConfig() {
  if (stripeConfig) return stripeConfig;
  stripeConfig = await apiRequest("/api/stripe/config");
  return stripeConfig;
}

function renderGeneralDonationCard() {
  const current = currentPlayer();
  if (!current || !generalDonationCard) return;
  const progress = percent(current.raisedTotal, current.goalTotal);
  generalDonationCard.innerHTML = `
    <div class="equipment-row equipment-card-general equipment-card-clickable" id="general-donate-button">
      <div class="equipment-card-center">
        <p class="equipment-card-title">General Donation</p>
        <p class="equipment-card-price">${money(current.goalTotal)}</p>
        <p class="equipment-card-general-copy">Supports this athlete across every active item.</p>
        <div class="equipment-card-progress">
          <div class="progress-track">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <p class="equipment-card-progress-copy">${money(current.raisedTotal)} of ${money(current.goalTotal)} raised</p>
        </div>
        <button class="btn btn-donate equipment-card-cta" type="button">Give To Athlete</button>
      </div>
    </div>
  `;
}

function renderEquipment() {
  const current = currentPlayer();
  if (!current || !equipmentGrid) return;
  const list = visibleEquipment(current);
  equipmentGrid.innerHTML = "";
  if (!list.length) {
    equipmentGrid.innerHTML = "<p>No public equipment items are available yet.</p>";
    return;
  }

  list.forEach((item) => {
    const progress = percent(item.raised, item.goal);
    const row = document.createElement("div");
    row.className = "equipment-row equipment-card-clickable";
    row.dataset.eqIndex = String(item.index);
    row.innerHTML = `
      <div class="equipment-card-center">
        <p class="equipment-card-title">${item.name}</p>
        <p class="equipment-card-price">${money(item.goal)}</p>
        <div class="equipment-card-progress">
          <div class="progress-track">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <p class="equipment-card-progress-copy">${money(item.raised)} of ${money(item.goal)} raised</p>
        </div>
      </div>
    `;
    equipmentGrid.appendChild(row);
  });
}

function openDonationForm(equipmentIndex) {
  const current = currentPlayer();
  if (!current || !donationForm || !donationHelp) return;
  const item = current.equipment[equipmentIndex];
  if (!item) return;
  selectedDonationMode = "equipment";
  selectedIndex = equipmentIndex;
  const remaining = Math.max(0, Number(item.goal || 0) - Number(item.raised || 0));
  selectedEquipmentCopy.textContent = `Selected: ${item.name} • Remaining ${money(remaining)}`;
  donationHelp.textContent = `Selected ${item.name}. Complete your donation in the popup modal.`;
  donationForm.amount.value = remaining > 0 ? Math.min(remaining, 25) : 0;
  if (coverFeesCheckbox) coverFeesCheckbox.checked = true;
  donationFeedback.textContent = "";
  donationFeedback.classList.remove("is-error");
  updateDonationButtonText();
  openDonationModal();
}

function openGeneralDonationForm() {
  const current = currentPlayer();
  if (!current || !donationForm || !donationHelp) return;
  selectedDonationMode = "general";
  selectedIndex = null;
  const remaining = totalRemaining(current);
  selectedEquipmentCopy.textContent = `Selected: General Donation • Remaining overall ${money(remaining)}`;
  donationHelp.textContent =
    "General donations automatically fill the highest remaining equipment goals first.";
  donationForm.amount.value = remaining > 0 ? Math.min(remaining, 50) : 0;
  if (coverFeesCheckbox) coverFeesCheckbox.checked = true;
  donationFeedback.textContent = "";
  donationFeedback.classList.remove("is-error");
  updateDonationButtonText();
  openDonationModal();
}

async function submitDonation(formData) {
  const current = currentPlayer();
  if (!current) throw new Error("Player unavailable.");

  const donationAmount = Number(formData.get("amount"));
  if (selectedDonationMode === "general") {
    const remaining = totalRemaining(current);
    if (donationAmount <= 0) throw new Error("Donation amount must be greater than $0.");
    if (remaining > 0 && donationAmount > remaining) {
      throw new Error(`Amount exceeds remaining overall goal ($${remaining.toFixed(2)}).`);
    }
  } else {
    if (selectedIndex === null) throw new Error("Choose an equipment item.");
    const item = current.equipment[selectedIndex];
    if (!item) throw new Error("Equipment item unavailable.");
  }

  if (mode === "backend") {
    const config = await ensureStripeConfig();
    if (!config?.configured) {
      throw new Error("Stripe checkout is not configured yet.");
    }
    const coverFees = Boolean(formData.get("coverFees"));
    const checkout = computeCheckoutAmounts(donationAmount, coverFees);
    const response = await apiRequest("/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({
        stripe_account_id: current.stripeAccountId,
        amount: dollarsToCents(donationAmount),
        coverFees,
        playerId: current.id,
        publicPlayerId,
        donationType: selectedDonationMode,
        equipmentItemId:
          selectedDonationMode === "equipment" ? current.equipment[selectedIndex]?.id || null : null,
        donorName: formData.get("donorName"),
        donorEmail: formData.get("donorEmail"),
        donorMessage: formData.get("donorMessage"),
        anonymous: Boolean(formData.get("anonymous")),
      }),
    });
    if (!response?.url) {
      if (!response?.mock) {
        throw new Error("Stripe checkout did not return a redirect URL.");
      }
    }
    return {
      redirectUrl: response.url,
      amount: centsToDollars(response.totalAmount || checkout.checkoutTotalCents),
      athleteAmount: centsToDollars(response.playerAmount || checkout.athleteAmountCents),
      externalCheckout: !response?.mock,
      mock: Boolean(response?.mock)
    };
  }

  return api.recordDonation({
    playerInternalId: current.id,
    donationType: selectedDonationMode,
    equipmentIndex: selectedIndex,
    donorName: formData.get("donorName"),
    donorEmail: formData.get("donorEmail"),
    donorMessage: formData.get("donorMessage"),
    anonymous: Boolean(formData.get("anonymous")),
    amount: formData.get("amount"),
  });
}

async function refreshAfterDonation() {
  if (mode === "backend") {
    const data = await apiRequest(`/api/public/players/${encodeURIComponent(publicPlayerId)}`);
    state.player = normalizeBackendPlayer(data.player);
    state.team = {
      id: data.player.team_id,
      name: data.player.team_name || "",
      logoDataUrl: data.player.team_logo_data_url || ""
    };
    return;
  }
  state.player = api.getPlayerByInternalId(state.player?.id);
}

equipmentGrid?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const eqIndex = target.closest("[data-eq-index]")?.dataset.eqIndex;
  if (eqIndex === undefined) return;
  openDonationForm(Number(eqIndex));
});

generalDonationCard?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest("#general-donate-button")) return;
  openGeneralDonationForm();
});

fillRemainingButton?.addEventListener("click", () => {
  const current = currentPlayer();
  if (!current || !donationForm) return;
  const remaining =
    selectedDonationMode === "general"
      ? totalRemaining(current)
      : selectedIndex === null
        ? 0
        : Math.max(
            0,
            Number(current.equipment[selectedIndex]?.goal || 0) -
              Number(current.equipment[selectedIndex]?.raised || 0)
          );
  donationForm.amount.value = remaining;
  updateDonationButtonText();
});

donationForm?.amount?.addEventListener("input", updateDonationButtonText);
coverFeesCheckbox?.addEventListener("change", updateDonationButtonText);

donationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(donationForm);
    const donation = await submitDonation(formData);
    if (donation?.externalCheckout && donation.redirectUrl) {
      window.location.assign(donation.redirectUrl);
      return;
    }
    donationFeedback.textContent = donation?.mock
      ? `Test donation confirmed locally (${money(donation.amount)}).`
      : `Donation confirmed (${money(donation.amount)}).`;
    donationFeedback.classList.remove("is-error");
    showAction(
      donation?.mock
        ? `Local test donation confirmed (${money(donation.amount)}).`
        : `Donation confirmed (${money(donation.amount)}). Thank you for supporting this athlete.`
    );
    donationForm.reset();
    selectedDonationMode = "equipment";
    selectedIndex = null;
    closeDonationModal();
    donationHelp.textContent = "Donation complete. You can donate to another item anytime.";
    await refreshAfterDonation();
    renderTop();
    renderGeneralDonationCard();
    renderEquipment();
    renderProfileInfo();
  } catch (error) {
    donationFeedback.textContent = error.message || "Could not process donation.";
    donationFeedback.classList.add("is-error");
    showAction(error.message || "Could not process donation.", true);
  }
});

jumpToDonateButton?.addEventListener("click", () => {
  donatePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
});

topGeneralDonateButton?.addEventListener("click", () => {
  openGeneralDonationForm();
});

donorModalCloseButtons.forEach((button) => {
  button.addEventListener("click", closeDonationModal);
});

donorModalBackdrop?.addEventListener("click", (event) => {
  if (event.target === donorModalBackdrop) closeDonationModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDonationModal();
});

(async () => {
  try {
    await loadPlayer();
    renderTop();
    renderProfileInfo();
    renderGeneralDonationCard();
    renderEquipment();
    if (checkoutStatus === "success") {
      showAction("Stripe checkout submitted. Donation totals update after payment confirmation.");
    } else if (checkoutStatus === "cancelled") {
      showAction("Stripe checkout was cancelled.", true);
    }
  } catch {
    window.location.href = "/index.html";
  }
})();
