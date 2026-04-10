const dataApi = window.GridironData;
dataApi.bootstrapDemoData();

const modalBackdrop = document.getElementById("modal-backdrop");
const modals = [...document.querySelectorAll(".modal")];
const openButtons = [...document.querySelectorAll("[data-open-modal]")];
const closeButtons = [...document.querySelectorAll("[data-close-modal]")];
const tabButtons = [...document.querySelectorAll(".tab")];
const coachForgotPasswordButton = document.getElementById("coach-forgot-password");
const playerForgotPasswordButton = document.getElementById("player-forgot-password");
const forgotPasswordForm = document.getElementById("forgot-password-form");
const startCoachSignupButton = document.getElementById("start-coach-signup");
const startPlayerSignupButton = document.getElementById("start-player-signup");
const guideStartCoachSignupButton = document.getElementById("guide-start-coach-signup");
const guideStartPlayerSignupButton = document.getElementById("guide-start-player-signup");
const focusHomeSearchButton = document.getElementById("focus-home-search");
const coachModeButtons = [...document.querySelectorAll("[data-select-coach-mode]")];
const coachRecipientModeInput = document.getElementById("coach-recipient-mode-input");
const coachSetupModeLabel = document.getElementById("coach-setup-mode-label");
const coachSetupModeCopy = document.getElementById("coach-setup-mode-copy");
const changeCoachPayoutModeButton = document.getElementById("change-coach-payout-mode");
const coachTeamStateSelect = document.getElementById("coach-team-state-select");
const coachTeamOutsideUs = document.getElementById("coach-team-outside-us");
const contactForm = document.getElementById("contact-form");
const introOverlay = document.getElementById("intro-overlay");
const featuredCard = document.getElementById("featured-player-card");
const featuredName = document.getElementById("featured-player-name");
const featuredTeam = document.getElementById("featured-player-team");
const featuredProgressFill = document.getElementById("featured-player-progress-fill");
const featuredProgressCopy = document.getElementById("featured-player-progress-copy");
const featuredLink = document.getElementById("featured-player-link");
const preferBackendOnLocalhost =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    const error = new Error("Network unavailable.");
    error.isNetwork = true;
    throw error;
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return json;
}

function showFeedback(id, message, isError = false) {
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

function showModal(id) {
  const targetModal = document.getElementById(id);
  if (!targetModal) return;
  modalBackdrop.hidden = false;
  modals.forEach((modal) => {
    modal.hidden = modal !== targetModal;
  });
}

function hideModal() {
  modalBackdrop.hidden = true;
  modals.forEach((modal) => {
    modal.hidden = true;
  });
}

openButtons.forEach((button) => {
  button.addEventListener("click", () => showModal(button.dataset.openModal));
});

closeButtons.forEach((button) => {
  button.addEventListener("click", hideModal);
});

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) hideModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideModal();
});

function closeIntroOverlay() {
  if (!introOverlay) return;
  introOverlay.hidden = true;
}

if (introOverlay) {
  setTimeout(() => introOverlay.classList.add("is-ready"), 80);
  setTimeout(closeIntroOverlay, 1200);
}

function percentReached(raised, goal) {
  const totalGoal = Number(goal || 0);
  const totalRaised = Number(raised || 0);
  if (!totalGoal) return 0;
  return Math.min(100, Math.round((totalRaised / totalGoal) * 100));
}

function rotationIndex(listLength) {
  const msPerSlot = 3 * 60 * 60 * 1000;
  const slot = Math.floor(Date.now() / msPerSlot);
  return slot % listLength;
}

function renderFeaturedPlayerCard(player) {
  if (!featuredCard || !featuredName || !featuredTeam || !featuredProgressFill || !featuredProgressCopy || !featuredLink)
    return;
  if (!player) {
    featuredCard.hidden = true;
    return;
  }
  const pct = percentReached(player.raisedTotal, player.goalTotal);
  featuredName.textContent = player.name;
  featuredTeam.textContent = `${player.teamName}${player.sport ? ` • ${player.sport}` : ""}`;
  featuredProgressFill.style.width = `${pct}%`;
  featuredProgressCopy.textContent = `${pct}% of goal reached`;
  featuredLink.href = `/player-profile.html?playerId=${encodeURIComponent(player.playerPublicId)}`;
  featuredCard.hidden = false;
}

async function loadFeaturedPlayer() {
  if (!featuredCard) return;
  let players = [];
  try {
    const teams = await apiRequest(`/api/public/teams`);
    const teamPayloads = await Promise.all(
      teams.map((team) => apiRequest(`/api/public/teams/${encodeURIComponent(team.id)}`).catch(() => null))
    );
    teamPayloads.forEach((teamData) => {
      if (!teamData?.team) return;
      const sport = teamData?.team?.sport || "";
      const teamName = teamData?.team?.name || "";
      (teamData.players || []).forEach((p) => {
        players.push({
          name: `${p.first_name} ${p.last_name}`.trim(),
          teamName,
          sport,
          playerPublicId: p.player_public_id,
          raisedTotal: Number(p.raisedTotal || 0),
          goalTotal: Number(p.goalTotal || 0),
        });
      });
    });
  } catch {
    players = [];
  }

  const valid = players.filter((p) => p.playerPublicId);
  if (!valid.length) {
    renderFeaturedPlayerCard(null);
    return;
  }
  const pick = valid[rotationIndex(valid.length)];
  renderFeaturedPlayerCard(pick);
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tablist = button.closest(".tablist");
    const modal = button.closest(".modal");
    if (!tablist || !modal) return;

    const targetPanelId = button.dataset.tabTarget;
    [...tablist.querySelectorAll(".tab")].forEach((tab) => {
      tab.classList.toggle("is-active", tab === button);
    });

    [...modal.querySelectorAll(".tab-panel")].forEach((panel) => {
      const active = panel.id === targetPanelId;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  });
});

function openCreateAccountWithTab(targetPanelId) {
  showModal("create-account-modal");
  const modal = document.getElementById("create-account-modal");
  if (!modal) return;
  const tabs = [...modal.querySelectorAll(".tab")];
  const panels = [...modal.querySelectorAll(".tab-panel")];
  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tabTarget === targetPanelId);
  });
  panels.forEach((panel) => {
    const active = panel.id === targetPanelId;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

function syncCoachLocationInputs() {
  if (!coachTeamStateSelect || !coachTeamOutsideUs) return;
  const outsideUs = coachTeamOutsideUs.checked;
  coachTeamStateSelect.disabled = outsideUs;
  coachTeamStateSelect.required = !outsideUs;
  if (outsideUs) coachTeamStateSelect.value = "";
}

function applyCoachRecipientMode(mode) {
  const safeMode = mode === "player" ? "player" : "coach";
  if (coachRecipientModeInput) coachRecipientModeInput.value = safeMode;
  if (coachSetupModeLabel) {
    coachSetupModeLabel.textContent =
      safeMode === "coach" ? "Coach receives donations" : "Players receive donations individually";
  }
  if (coachSetupModeCopy) {
    coachSetupModeCopy.textContent =
      safeMode === "coach"
        ? "Recommended for youth teams. The coach connects Stripe once, receives donations on behalf of players, and this payout choice is locked after signup."
        : "Each player will be responsible for completing Stripe onboarding and receiving donations personally. This payout choice is locked after signup.";
  }
}

startCoachSignupButton?.addEventListener("click", () => showModal("coach-payout-modal"));
startPlayerSignupButton?.addEventListener("click", () => openCreateAccountWithTab("player-signup"));
guideStartCoachSignupButton?.addEventListener("click", () => showModal("coach-payout-modal"));
guideStartPlayerSignupButton?.addEventListener("click", () => openCreateAccountWithTab("player-signup"));
focusHomeSearchButton?.addEventListener("click", () => {
  hideModal();
  const playerSearch = document.getElementById("player-search");
  playerSearch?.focus();
  playerSearch?.scrollIntoView({ behavior: "smooth", block: "center" });
});
changeCoachPayoutModeButton?.addEventListener("click", () => showModal("coach-payout-modal"));
coachModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyCoachRecipientMode(button.dataset.selectCoachMode);
    openCreateAccountWithTab("coach-signup");
  });
});
applyCoachRecipientMode("coach");
syncCoachLocationInputs();
coachTeamOutsideUs?.addEventListener("change", syncCoachLocationInputs);

function buildSuggestionItem({ title, meta = "", logoDataUrl = "", fallback = "" }, onClick) {
  const li = document.createElement("li");
  li.className = "suggestion-item";
  li.setAttribute("role", "button");
  li.tabIndex = 0;
  li.innerHTML = `
    <div class="suggestion-item-row">
      ${
        logoDataUrl
          ? `<div class="suggestion-logo"><img src="${logoDataUrl}" alt="" /></div>`
          : `<div class="suggestion-logo suggestion-logo-fallback" aria-hidden="true">${fallback || "G"}</div>`
      }
      <div class="suggestion-copy">
        <span class="suggestion-title">${title}</span>
        ${meta ? `<span class="suggestion-meta">${meta}</span>` : ""}
      </div>
    </div>
  `;
  li.addEventListener("mousedown", (event) => event.preventDefault());
  li.addEventListener("click", onClick);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") onClick();
  });
  return li;
}

async function ensurePublicTeamIndex() {
  return new Map();
}

async function enrichSearchMatches(matches) {
  const teamIds = Array.from(
    new Set(
      (Array.isArray(matches) ? matches : [])
        .map((item) => String(item.teamId || "").trim())
        .filter(Boolean)
    )
  );

  const detailEntries = await Promise.all(
    teamIds.map(async (teamId) => {
      try {
        const payload = await apiRequest(`/api/public/teams/${encodeURIComponent(teamId)}`);
        const team = payload?.team || {};
        return [
          teamId,
          {
            teamName: String(team.name || ""),
            teamSport: String(team.sport || ""),
            teamLocation: String(team.location || ""),
            logoDataUrl: String(team.logo_data_url || "")
          }
        ];
      } catch {
        return [teamId, null];
      }
    })
  );

  const teamIndex = new Map(detailEntries);
  return matches.map((item) => {
    const teamMeta = teamIndex.get(String(item.teamId || "")) || null;
    return {
      ...item,
      teamName: item.teamName || teamMeta?.teamName || "",
      teamSport: item.teamSport || teamMeta?.teamSport || "",
      teamLocation: item.teamLocation || teamMeta?.teamLocation || "",
      logoDataUrl: item.logoDataUrl || teamMeta?.logoDataUrl || ""
    };
  });
}

function setupAutocomplete(inputId, listId, kind, formatter, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  input.addEventListener("input", async () => {
    const query = input.value.trim();
    list.innerHTML = "";
    if (!query) {
      list.hidden = true;
      return;
    }

    let matches = [];
    try {
      if (kind === "player") {
        const rows = await apiRequest(`/api/search/players?q=${encodeURIComponent(query)}`);
        matches = rows.map((row) => ({
          teamId: row.team_id,
          playerPublicId: row.player_public_id,
          playerName: `${row.first_name} ${row.last_name}`,
          teamName: row.team_name,
          teamSport: row.team_sport || "",
          teamLocation: row.team_location || "",
          logoDataUrl: row.team_logo_data_url || ""
        }));
      } else {
        const rows = await apiRequest(`/api/search/teams?q=${encodeURIComponent(query)}`);
        matches = rows.map((row) => ({
          teamId: row.id,
          teamName: row.name,
          teamSport: row.sport || "",
          teamLocation: row.location || "",
          logoDataUrl: row.logo_data_url || ""
        }));
      }
    } catch {
      matches = preferBackendOnLocalhost ? [] : dataApi.findSearchResults(query, kind);
    }

    matches = await enrichSearchMatches(matches);
    const seen = new Set();
    matches = matches.filter((item) => {
      const key =
        kind === "player"
          ? String(item.playerPublicId || "").trim().toLowerCase()
          : String(item.teamId || item.teamName || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    matches = matches.slice(0, 5);
    if (!matches.length) {
      list.hidden = true;
      return;
    }

    matches.forEach((item) => {
      const suggestion = formatter(item);
      list.appendChild(
        buildSuggestionItem(suggestion, () => {
          if (typeof onSelect === "function") onSelect(item, suggestion.title);
          else input.value = suggestion.title;
          list.hidden = true;
        })
      );
    });
    list.hidden = false;
  });

  document.addEventListener("click", (event) => {
    if (!list.contains(event.target) && event.target !== input) list.hidden = true;
  });
}

setupAutocomplete(
  "player-search",
  "player-suggestions",
  "player",
  (item) => ({
    title: item.playerName,
    meta: [item.teamName, item.teamSport, item.teamLocation].filter(Boolean).join(" • "),
    logoDataUrl: item.logoDataUrl,
    fallback: String(item.teamName || item.playerName || "G").trim().charAt(0).toUpperCase()
  }),
  (item, label) => {
    const playerPublicId = encodeURIComponent(item.playerPublicId || "");
    if (!playerPublicId) {
      document.getElementById("player-search").value = label;
      return;
    }
    window.location.assign(`/player-profile.html?playerId=${playerPublicId}`);
  }
);

setupAutocomplete(
  "team-search",
  "team-suggestions",
  "team",
  (item) => ({
    title: item.teamName,
    meta: [item.teamSport, item.teamLocation].filter(Boolean).join(" • "),
    logoDataUrl: item.logoDataUrl,
    fallback: String(item.teamName || "G").trim().charAt(0).toUpperCase()
  }),
  (item, label) => {
    const teamId = encodeURIComponent(item.teamId || "");
    if (!teamId) {
      document.getElementById("team-search").value = label;
      return;
    }
    window.location.assign(`/team-profile.html?teamId=${teamId}`);
  }
);

const coachSignupForm = document.getElementById("coach-signup-form");
coachSignupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(coachSignupForm);
  const password = String(formData.get("coachPassword") || "");
  const passwordConfirm = String(formData.get("coachPasswordConfirm") || "");
  const teamCity = String(formData.get("teamCity") || "").trim();
  const teamState = String(formData.get("teamState") || "").trim().toUpperCase();
  const outsideUs = Boolean(formData.get("teamOutsideUs"));
  const teamLocation = outsideUs ? `${teamCity} (International)` : `${teamCity}, ${teamState}`;
  if (password !== passwordConfirm) {
    showFeedback("coach-signup-feedback", "Passwords must match.", true);
    return;
  }
  if (!teamCity) {
    showFeedback("coach-signup-feedback", "Please enter your team city.", true);
    return;
  }
  if (!outsideUs && !teamState) {
    showFeedback("coach-signup-feedback", "Please choose your team state.", true);
    return;
  }
  if (!formData.get("coachPolicyConsent")) {
    showFeedback("coach-signup-feedback", "Please accept Terms and Privacy Policy to continue.", true);
    return;
  }
  try {
    const created = await apiRequest("/api/coaches/signup", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("coachName"),
        email: formData.get("coachEmail"),
        password,
        teamName: formData.get("teamName"),
        teamLocation,
        teamSport: formData.get("teamSport"),
        recipientMode: formData.get("recipientMode")
      })
    });
    const backendCoachId = created.coachId;
    // Best effort local mirror; ignore collisions/stale local data.
    try {
      dataApi.createCoachAccount({
        name: formData.get("coachName"),
        email: formData.get("coachEmail"),
        password,
        teamName: formData.get("teamName"),
        teamLocation,
        teamSport: formData.get("teamSport")
      });
    } catch {}
    dataApi.setSession("coach", backendCoachId, backendCoachId);
    window.location.href = "/coach-dashboard.html";
  } catch (error) {
    // Fallback to local-only mode if backend is unavailable.
    if (error.isNetwork && !preferBackendOnLocalhost) {
      try {
        const localCoachId = dataApi.createCoachAccount({
          name: formData.get("coachName"),
          email: formData.get("coachEmail"),
          password,
          teamName: formData.get("teamName"),
          teamLocation,
          teamSport: formData.get("teamSport")
        });
        dataApi.setSession("coach", localCoachId, null);
        window.location.href = "/coach-dashboard.html";
        return;
      } catch {}
    }
    showFeedback("coach-signup-feedback", error.message, true);
    showAction(error.message || "Could not create coach account.", true);
  }
});

const playerIdInput = document.getElementById("player-id-input");
const playerEmailInput = document.getElementById("player-email-input");

async function fillPlayerEmailFromId() {
  const value = String(playerIdInput?.value || "").trim();
  if (!value) {
    if (playerEmailInput) playerEmailInput.value = "";
    return;
  }
  try {
    const player = await apiRequest(`/api/players/lookup/${encodeURIComponent(value)}`);
    if (playerEmailInput) playerEmailInput.value = player.email || "";
    showFeedback("player-signup-feedback", "Player found. Finish setting your password.");
  } catch {
    const local = dataApi.findPlayerById(value);
    if (!local) {
      if (playerEmailInput) playerEmailInput.value = "";
      showFeedback("player-signup-feedback", "PlayerID not found yet.", true);
      return;
    }
    if (playerEmailInput) playerEmailInput.value = local.email;
    showFeedback("player-signup-feedback", "Player found. Finish setting your password.");
  }
}

playerIdInput?.addEventListener("input", fillPlayerEmailFromId);
playerIdInput?.addEventListener("blur", fillPlayerEmailFromId);

const playerSignupForm = document.getElementById("player-signup-form");
playerSignupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(playerSignupForm);
  const password = String(formData.get("playerPassword") || "");
  const passwordConfirm = String(formData.get("playerPasswordConfirm") || "");
  if (password !== passwordConfirm) {
    showFeedback("player-signup-feedback", "Passwords must match.", true);
    return;
  }
  if (!formData.get("playerPolicyConsent")) {
    showFeedback("player-signup-feedback", "Please accept Terms and Privacy Policy to continue.", true);
    return;
  }
  try {
    const created = await apiRequest("/api/players/signup", {
      method: "POST",
      body: JSON.stringify({
        playerPublicId: formData.get("playerId"),
        password
      })
    });
    let localPlayerId = null;
    try {
      localPlayerId = dataApi.activatePlayerAccount({
        playerId: formData.get("playerId"),
        password
      });
    } catch {
      localPlayerId = created.playerId || null;
    }
    dataApi.setSession("player", localPlayerId, created.playerId || null);
    window.location.href = "/player-dashboard.html";
  } catch (error) {
    if (error.isNetwork && !preferBackendOnLocalhost) {
      try {
        const localPlayerId = dataApi.activatePlayerAccount({
          playerId: formData.get("playerId"),
          password
        });
        dataApi.setSession("player", localPlayerId, null);
        window.location.href = "/player-dashboard.html";
        return;
      } catch {}
    }
    showFeedback("player-signup-feedback", error.message, true);
    showAction(error.message || "Could not create player account.", true);
  }
});

const coachSigninForm = document.getElementById("coach-signin-form");
coachSigninForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(coachSigninForm);
  try {
    const result = await apiRequest("/api/coaches/signin", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("coachLoginEmail"),
        password: formData.get("coachLoginPassword")
      })
    });
    const backendCoachId = result.coachId;
    dataApi.setSession("coach", backendCoachId, backendCoachId);
    window.location.href = "/coach-dashboard.html";
  } catch (error) {
    if (error.isNetwork && !preferBackendOnLocalhost) {
      // Fallback to local-only auth if backend is unavailable.
      const localCoachId = dataApi.authenticateCoach(
        formData.get("coachLoginEmail"),
        formData.get("coachLoginPassword")
      );
      if (localCoachId) {
        dataApi.setSession("coach", localCoachId, null);
        window.location.href = "/coach-dashboard.html";
        return;
      }
    }
    showFeedback("coach-signin-feedback", error.message || "Invalid coach credentials.", true);
    showAction(error.message || "Invalid coach credentials.", true);
  }
});

const playerSigninForm = document.getElementById("player-signin-form");
playerSigninForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(playerSigninForm);
  try {
    const result = await apiRequest("/api/players/signin", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("playerLoginEmail"),
        password: formData.get("playerLoginPassword")
      })
    });
    const localPlayerId =
      dataApi.authenticatePlayer(formData.get("playerLoginEmail"), formData.get("playerLoginPassword")) ||
      result.playerId ||
      null;
    dataApi.setSession("player", localPlayerId, result.playerId || null);
    window.location.href = "/player-dashboard.html";
  } catch (error) {
    if (error.isNetwork && !preferBackendOnLocalhost) {
      const localPlayerId = dataApi.authenticatePlayer(
        formData.get("playerLoginEmail"),
        formData.get("playerLoginPassword")
      );
      if (localPlayerId) {
        dataApi.setSession("player", localPlayerId, null);
        window.location.href = "/player-dashboard.html";
        return;
      }
    }
    showFeedback("player-signin-feedback", error.message || "Invalid player credentials.", true);
    showAction(error.message || "Invalid player credentials.", true);
  }
});

function openForgotPasswordModal(role) {
  if (!forgotPasswordForm) return;
  forgotPasswordForm.role.value = role;
  showFeedback("forgot-password-feedback", "");
  showModal("forgot-password-modal");
}

coachForgotPasswordButton?.addEventListener("click", () => openForgotPasswordModal("coach"));
playerForgotPasswordButton?.addEventListener("click", () => openForgotPasswordModal("player"));

forgotPasswordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apiRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({
        role: forgotPasswordForm.role.value,
        email: forgotPasswordForm.email.value.trim()
      })
    });
    showFeedback(
      "forgot-password-feedback",
      "If that email exists, recovery instructions were sent."
    );
    showAction("If that email exists, recovery instructions were sent.");
  } catch (error) {
    showFeedback("forgot-password-feedback", error.message, true);
    showAction(error.message || "Could not send recovery email.", true);
  }
});

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(contactForm);
    await apiRequest("/api/contact", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        message: String(formData.get("message") || "").trim()
      })
    });
    showFeedback("contact-feedback", "Message sent.");
    contactForm.reset();
    showAction("Message sent. We will reply within 1-5 days.");
  } catch (error) {
    showFeedback("contact-feedback", error.message || "Could not send message.", true);
    showAction(error.message || "Could not send message.", true);
  }
});

if (featuredCard) {
  loadFeaturedPlayer();
  setInterval(loadFeaturedPlayer, 3 * 60 * 60 * 1000);
}
