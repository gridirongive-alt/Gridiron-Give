const STORAGE_KEY = "gridironGiveDataV1";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function randomPart(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generatePlayerId(data) {
  let id = `GG-${randomPart(3)}-${randomPart(4)}`;
  while (data.players.some((player) => player.playerId === id)) {
    id = `GG-${randomPart(3)}-${randomPart(4)}`;
  }
  return id;
}

function defaultEquipmentItem(name, category, priceRange) {
  return {
    name,
    category,
    priceRange,
    goal: 0,
    raised: 0,
    enabled: true,
  };
}

function normalizeEquipmentItem(item) {
  return {
    name: String(item?.name || "Equipment").trim(),
    category: String(item?.category || "General").trim(),
    priceRange: String(item?.priceRange || "").trim(),
    goal: Number(item?.goal || 0),
    raised: Number(item?.raised || 0),
    enabled: item?.enabled !== false,
  };
}

function gearForSport(sport) {
  const bySport = {
    football: [
      defaultEquipmentItem("Helmet", "Protection", "$250 - $450"),
      defaultEquipmentItem("Shoulder Pads", "Protection", "$150 - $300"),
      defaultEquipmentItem("Cleats", "Footwear", "$50 - $150"),
      defaultEquipmentItem("Jersey/Pants", "Apparel", "$20 - $40"),
      defaultEquipmentItem("Practice Gear", "Apparel", "$50 - $120"),
      defaultEquipmentItem("Girdle/Lower Body Pads", "Protection", "$40 - $80"),
      defaultEquipmentItem("Back Plate/Rib Protection", "Protection", "$30 - $60"),
      defaultEquipmentItem("Mouthguard/Chinstrap", "Protection", "$10 - $25"),
      defaultEquipmentItem("Gloves", "Accessories", "$30 - $65"),
      defaultEquipmentItem("Training Shoes", "Footwear", "$60 - $170"),
      defaultEquipmentItem("Season Referee Fees", "Officiating", "$600 - $1500"),
      defaultEquipmentItem("Season Field Rental", "Facilities", "$500 - $2000"),
    ],
    "ice hockey": [
      defaultEquipmentItem("Skates", "Footwear", "$150 - $600"),
      defaultEquipmentItem("Helmet (with Cage)", "Protection", "$80 - $250"),
      defaultEquipmentItem("Sticks (2x)", "Equipment", "$100 - $400"),
      defaultEquipmentItem("Gloves", "Protection", "$60 - $180"),
      defaultEquipmentItem("Pads (Shoulder/Shin/Elbow)", "Protection", "$150 - $350"),
      defaultEquipmentItem("Breezers/Pants", "Apparel", "$80 - $200"),
      defaultEquipmentItem("Season Official Fees", "Officiating", "$500 - $1200"),
      defaultEquipmentItem("Season Ice Rental", "Facilities", "$2000 - $6000"),
    ],
    lacrosse: [
      defaultEquipmentItem("Stick (Complete)", "Equipment", "$80 - $250"),
      defaultEquipmentItem("Helmet (Men's) or Goggles (Women's)", "Protection", "$40 - $350"),
      defaultEquipmentItem("Gloves", "Protection", "$70 - $180"),
      defaultEquipmentItem("Pads (Shoulder/Arm/Ribs)", "Protection", "$120 - $300"),
      defaultEquipmentItem("Cleats", "Footwear", "$60 - $130"),
      defaultEquipmentItem("Season Official Fees", "Officiating", "$400 - $1000"),
      defaultEquipmentItem("Season Field/Turf Rental", "Facilities", "$600 - $1800"),
    ],
    baseball: [
      defaultEquipmentItem("Glove", "Equipment", "$60 - $250"),
      defaultEquipmentItem("Bat", "Equipment", "$100 - $450"),
      defaultEquipmentItem("Helmet", "Protection", "$40 - $100"),
      defaultEquipmentItem("Cleats", "Footwear", "$50 - $120"),
      defaultEquipmentItem("Uniform/Pants", "Apparel", "$50 - $150"),
      defaultEquipmentItem("Season Umpire Fees", "Officiating", "$500 - $1100"),
      defaultEquipmentItem("Season Field Maintenance/Rental", "Facilities", "$400 - $1200"),
    ],
    "field hockey": [
      defaultEquipmentItem("Stick", "Equipment", "$50 - $300"),
      defaultEquipmentItem("Shin Guards & Goggles", "Protection", "$70 - $160"),
      defaultEquipmentItem("Turf Shoes", "Footwear", "$60 - $140"),
      defaultEquipmentItem("Season Umpire Fees", "Officiating", "$350 - $900"),
      defaultEquipmentItem("Season Turf Rental", "Facilities", "$500 - $1500"),
    ],
    basketball: [
      defaultEquipmentItem("Basketball Shoes", "Footwear", "$80 - $180"),
      defaultEquipmentItem("Uniform/Warm-ups", "Apparel", "$60 - $150"),
      defaultEquipmentItem("Ball", "Equipment", "$30 - $70"),
      defaultEquipmentItem("Season Referee Fees", "Officiating", "$400 - $950"),
      defaultEquipmentItem("Season Gym Rental", "Facilities", "$600 - $2000"),
    ],
    soccer: [
      defaultEquipmentItem("Cleats", "Footwear", "$50 - $200"),
      defaultEquipmentItem("Shin Guards", "Protection", "$15 - $50"),
      defaultEquipmentItem("Uniform/Training Gear", "Apparel", "$70 - $200"),
      defaultEquipmentItem("Season Referee Fees", "Officiating", "$450 - $1200"),
      defaultEquipmentItem("Season Field Rental", "Facilities", "$400 - $1500"),
    ],
    volleyball: [
      defaultEquipmentItem("Court Shoes", "Footwear", "$70 - $150"),
      defaultEquipmentItem("Knee Pads", "Protection", "$25 - $50"),
      defaultEquipmentItem("Jersey/Spandex", "Apparel", "$50 - $120"),
      defaultEquipmentItem("Season Official Fees", "Officiating", "$350 - $800"),
      defaultEquipmentItem("Season Court Rental", "Facilities", "$500 - $1800"),
    ],
    tennis: [
      defaultEquipmentItem("Racket(s)", "Equipment", "$100 - $400"),
      defaultEquipmentItem("Court Shoes", "Footwear", "$70 - $160"),
      defaultEquipmentItem("Tennis Whites/Athletic Wear", "Apparel", "$50 - $150"),
      defaultEquipmentItem("Tournament Official Fees", "Officiating", "$200 - $600"),
      defaultEquipmentItem("Season Court Membership/Rental", "Facilities", "$200 - $800"),
    ],
    golf: [
      defaultEquipmentItem("Clubs (Full Set)", "Equipment", "$300 - $1200"),
      defaultEquipmentItem("Golf Bag", "Equipment", "$100 - $250"),
      defaultEquipmentItem("Golf Shoes", "Footwear", "$70 - $180"),
      defaultEquipmentItem("Tournament/Rules Officials", "Officiating", "$150 - $500"),
      defaultEquipmentItem("Season Greens Fees/Range Access", "Facilities", "$400 - $2500"),
    ],
  };
  const normalized = (sport || "football").toLowerCase();
  if (normalized === "hockey") return bySport["ice hockey"];
  if (normalized === "baseball/softball") return bySport.baseball;
  return bySport[normalized] || bySport.football;
}

function defaultData() {
  return {
    coaches: [],
    teams: [],
    players: [],
    donations: [],
    emailToPlayerId: {},
  };
}

function equipmentTotals(equipment) {
  const enabledEquipment = (Array.isArray(equipment) ? equipment : []).filter(
    (item) => item.enabled !== false
  );
  return {
    goalTotal: enabledEquipment.reduce((sum, item) => sum + Number(item.goal || 0), 0),
    raisedTotal: enabledEquipment.reduce((sum, item) => sum + Number(item.raised || 0), 0),
  };
}

function readData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  try {
    const parsed = JSON.parse(raw);
    const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
    const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
    const players = (Array.isArray(parsed.players) ? parsed.players : []).map((player) => {
      const sport = teamById[player.teamId]?.sport || "football";
      const template = gearForSport(sport);
      const existing = Array.isArray(player.equipment) ? player.equipment : [];
      const existingByName = Object.fromEntries(
        existing.map((item) => [String(item?.name || "").trim().toLowerCase(), item])
      );
      const fromTemplate = template.map((item) =>
        normalizeEquipmentItem({
          ...item,
          ...(existingByName[item.name.toLowerCase()] || {}),
        })
      );
      const extras = existing
        .filter(
          (item) =>
            !template.some(
              (preset) =>
                preset.name.toLowerCase() === String(item?.name || "").trim().toLowerCase()
            )
        )
        .map((item) => normalizeEquipmentItem(item));
      const equipment = [...fromTemplate, ...extras];
      const totals = equipmentTotals(equipment);
      return {
        ...player,
        equipment,
        goalTotal: totals.goalTotal,
        raisedTotal: totals.raisedTotal,
      };
    });
    return {
      coaches: Array.isArray(parsed.coaches) ? parsed.coaches : [],
      teams,
      players,
      donations: Array.isArray(parsed.donations) ? parsed.donations : [],
      emailToPlayerId:
        parsed.emailToPlayerId && typeof parsed.emailToPlayerId === "object"
          ? parsed.emailToPlayerId
          : {},
    };
  } catch {
    return defaultData();
  }
}

function writeData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function bootstrapDemoData() {
  return readData();
}

function createCoachAccount({ name, email, password, teamName, teamLocation, teamSport }) {
  const data = readData();
  const normalizedEmail = normalizeEmail(email);
  if (data.coaches.some((coach) => normalizeEmail(coach.email) === normalizedEmail)) {
    throw new Error("A coach account already exists with that email.");
  }

  const coachId = `coach-${randomPart(6)}`;
  const teamId = `team-${randomPart(6)}`;
  data.coaches.push({
    id: coachId,
    name: String(name || "").trim(),
    email: String(email || "").trim(),
    password: String(password || ""),
    teamId,
  });
  data.teams.push({
    id: teamId,
    coachId,
    name: String(teamName || "").trim(),
    location: String(teamLocation || "").trim(),
    sport: String(teamSport || "football").trim().toLowerCase() || "football",
  });
  writeData(data);
  return coachId;
}

function authenticateCoach(email, password) {
  const data = readData();
  const coach = data.coaches.find(
    (item) =>
      normalizeEmail(item.email) === normalizeEmail(email) && item.password === password
  );
  return coach ? coach.id : null;
}

function findPlayerById(playerId) {
  const data = readData();
  return data.players.find(
    (player) => player.playerId.toLowerCase() === String(playerId || "").trim().toLowerCase()
  );
}

function activatePlayerAccount({ playerId, password }) {
  const data = readData();
  const player = data.players.find(
    (item) =>
      item.playerId.toLowerCase() === String(playerId || "").trim().toLowerCase()
  );
  if (!player) throw new Error("PlayerID not found.");
  player.password = String(password || "");
  player.registered = true;
  writeData(data);
  return player.id;
}

function authenticatePlayer(email, password) {
  const data = readData();
  const player = data.players.find(
    (item) =>
      normalizeEmail(item.email) === normalizeEmail(email) && item.password === password
  );
  return player ? player.id : null;
}

function setSession(role, id, backendId = null) {
  localStorage.setItem("gridironGiveSession", JSON.stringify({ role, id, backendId }));
}

function getSession() {
  try {
    const raw = localStorage.getItem("gridironGiveSession");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem("gridironGiveSession");
}

function getCoachWithTeam(coachId) {
  const data = readData();
  const coach = data.coaches.find((item) => item.id === coachId);
  if (!coach) return null;
  const team = data.teams.find((item) => item.id === coach.teamId) || null;
  return { coach, team };
}

function updateTeam(teamId, updates) {
  const data = readData();
  const team = data.teams.find((item) => item.id === teamId);
  if (!team) return false;
  const previousSport = String(team.sport || "football").toLowerCase();
  team.name = String(updates.name || team.name || "").trim();
  team.location = String(updates.location || team.location || "").trim();
  team.sport = String(updates.sport || team.sport || "football").toLowerCase();
  const roster = data.players.filter((item) => item.teamId === team.id);
  roster.forEach((player) => {
    if (!Array.isArray(player.equipment) || !player.equipment.length || previousSport !== team.sport) {
      player.equipment = gearForSport(team.sport).map((item) => ({
        ...item,
      }));
    }
  });
  writeData(data);
  return true;
}

function playersForTeam(teamId) {
  const data = readData();
  return data.players.filter((player) => player.teamId === teamId);
}

function upsertPlayerByEmail({ teamId, firstName, lastName, email }) {
  const data = readData();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("Email is required.");
  let playerId = data.emailToPlayerId[normalized];
  if (!playerId) {
    playerId = generatePlayerId(data);
    data.emailToPlayerId[normalized] = playerId;
  }

  const existing = data.players.find(
    (player) => normalizeEmail(player.email) === normalized && player.teamId === teamId
  );
  if (existing) {
    existing.firstName = String(firstName || existing.firstName || "").trim();
    existing.lastName = String(lastName || existing.lastName || "").trim();
    existing.playerId = playerId;
    writeData(data);
    return existing;
  }

  const team = data.teams.find((item) => item.id === teamId);
  const sport = team?.sport || "football";
  const player = {
    id: `player-${randomPart(6)}`,
    teamId,
    firstName: String(firstName || "").trim(),
    lastName: String(lastName || "").trim(),
    email: String(email || "").trim(),
    playerId,
    password: "",
    registered: false,
    imageDataUrl: "",
    raisedTotal: 0,
    goalTotal: 0,
    published: false,
    equipment: gearForSport(sport).map((item) => ({ ...item })),
  };
  data.players.push(player);
  writeData(data);
  return player;
}

function removePlayer(playerId) {
  const data = readData();
  data.players = data.players.filter((player) => player.id !== playerId);
  writeData(data);
}

function getPlayerByInternalId(playerId) {
  const data = readData();
  return data.players.find((player) => player.id === playerId) || null;
}

function getPlayerByPublicPlayerId(playerId) {
  const data = readData();
  const normalized = String(playerId || "").trim().toLowerCase();
  return data.players.find((player) => player.playerId.toLowerCase() === normalized) || null;
}

function getTeamById(teamId) {
  const data = readData();
  return data.teams.find((team) => team.id === teamId) || null;
}

function savePlayerProfile(playerId, { imageDataUrl, equipment, published }) {
  const data = readData();
  const player = data.players.find((item) => item.id === playerId);
  if (!player) return false;
  if (typeof imageDataUrl === "string") player.imageDataUrl = imageDataUrl;
  if (Array.isArray(equipment)) {
    player.equipment = equipment.map((item) => normalizeEquipmentItem(item));
  }
  if (typeof published === "boolean") player.published = published;
  const totals = equipmentTotals(player.equipment);
  player.goalTotal = totals.goalTotal;
  player.raisedTotal = totals.raisedTotal;
  writeData(data);
  return true;
}

function findSearchResults(query, kind) {
  const data = readData();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  if (kind === "team") {
    return data.teams
      .filter((team) => team.name.toLowerCase().includes(q))
      .map((team) => ({ teamId: team.id, teamName: team.name }));
  }
  return data.players
    .map((player) => {
      const team = data.teams.find((item) => item.id === player.teamId);
      return {
        playerInternalId: player.id,
        playerPublicId: player.playerId,
        playerName: `${player.firstName} ${player.lastName}`.trim(),
        teamId: player.teamId,
        teamName: team?.name || "Unknown Team",
      };
    })
    .filter((item) => item.playerName.toLowerCase().includes(q));
}

function getTeamRoster(teamId) {
  const data = readData();
  const team = data.teams.find((item) => item.id === teamId) || null;
  if (!team) return null;
  const players = data.players.filter((item) => item.teamId === teamId);
  return { team, players };
}

function getTeamDonations(teamId) {
  const data = readData();
  const players = data.players.filter((player) => player.teamId === teamId);
  const playerById = new Map(players.map((player) => [player.id, player]));
  return (Array.isArray(data.donations) ? data.donations : [])
    .filter((donation) => playerById.has(donation.playerId))
    .map((donation) => {
      const player = playerById.get(donation.playerId);
      return {
        id: donation.id,
        amount: Number(donation.amount || 0),
        checkout_total_amount: Number(donation.amount || 0),
        application_fee_amount: 0,
        donor_name: String(donation.donorName || "").trim(),
        donor_email: String(donation.donorEmail || "").trim(),
        anonymous: donation.anonymous ? 1 : 0,
        created_at: donation.createdAt || "",
        first_name: String(player?.firstName || "").trim(),
        last_name: String(player?.lastName || "").trim(),
        equipment_name: String(donation.equipmentName || "General Donation").trim()
      };
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function recordDonation({
  playerInternalId,
  donationType,
  equipmentIndex,
  donorName,
  donorEmail,
  donorMessage,
  anonymous,
  amount,
}) {
  const data = readData();
  const player = data.players.find((item) => item.id === playerInternalId);
  if (!player) throw new Error("Player not found.");
  const donationAmount = Number(amount || 0);
  if (donationAmount <= 0) throw new Error("Donation amount must be greater than $0.");

  if (donationType === "general") {
    const allocations = player.equipment
      .map((equipment, index) => ({
        equipment,
        index,
        remaining: equipment.enabled === false ? 0 : Math.max(0, Number(equipment.goal || 0) - Number(equipment.raised || 0)),
      }))
      .filter((item) => item.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining || Number(b.equipment.goal || 0) - Number(a.equipment.goal || 0));
    const overallRemaining = allocations.reduce((sum, item) => sum + item.remaining, 0);
    if (overallRemaining > 0 && donationAmount > overallRemaining) {
      throw new Error(`Amount exceeds remaining overall goal ($${overallRemaining.toFixed(2)}).`);
    }

    let remainingDonation = donationAmount;
    const appliedAllocations = [];
    allocations.forEach((entry) => {
      if (remainingDonation <= 0) return;
      const applied = Math.min(entry.remaining, remainingDonation);
      if (applied <= 0) return;
      entry.equipment.raised = Number(entry.equipment.raised || 0) + applied;
      appliedAllocations.push({
        equipmentIndex: entry.index,
        equipmentName: entry.equipment.name,
        amount: applied,
      });
      data.donations.push({
        id: `don-${randomPart(8)}`,
        playerId: player.id,
        equipmentIndex: entry.index,
        equipmentName: entry.equipment.name,
        amount: applied,
        donorName: String(donorName || "").trim(),
        donorEmail: String(donorEmail || "").trim(),
        donorMessage: String(donorMessage || "").trim(),
        anonymous: Boolean(anonymous),
        createdAt: new Date().toISOString(),
      });
      remainingDonation -= applied;
    });

    const totals = equipmentTotals(player.equipment);
    player.goalTotal = totals.goalTotal;
    player.raisedTotal = totals.raisedTotal;
    writeData(data);
    return {
      id: `don-${randomPart(8)}`,
      playerId: player.id,
      amount: donationAmount,
      allocations: appliedAllocations,
    };
  }

  const idx = Number(equipmentIndex);
  const equipment = player.equipment[idx];
  if (!equipment || equipment.enabled === false) throw new Error("Equipment item unavailable.");
  const remaining = Math.max(0, Number(equipment.goal || 0) - Number(equipment.raised || 0));
  if (remaining > 0 && donationAmount > remaining) {
    throw new Error(`Amount exceeds remaining goal ($${remaining.toFixed(2)}).`);
  }

  equipment.raised = Number(equipment.raised || 0) + donationAmount;
  const totals = equipmentTotals(player.equipment);
  player.goalTotal = totals.goalTotal;
  player.raisedTotal = totals.raisedTotal;

  const donation = {
    id: `don-${randomPart(8)}`,
    playerId: player.id,
    equipmentIndex: idx,
    equipmentName: equipment.name,
    amount: donationAmount,
    donorName: String(donorName || "").trim(),
    donorEmail: String(donorEmail || "").trim(),
    donorMessage: String(donorMessage || "").trim(),
    anonymous: Boolean(anonymous),
    createdAt: new Date().toISOString(),
  };
  data.donations.push(donation);
  writeData(data);
  return donation;
}

window.GridironData = {
  bootstrapDemoData,
  createCoachAccount,
  authenticateCoach,
  findPlayerById,
  activatePlayerAccount,
  authenticatePlayer,
  setSession,
  getSession,
  clearSession,
  getCoachWithTeam,
  updateTeam,
  playersForTeam,
  upsertPlayerByEmail,
  removePlayer,
  getPlayerByInternalId,
  getPlayerByPublicPlayerId,
  getTeamById,
  savePlayerProfile,
  findSearchResults,
  getTeamRoster,
  getTeamDonations,
  recordDonation,
  gearForSport,
  slugify,
};
