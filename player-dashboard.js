const api = window.GridironData;
const session = api.getSession();
if (!session || session.role !== "player") {
  window.location.href = "/index.html";
}

let mode = session.backendId ? "backend" : "local";
let backendPlayerId = session.backendId || null;
let state = {
  player: null,
  team: null,
};

const nameHeading = document.getElementById("player-name-heading");
const teamCopy = document.getElementById("player-team-copy");
const statsEl = document.getElementById("player-stats");
const sportCopy = document.getElementById("sport-copy");
const equipmentList = document.getElementById("equipment-list");
const equipmentForm = document.getElementById("equipment-form");
const equipmentFeedback = document.getElementById("equipment-feedback");
const publishToggle = document.getElementById("publish-toggle");
const playerImageInput = document.getElementById("player-image-input");
const playerImagePreview = document.getElementById("player-image-preview");
const payoutsButton = document.getElementById("setup-payouts");
const stripeDashboardButton = document.getElementById("open-stripe-dashboard");
const logoutButton = document.getElementById("player-logout");
const addEquipmentButton = document.getElementById("add-equipment");
const playerModalBackdrop = document.getElementById("player-modal-backdrop");
const confirmSaveModal = document.getElementById("confirm-save-modal");
const updatesMadeModal = document.getElementById("updates-made-modal");
const stripeSetupModal = document.getElementById("stripe-setup-modal");
const stripeSetupScroll = document.getElementById("stripe-setup-scroll");
const continueStripeSetupButton = document.getElementById("continue-stripe-setup");
const changesList = document.getElementById("save-changes-list");
const confirmSaveButton = document.getElementById("confirm-save-button");
const playerModalCloseButtons = [...document.querySelectorAll("[data-player-modal-close]")];

let draftEquipment = [];
let pendingSave = null;

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

function normalizeBackendPlayer(player) {
  const equipment = (Array.isArray(player?.equipment) ? player.equipment : []).map((item, index) => ({
    id: item.id,
    name: String(item.name || "Equipment"),
    category: String(item.category || "General"),
    priceRange: String(item.price_range || item.priceRange || ""),
    goal: Number(item.goal || 0),
    raised: Number(item.raised || 0),
    enabled: Number(item.enabled) === 1,
    __originId: item.id || `orig-${index}`,
    __isNew: false,
  }));

  return {
    id: player.id,
    teamId: player.team_id,
    firstName: player.first_name,
    lastName: player.last_name,
    email: player.email,
    playerId: player.player_public_id,
    registered: Number(player.registered) === 1,
    imageDataUrl: player.image_data_url || "",
    published: Number(player.published) === 1,
    stripeAccountId: String(player.stripe_account_id || ""),
    stripeOnboardingComplete: Number(player.stripe_onboarding_complete) === 1,
    goalTotal: Number(player.goalTotal || 0),
    raisedTotal: Number(player.raisedTotal || 0),
    equipment,
  };
}

async function loadBackendPlayer() {
  if (!backendPlayerId) throw new Error("Missing player session.");
  const data = await apiRequest(`/api/players/${encodeURIComponent(backendPlayerId)}/dashboard`);
  state.player = normalizeBackendPlayer(data.player);
  state.team = {
    id: data.player.team_id,
    name: data.player.teamName || data.player.team_name || "",
    sport: data.player.teamSport || data.player.team_sport || "",
  };
}

function loadLocalPlayer() {
  const player = api.getPlayerByInternalId(session.id);
  if (!player) throw new Error("Player not found.");
  const team = api.getTeamById(player.teamId);
  state.player = player;
  state.team = team || null;
}

function refreshPlayer() {
  return state.player;
}

async function saveProfile({ equipment, published, imageDataUrl }) {
  const current = refreshPlayer();
  if (!current) return;
  if (mode === "backend") {
    await apiRequest(`/api/players/${encodeURIComponent(current.id)}/dashboard`, {
      method: "PUT",
      body: JSON.stringify({
        equipment: (equipment || []).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price_range: item.priceRange || item.price_range || "",
          goal: Number(item.goal || 0),
          raised: Number(item.raised || 0),
          enabled: item.enabled !== false,
        })),
        published: Boolean(published),
        imageDataUrl: String(imageDataUrl || ""),
      }),
    });
    await loadBackendPlayer();
    return;
  }

  api.savePlayerProfile(current.id, {
    equipment: (equipment || []).map((item) => stripItemForSave(item)),
    published: Boolean(published),
    imageDataUrl: String(imageDataUrl || ""),
  });
  loadLocalPlayer();
}

function normalizeItem(item) {
  return {
    name: String(item?.name || "Equipment").trim(),
    category: String(item?.category || "General").trim(),
    priceRange: String(item?.priceRange || "").trim(),
    goal: Number(item?.goal || 0),
    raised: Number(item?.raised || 0),
    enabled: item?.enabled !== false,
  };
}

function cloneEquipment(list) {
  return (Array.isArray(list) ? list : []).map((item, index) => ({
    ...normalizeItem(item),
    __isNew: false,
    __originId: item?.__originId || `orig-${index}`,
  }));
}

function stripItemForSave(item) {
  return {
    name: item.name,
    category: item.category,
    priceRange: item.priceRange,
    goal: Number(item.goal || 0),
    raised: Number(item.raised || 0),
    enabled: item.enabled !== false,
  };
}

function openPlayerModal(modalId) {
  if (!playerModalBackdrop) return;
  playerModalBackdrop.hidden = false;
  if (confirmSaveModal) confirmSaveModal.hidden = modalId !== "confirm-save-modal";
  if (updatesMadeModal) updatesMadeModal.hidden = modalId !== "updates-made-modal";
  if (stripeSetupModal) stripeSetupModal.hidden = modalId !== "stripe-setup-modal";
}

function closePlayerModal() {
  if (!playerModalBackdrop) return;
  playerModalBackdrop.hidden = true;
  if (confirmSaveModal) confirmSaveModal.hidden = true;
  if (updatesMadeModal) updatesMadeModal.hidden = true;
  if (stripeSetupModal) stripeSetupModal.hidden = true;
}

function playerPercent(p) {
  const goal = Number(p.goalTotal || 0);
  const raised = Number(p.raisedTotal || 0);
  if (!goal) return 0;
  return Math.min(100, Math.round((raised / goal) * 100));
}

function renderStats(p) {
  if (!statsEl) return;
  const goal = Number(p.goalTotal || 0);
  const raised = Number(p.raisedTotal || 0);
  const pct = playerPercent(p);
  statsEl.innerHTML = `
    <div class="stat-pill"><span>$${raised.toFixed(2)}</span><small>Raised</small></div>
    <div class="stat-pill"><span>$${goal.toFixed(2)}</span><small>Goal</small></div>
    <div class="stat-pill"><span>${pct}%</span><small>Progress</small></div>
  `;
}

function renderEquipment() {
  if (!equipmentList) return;
  equipmentList.innerHTML = "";
  if (!draftEquipment.length) {
    equipmentList.innerHTML = "<p>No equipment configured yet. Add an item below.</p>";
    return;
  }

  draftEquipment.forEach((item, index) => {
    const progressPercent =
      item.enabled && item.goal > 0 ? Math.min(100, Math.round((item.raised / item.goal) * 100)) : 0;
    const row = document.createElement("div");
    row.className = `equipment-row ${item.enabled ? "" : "is-disabled"}`;
    row.dataset.index = String(index);
    row.innerHTML = `
      <div class="equipment-row-top">
        <label class="toggle-label compact-toggle">
          <input type="checkbox" data-field="enabled" ${item.enabled ? "checked" : ""} />
          Public profile
        </label>
        <button class="btn btn-danger-ghost btn-small" type="button" data-remove-index="${index}">
          Remove
        </button>
      </div>

      <div class="equipment-main">
        <label class="equipment-name">
          <span class="field-caption">Equipment</span>
          <input type="text" data-field="name" value="${item.name}" placeholder="Equipment name" />
        </label>
        <label class="equipment-goal">
          <span class="field-caption">Goal</span>
          <div class="goal-input-wrap">
            <span>$</span>
            <input type="number" min="0" step="1" data-field="goal" value="${item.goal}" ${
      item.enabled ? "" : "disabled"
    } />
          </div>
        </label>
      </div>

      <div class="equipment-footer">
        <div class="equipment-meta">
          <span class="meta-pill">${item.category || "General"}</span>
          <span class="meta-pill meta-pill-muted">Typical price: ${
          item.priceRange || "Not set"
          }</span>
          ${item.enabled ? "" : '<span class="meta-pill meta-pill-muted">Hidden From Public</span>'}
        </div>
        <span class="equipment-raised">$${item.raised.toFixed(2)} raised</span>
      </div>

      <div class="progress-track">
        <div class="progress-fill" style="width:${progressPercent}%"></div>
      </div>
    `;
    equipmentList.appendChild(row);
  });
}

function renderPublishButton(p) {
  if (!publishToggle) return;
  publishToggle.textContent = p.published ? "Edit" : "Publish";
  publishToggle.classList.toggle("btn-primary", !p.published);
}

function renderPayoutButton(p) {
  if (!payoutsButton) return;
  const complete = Boolean(p?.stripeOnboardingComplete);
  payoutsButton.textContent = complete ? "Payment Setup Complete" : "Set Up Payments";
  payoutsButton.disabled = complete;
  payoutsButton.classList.toggle("btn-money-soft", !complete);
  payoutsButton.classList.toggle("btn-soft", complete);
  if (stripeDashboardButton) {
    stripeDashboardButton.hidden = !p?.stripeAccountId;
  }
}

function renderImage(p) {
  if (!playerImagePreview) return;
  if (p.imageDataUrl) {
    playerImagePreview.src = p.imageDataUrl;
    playerImagePreview.hidden = false;
    return;
  }
  playerImagePreview.hidden = true;
}

function syncDraftFromDom() {
  if (!equipmentList) return;
  const rows = [...equipmentList.querySelectorAll(".equipment-row")];
  draftEquipment = rows.map((row) => {
    const index = Number(row.dataset.index || 0);
    const previous = draftEquipment[index] || normalizeItem({});
    const enabled = row.querySelector('[data-field="enabled"]')?.checked !== false;
    const goal = Number(row.querySelector('[data-field="goal"]')?.value || 0);
    return {
      ...previous,
      enabled,
      name: String(row.querySelector('[data-field="name"]')?.value || "").trim() || "Equipment",
      category: previous.category || "General",
      priceRange: previous.priceRange || "",
      goal,
    };
  });
}

function buildChangeSummary(currentEquipment, nextEquipment) {
  const current = Array.isArray(currentEquipment) ? currentEquipment : [];
  const next = Array.isArray(nextEquipment) ? nextEquipment : [];
  const changes = [];
  const currentById = Object.fromEntries(current.map((item) => [item.__originId, item]));
  const nextById = Object.fromEntries(next.map((item) => [item.__originId, item]));

  current.forEach((base) => {
    if (!nextById[base.__originId]) changes.push(`Removed item: ${base.name}`);
  });

  next.forEach((item) => {
    const base = currentById[item.__originId];
    if (!base) {
      changes.push(`Added item: ${item.name} (Goal $${Number(item.goal || 0).toFixed(0)})`);
      return;
    }
    if ((base.name || "") !== (item.name || "")) {
      changes.push(`Renamed "${base.name}" to "${item.name}"`);
    }
    if (Number(base.goal || 0) !== Number(item.goal || 0)) {
      changes.push(
        `Updated goal for "${item.name}": $${Number(base.goal || 0).toFixed(0)} to $${Number(
          item.goal || 0
        ).toFixed(0)}`
      );
    }
    if (base.enabled !== item.enabled) {
      changes.push(
        item.enabled
          ? `Showing "${item.name}" on public profile`
          : `Hiding "${item.name}" from public profile`
      );
    }
  });

  return changes;
}

function render() {
  const current = refreshPlayer();
  if (!current) return;
  nameHeading.textContent = `${current.firstName} ${current.lastName} Dashboard`;
  teamCopy.textContent = state.team?.name || "";
  renderStats(current);
  renderPublishButton(current);
  renderPayoutButton(current);
  renderImage(current);
  if (!draftEquipment.length) draftEquipment = cloneEquipment(current.equipment);
  renderEquipment();
}

async function refreshStripeStatus() {
  const current = refreshPlayer();
  if (!current || mode !== "backend" || !current.id) return;
  if (!current.stripeAccountId) return;
  const wasComplete = Boolean(current.stripeOnboardingComplete);
  try {
    const status = await apiRequest("/api/stripe/player-status", {
      method: "POST",
      body: JSON.stringify({ playerId: current.id }),
    });
    current.stripeAccountId = String(status.stripe_account_id || current.stripeAccountId || "");
    current.stripeOnboardingComplete = Boolean(status.onboarding_complete);
    renderPayoutButton(current);
    if (!wasComplete && current.stripeOnboardingComplete) {
      showAction("Stripe enabled. Your payout setup is complete.");
    }
  } catch {}
}

async function openHostedStripeOnboarding(payoutWindow) {
  const current = refreshPlayer();
  if (!current) throw new Error("Player session is missing.");
  const response = await apiRequest("/onboard-player", {
    method: "POST",
    body: JSON.stringify({
      playerId: current.id,
      stripe_account_id: current.stripeAccountId || "",
    }),
  });
  if (response?.stripeAccountId) {
    current.stripeAccountId = String(response.stripeAccountId);
  }
  if (!response?.url) {
    throw new Error("Stripe onboarding link was not returned.");
  }
  if (payoutWindow && !payoutWindow.closed) {
    try {
      payoutWindow.document.open();
      payoutWindow.document.write(`
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
                font-family: Nunito, sans-serif;
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
              <p>You can return to Gridiron Give after Stripe setup is complete.</p>
            </div>
          </body>
        </html>
      `);
      payoutWindow.document.close();
    } catch {}
    payoutWindow.location.replace(response.url);
  } else {
    window.open(response.url, "_blank");
  }
  showAction("Stripe payout setup opened in a new tab.");
}

function resetStripeSetupGate() {
  if (stripeSetupScroll) stripeSetupScroll.scrollTop = 0;
  if (continueStripeSetupButton) continueStripeSetupButton.disabled = true;
}

function evaluateStripeSetupGate() {
  if (!stripeSetupScroll || !continueStripeSetupButton) return;
  const threshold = stripeSetupScroll.scrollHeight - stripeSetupScroll.clientHeight - 8;
  continueStripeSetupButton.disabled = stripeSetupScroll.scrollTop < Math.max(0, threshold);
}

equipmentList?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest(".equipment-row")) return;
  syncDraftFromDom();
});

equipmentList?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest(".equipment-row")) return;
  syncDraftFromDom();
  renderEquipment();
});

equipmentList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const removeIndex = target.dataset.removeIndex;
  if (removeIndex === undefined) return;
  syncDraftFromDom();
  draftEquipment.splice(Number(removeIndex), 1);
  renderEquipment();
});

addEquipmentButton?.addEventListener("click", () => {
  syncDraftFromDom();
  draftEquipment.push(
    {
      ...normalizeItem({
        name: "New Equipment",
        category: "General",
        priceRange: "",
        goal: 0,
        raised: 0,
        enabled: true,
      }),
      __isNew: true,
      __originId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
  );
  renderEquipment();
});

equipmentForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const current = refreshPlayer();
  if (!current) return;
  syncDraftFromDom();
  const currentDraft = cloneEquipment(current.equipment);
  const equipmentToSave = draftEquipment.map((item) => stripItemForSave(item));
  const changes = buildChangeSummary(currentDraft, draftEquipment);

  if (changesList) {
    changesList.innerHTML = "";
    (changes.length ? changes : ["No equipment changes detected."]).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      changesList.appendChild(li);
    });
  }

  pendingSave = {
    playerId: current.id,
    equipment: equipmentToSave,
    published: true,
    imageDataUrl: current.imageDataUrl || "",
  };
  openPlayerModal("confirm-save-modal");
});

publishToggle?.addEventListener("click", () => {
  const current = refreshPlayer();
  if (!current) return;
  syncDraftFromDom();
  Promise.resolve(saveProfile({
    equipment: draftEquipment.map((item) => ({ ...stripItemForSave(item), id: item.id })),
    imageDataUrl: current.imageDataUrl || "",
    published: !current.published,
  }))
    .then(() => render())
    .catch((error) => {
      equipmentFeedback.textContent = error.message || "Could not update publish state.";
      equipmentFeedback.classList.add("is-error");
      showAction(error.message || "Could not update publish state.", true);
    });
});

playerImageInput?.addEventListener("change", async () => {
  const file = playerImageInput.files?.[0];
  if (!file) return;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
  const current = refreshPlayer();
  if (!current) return;
  syncDraftFromDom();
  Promise.resolve(
    saveProfile({
      imageDataUrl: String(dataUrl),
      equipment: draftEquipment.map((item) => ({ ...stripItemForSave(item), id: item.id })),
      published: current.published,
    })
  )
    .then(() => render())
    .catch((error) => {
      equipmentFeedback.textContent = error.message || "Could not save image.";
      equipmentFeedback.classList.add("is-error");
      showAction(error.message || "Could not save image.", true);
    });
});

payoutsButton?.addEventListener("click", async () => {
  resetStripeSetupGate();
  openPlayerModal("stripe-setup-modal");
});

continueStripeSetupButton?.addEventListener("click", async () => {
  const payoutWindow = window.open("about:blank", "_blank");
  try {
    closePlayerModal();
    await openHostedStripeOnboarding(payoutWindow);
  } catch (error) {
    if (payoutWindow && !payoutWindow.closed) {
      payoutWindow.close();
    }
    showAction(error.message || "Could not start Stripe onboarding.", true);
  }
});

stripeDashboardButton?.addEventListener("click", async () => {
  const current = refreshPlayer();
  if (!current?.id) {
    showAction("Player session is missing.", true);
    return;
  }
  const dashboardWindow = window.open("about:blank", "_blank");
  try {
    const response = await apiRequest("/stripe/dashboard-link", {
      method: "POST",
      body: JSON.stringify({ playerId: current.id }),
    });
    if (!response?.url) {
      throw new Error("Stripe dashboard link was not returned.");
    }
    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.location.replace(response.url);
    } else {
      window.open(response.url, "_blank");
    }
  } catch (error) {
    if (dashboardWindow && !dashboardWindow.closed) {
      dashboardWindow.close();
    }
    showAction(error.message || "Could not open Stripe dashboard.", true);
  }
});

logoutButton?.addEventListener("click", () => {
  api.clearSession();
  window.location.href = "/index.html";
});

playerModalCloseButtons.forEach((button) => {
  button.addEventListener("click", closePlayerModal);
});

playerModalBackdrop?.addEventListener("click", (event) => {
  if (event.target === playerModalBackdrop) closePlayerModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePlayerModal();
});

stripeSetupScroll?.addEventListener("scroll", evaluateStripeSetupGate);

window.addEventListener("focus", () => {
  refreshStripeStatus();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshStripeStatus();
  }
});

confirmSaveButton?.addEventListener("click", () => {
  if (!pendingSave) {
    closePlayerModal();
    return;
  }
  Promise.resolve(
    saveProfile({
      equipment: pendingSave.equipment,
      published: pendingSave.published,
      imageDataUrl: pendingSave.imageDataUrl,
    })
  )
    .then(() => {
      equipmentFeedback.textContent = "Equipment list saved.";
      equipmentFeedback.classList.remove("is-error");
      showAction("Equipment goals saved and published.");
      draftEquipment = cloneEquipment(refreshPlayer()?.equipment || pendingSave.equipment);
      pendingSave = null;
      render();
      openPlayerModal("updates-made-modal");
    })
    .catch((error) => {
      equipmentFeedback.textContent = error.message || "Could not save equipment.";
      equipmentFeedback.classList.add("is-error");
      showAction(error.message || "Could not save equipment.", true);
      pendingSave = null;
      closePlayerModal();
    });
});

(async () => {
  try {
    if (mode === "backend") {
      await loadBackendPlayer();
    } else {
      try {
        loadLocalPlayer();
      } catch {
        if (session.id) {
          backendPlayerId = String(session.id);
          mode = "backend";
          await loadBackendPlayer();
          api.setSession("player", backendPlayerId, backendPlayerId);
        } else {
          throw new Error("No valid player session.");
        }
      }
    }
    const current = refreshPlayer();
    const team = state.team;
    if (!current) throw new Error("Player not found.");
    if (team) sportCopy.textContent = `Sport: ${team.sport || ""}`;
    draftEquipment = cloneEquipment(current.equipment);
    render();
    await refreshStripeStatus();
  } catch (error) {
    const message = error?.message || "Could not load player dashboard.";
    const main = document.querySelector(".dashboard-main");
    if (main) {
      main.innerHTML = `
        <section class="card">
          <h1 class="dashboard-title">Player Dashboard Unavailable</h1>
          <p class="dashboard-copy">Reason: ${message}</p>
          <div class="modal-actions section-top-gap-sm">
            <a class="btn btn-ghost" href="/index.html">Back To Home</a>
          </div>
        </section>
      `;
      return;
    }
    window.location.href = "/index.html";
  }
})();
