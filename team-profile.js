const api = window.GridironData;
api.bootstrapDemoData();

const params = new URLSearchParams(window.location.search);
const teamId = params.get("teamId");
const checkoutStatus = params.get("checkout");

const teamTop = document.getElementById("team-top");
const rosterBody = document.getElementById("team-roster-body");
const teamDonateCard = document.getElementById("team-donate-card");
const teamDonateCopy = document.getElementById("team-donate-copy");
const teamGeneralDonationCard = document.getElementById("team-general-donation-card");
const teamEquipmentGrid = document.getElementById("team-equipment-grid");
const donorModalBackdrop = document.getElementById("team-donor-modal-backdrop");
const donationModal = document.getElementById("team-donation-modal");
const donationForm = document.getElementById("team-donation-form");
const selectedCopy = document.getElementById("team-selected-copy");
const playerSelectWrap = document.getElementById("team-player-select-wrap");
const playerSelect = document.getElementById("team-player-select");
const fillRemainingButton = document.getElementById("team-fill-remaining");
const coverFeesCheckbox = document.getElementById("team-cover-fees-checkbox");
const coverFeesCopy = document.getElementById("team-cover-fees-copy");
const confirmDonationButton = document.getElementById("team-confirm-donation-button");
const closeButtons = [...document.querySelectorAll("[data-team-donor-close]")];

let state = {
  team: null,
  players: [],
  teamEquipment: [],
  totalTeamGoal: 0,
  totalTeamRaised: 0
};
let selectedMode = "team-general";
let selectedEquipmentName = "";
const preferBackendOnLocalhost =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

function showAction(message, isError = false) {
  if (typeof window.showActionMessage === "function") {
    window.showActionMessage(message, { isError });
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function progress(raised, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((Number(raised || 0) / Number(goal || 0)) * 100));
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
    return { athleteAmountCents: 0, checkoutTotalCents: 0, stripeFeeCents: 0, applicationFeeCents: 0 };
  }
  if (!coverFees) {
    const stripeFeeCents = estimateStripeFeeCents(baseCents);
    const applicationFeeCents = minimumPlatformFeeCents(baseCents);
    return {
      athleteAmountCents: Math.max(0, baseCents - stripeFeeCents - applicationFeeCents),
      checkoutTotalCents: baseCents,
      stripeFeeCents,
      applicationFeeCents
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
        applicationFeeCents: checkoutTotalCents - baseCents - stripeFeeCents
      };
    }
    checkoutTotalCents += 1;
  }
  return { athleteAmountCents: baseCents, checkoutTotalCents: baseCents, stripeFeeCents: 0, applicationFeeCents: 0 };
}

async function loadTeam() {
  if (!teamId) throw new Error("Missing team id.");
  try {
    const data = await apiRequest(`/api/public/teams/${encodeURIComponent(teamId)}`);
    state.team = data.team;
    state.players = data.players || [];
    state.teamEquipment = data.teamEquipment || [];
    state.totalTeamGoal = Number(data.totalTeamGoal || 0);
    state.totalTeamRaised = Number(data.totalTeamRaised || 0);
    return;
  } catch (error) {
    if (preferBackendOnLocalhost) throw error;
  }

  const local = api.getTeamRoster(teamId);
  if (!local?.team) throw new Error("Team not found.");
  state.team = local.team;
  state.players = local.players || [];
  state.teamEquipment = [];
  state.totalTeamGoal = state.players.reduce((sum, player) => sum + Number(player.goalTotal || 0), 0);
  state.totalTeamRaised = state.players.reduce((sum, player) => sum + Number(player.raisedTotal || 0), 0);
}

function renderTop() {
  if (!teamTop || !state.team) return;
  const teamProgress = progress(state.totalTeamRaised, state.totalTeamGoal);
  const teamLogo = String(state.team.logo_data_url || "");
  teamTop.innerHTML = `
    <div class="team-hero-identity">
      ${
        teamLogo
          ? `<div class="team-hero-logo"><img src="${teamLogo}" alt="${state.team.name} logo" /></div>`
          : `<div class="team-hero-logo team-hero-logo-fallback" aria-hidden="true">${String(state.team.name || "T")
              .trim()
              .charAt(0)
              .toUpperCase()}</div>`
      }
      <div>
        <p class="eyebrow">Team View</p>
        <h1 class="dashboard-title">${state.team.name}</h1>
        <p class="dashboard-copy">${state.team.location || "Location not set"}${state.team.sport ? ` • ${state.team.sport}` : ""}</p>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat-pill"><span>${money(state.totalTeamRaised)}</span><small>Raised</small></div>
      <div class="stat-pill"><span>${money(state.totalTeamGoal)}</span><small>Goal</small></div>
      <div class="stat-pill"><span>${teamProgress}%</span><small>Progress</small></div>
    </div>
  `;
}

function renderRoster() {
  if (!rosterBody) return;
  rosterBody.innerHTML = "";
  if (!state.players.length) {
    rosterBody.innerHTML = '<tr><td colspan="6" class="subtle-copy">No players found.</td></tr>';
    return;
  }
  state.players.forEach((player) => {
    const tr = document.createElement("tr");
    const pct = progress(player.raisedTotal, player.goalTotal);
    const playerHref = `/player-profile.html?playerId=${encodeURIComponent(player.player_public_id)}`;
    tr.innerHTML = `
      <td><a class="table-name-link" href="${playerHref}">${player.first_name} ${player.last_name}</a></td>
      <td>${money(player.raisedTotal)}</td>
      <td>${money(player.goalTotal)}</td>
      <td><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></td>
      <td><a class="btn btn-soft btn-small" href="${playerHref}">View Player</a></td>
    `;
    rosterBody.appendChild(tr);
  });
}

function populatePlayerSelect() {
  if (!playerSelect) return;
  playerSelect.innerHTML = "";
  state.players.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = `${player.first_name} ${player.last_name}`;
    playerSelect.appendChild(option);
  });
}

function openDonationModal(mode, equipmentName = "") {
  if (!donorModalBackdrop || !donationModal || !donationForm) return;
  selectedMode = mode;
  selectedEquipmentName = equipmentName;
  donorModalBackdrop.hidden = false;
  donationModal.hidden = false;
  populatePlayerSelect();
  if (mode === "team-general") {
    selectedCopy.textContent = `Selected: Team General Donation • Split evenly across ${state.players.length} players`;
    playerSelectWrap.hidden = true;
    donationForm.amount.value = state.totalTeamGoal > 0 ? Math.min(state.totalTeamGoal, 100) : 0;
  } else {
    selectedCopy.textContent = `Selected: ${equipmentName} • Choose which player this gift supports`;
    playerSelectWrap.hidden = false;
    const item = state.teamEquipment.find((entry) => entry.name === equipmentName);
    donationForm.amount.value = item?.goal ? Math.min(Number(item.goal || 0), 50) : 0;
  }
  coverFeesCheckbox.checked = true;
  updateDonationButton();
}

function closeDonationModal() {
  if (!donorModalBackdrop || !donationModal) return;
  donorModalBackdrop.hidden = true;
  donationModal.hidden = true;
}

function updateDonationButton() {
  if (!donationForm || !confirmDonationButton) return;
  const enteredAmount = Number(donationForm.amount.value || 0);
  const coverFees = coverFeesCheckbox.checked === true;
  if (!enteredAmount || enteredAmount <= 0) {
    confirmDonationButton.textContent = "Donate";
    coverFeesCopy.textContent = "Keeping fee coverage on helps the athlete receive the full amount you intend to give.";
    return;
  }
  const totals = computeCheckoutAmounts(enteredAmount, coverFees);
  confirmDonationButton.textContent = `Donate ${money(centsToDollars(totals.checkoutTotalCents))}`;
  if (coverFees) {
    coverFeesCopy.textContent = `Checkout total ${money(centsToDollars(totals.checkoutTotalCents))}. The athlete receives the full ${money(centsToDollars(totals.athleteAmountCents))} donation.`;
  } else {
    coverFeesCopy.textContent = `If you turn this off, the athlete receives ${money(centsToDollars(totals.athleteAmountCents))}, which is less than your intended donation after card and platform fees.`;
  }
}

function renderTeamDonationPanel() {
  if (!teamDonateCard || !teamGeneralDonationCard || !teamEquipmentGrid) return;
  const coachMode = String(state.team?.recipient_mode || "coach") === "coach";
  teamDonateCard.hidden = !coachMode;
  if (!coachMode) return;
  teamDonateCopy.textContent = "Choose a team gift or support one player through a shared item.";
  const teamProgress = progress(state.totalTeamRaised, state.totalTeamGoal);
  teamGeneralDonationCard.innerHTML = `
    <div class="equipment-row equipment-card-general equipment-card-clickable" id="team-general-donate-button">
      <div class="equipment-card-center">
        <p class="equipment-card-title">General Donation</p>
        <p class="equipment-card-price">${money(state.totalTeamGoal)}</p>
        <p class="equipment-card-general-copy">Supports the full roster and splits your gift evenly across every player.</p>
        <div class="equipment-card-progress">
          <div class="progress-track"><div class="progress-fill" style="width:${teamProgress}%"></div></div>
          <p class="equipment-card-progress-copy">${money(state.totalTeamRaised)} of ${money(state.totalTeamGoal)} raised</p>
        </div>
        <button class="btn btn-donate equipment-card-cta" type="button">Donate To Team Goal</button>
      </div>
    </div>
  `;
  teamEquipmentGrid.innerHTML = "";
  state.teamEquipment.forEach((item) => {
    if (Number(item.enabled) === 0) return;
    const row = document.createElement("div");
    row.className = "equipment-row equipment-card-clickable";
    row.dataset.teamEq = item.name;
    row.innerHTML = `
      <div class="equipment-card-center">
        <p class="equipment-card-title">${item.name}</p>
        <p class="equipment-card-price">${money(item.goal)}</p>
        <div class="equipment-card-progress">
          <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
          <p class="equipment-card-progress-copy">Choose a player in the next step</p>
        </div>
      </div>
    `;
    teamEquipmentGrid.appendChild(row);
  });
}

teamGeneralDonationCard?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest("#team-general-donate-button")) return;
  openDonationModal("team-general");
});

teamEquipmentGrid?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const equipmentName = target.closest("[data-team-eq]")?.dataset.teamEq;
  if (!equipmentName) return;
  openDonationModal("equipment", equipmentName);
});

fillRemainingButton?.addEventListener("click", () => {
  if (!donationForm) return;
  if (selectedMode === "team-general") {
    donationForm.amount.value = state.totalTeamGoal;
  } else {
    const item = state.teamEquipment.find((entry) => entry.name === selectedEquipmentName);
    donationForm.amount.value = Number(item?.goal || 0);
  }
  updateDonationButton();
});

coverFeesCheckbox?.addEventListener("change", updateDonationButton);
donationForm?.amount?.addEventListener("input", updateDonationButton);
closeButtons.forEach((button) => button.addEventListener("click", closeDonationModal));
donorModalBackdrop?.addEventListener("click", (event) => {
  if (event.target === donorModalBackdrop) closeDonationModal();
});

donationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(donationForm);
    const donationAmount = Number(formData.get("amount"));
    const coverFees = Boolean(formData.get("coverFees"));
    const teamGeneral = selectedMode === "team-general";
    const selectedPlayerId = teamGeneral ? "" : String(formData.get("playerId") || "").trim();
    if (!teamGeneral && !selectedPlayerId) {
      throw new Error("Choose a player to receive credit for this donation.");
    }
    const checkout = await apiRequest("/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({
        teamId: state.team.id,
        playerId: selectedPlayerId,
        publicPlayerId: selectedPlayerId
          ? state.players.find((player) => player.id === selectedPlayerId)?.player_public_id || ""
          : "",
        sourcePage: "team",
        donationType: teamGeneral ? "team-general" : "equipment",
        teamEquipmentName: teamGeneral ? "" : selectedEquipmentName,
        amount: dollarsToCents(donationAmount),
        coverFees,
        donorName: formData.get("donorName"),
        donorEmail: formData.get("donorEmail"),
        donorMessage: String(formData.get("donorMessage") || "").trim(),
        anonymous: Boolean(formData.get("anonymous"))
      })
    });
    if (preferBackendOnLocalhost) {
      console.log("[local-stripe-debug] team donation checkout response", {
        mode: selectedMode,
        teamId: state.team?.id || "",
        checkout
      });
    }
    if (checkout?.mock) {
      closeDonationModal();
      donationForm.reset();
      await loadTeam();
      renderTop();
      renderRoster();
      renderTeamDonationPanel();
      updateDonationButton();
      showAction("Local test donation confirmed.");
      return;
    }
    if (!checkout?.url) throw new Error("Stripe checkout did not return a redirect URL.");
    window.location.assign(checkout.url);
  } catch (error) {
    showAction(error.message || "Could not start team donation.", true);
  }
});

(async () => {
  try {
    await loadTeam();
    renderTop();
    renderRoster();
    renderTeamDonationPanel();
    updateDonationButton();
    if (checkoutStatus === "success") {
      showAction("Stripe checkout submitted. Team donation totals update after payment confirmation.");
    } else if (checkoutStatus === "cancelled") {
      showAction("Stripe checkout was cancelled.", true);
    }
  } catch {
    window.location.href = "/index.html";
  }
})();
