import {
  getExtensionId,
  getMinReward,
  setMinReward,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getMinPlaces,
  setMinPlaces,
  getBeepEnabled,
  setBeepEnabled,
  getTabGuardianEnabled,
  setTabGuardianEnabled,
  getTabGuardianBeepEnabled,
  setTabGuardianBeepEnabled,
} from "../lib/storage.js";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const LOG = "[Prolific Alerts][Popup]";

const prolificTabWarning = $("prolific-tab-warning");
const settingsSection = $("settings-section");
const minRewardSlider = $<HTMLInputElement>("min-reward-slider");
const minRewardValue = $("min-reward-value");
const notificationsToggle = $<HTMLInputElement>("notifications-toggle");
const minRewardRow = $("min-reward-row");
const minPlacesSlider = $<HTMLInputElement>("min-places-slider");
const minPlacesValue = $("min-places-value");
const minPlacesRow = $("min-places-row");
const beepToggle = $<HTMLInputElement>("beep-toggle");
const tabGuardianToggle = $<HTMLInputElement>("tab-guardian-toggle");
const tabGuardianBeepRow = $("tab-guardian-beep-row");
const tabGuardianBeepToggle = $<HTMLInputElement>("tab-guardian-beep-toggle");

async function init() {
  console.log(`${LOG} Popup initializing...`);
  await checkProlificTab();
  await loadSettings();
  console.log(`${LOG} Popup init complete`);
}

async function checkProlificTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://app.prolific.com/*", "https://www.prolific.com/*"],
    });
    if (tabs.length === 0) {
      prolificTabWarning.classList.remove("hidden");
    } else {
      prolificTabWarning.classList.add("hidden");
    }
  } catch {
    prolificTabWarning.classList.add("hidden");
  }
}

async function loadSettings() {
  const [
    minReward,
    notifEnabled,
    minPlaces,
    beepEnabled,
    guardianEnabled,
    guardianBeepEnabled,
  ] = await Promise.all([
    getMinReward(),
    getNotificationsEnabled(),
    getMinPlaces(),
    getBeepEnabled(),
    getTabGuardianEnabled(),
    getTabGuardianBeepEnabled(),
  ]);

  minRewardSlider.value = String(minReward);
  const usdEquiv = (minReward * 1.35).toFixed(2);
  minRewardValue.textContent = `£${minReward.toFixed(2)} ($${usdEquiv})`;

  notificationsToggle.checked = notifEnabled;
  minRewardRow.style.opacity = notifEnabled ? "1" : "0.4";
  minRewardRow.style.pointerEvents = notifEnabled ? "" : "none";
  minPlacesRow.style.opacity = notifEnabled ? "1" : "0.4";
  minPlacesRow.style.pointerEvents = notifEnabled ? "" : "none";

  minPlacesSlider.value = String(minPlaces);
  minPlacesValue.textContent = String(minPlaces);

  beepToggle.checked = beepEnabled;

  tabGuardianToggle.checked = guardianEnabled;
  tabGuardianBeepRow.style.opacity = guardianEnabled ? "1" : "0.4";
  tabGuardianBeepRow.style.pointerEvents = guardianEnabled ? "" : "none";
  tabGuardianBeepToggle.checked = guardianBeepEnabled;

  settingsSection.classList.remove("hidden");

  const extensionId = await getExtensionId();
  const footerExtId = document.getElementById("footer-ext-id");
  if (footerExtId) footerExtId.textContent = extensionId;
}

// Event listeners

let sliderTimeout: ReturnType<typeof setTimeout> | null = null;
minRewardSlider.addEventListener("input", () => {
  const value = parseFloat(minRewardSlider.value);
  const usdVal = (value * 1.35).toFixed(2);
  minRewardValue.textContent = `£${value.toFixed(2)} ($${usdVal})`;
  if (sliderTimeout) clearTimeout(sliderTimeout);
  sliderTimeout = setTimeout(() => setMinReward(value), 300);
});

notificationsToggle.addEventListener("change", () => {
  const enabled = notificationsToggle.checked;
  setNotificationsEnabled(enabled);
  minRewardRow.style.opacity = enabled ? "1" : "0.4";
  minRewardRow.style.pointerEvents = enabled ? "" : "none";
  minPlacesRow.style.opacity = enabled ? "1" : "0.4";
  minPlacesRow.style.pointerEvents = enabled ? "" : "none";
});

let placesSliderTimeout: ReturnType<typeof setTimeout> | null = null;
minPlacesSlider.addEventListener("input", () => {
  const value = parseInt(minPlacesSlider.value, 10);
  minPlacesValue.textContent = String(value);
  if (placesSliderTimeout) clearTimeout(placesSliderTimeout);
  placesSliderTimeout = setTimeout(() => setMinPlaces(value), 300);
});

beepToggle.addEventListener("change", () => {
  setBeepEnabled(beepToggle.checked);
});

tabGuardianToggle.addEventListener("change", () => {
  const enabled = tabGuardianToggle.checked;
  setTabGuardianEnabled(enabled);
  tabGuardianBeepRow.style.opacity = enabled ? "1" : "0.4";
  tabGuardianBeepRow.style.pointerEvents = enabled ? "" : "none";
});

tabGuardianBeepToggle.addEventListener("change", () => {
  setTabGuardianBeepEnabled(tabGuardianBeepToggle.checked);
});

const beepTryBtn = $<HTMLButtonElement>("beep-try-btn");
beepTryBtn.addEventListener("click", () => {
  try {
    const ctx = new AudioContext();
    const beepCount = 9;
    const beepDuration = 0.12;
    const beepGap = 0.1;
    const sequenceGap = 0.3;
    const frequencies = [880, 1046, 1318];
    for (let i = 0; i < beepCount; i++) {
      const seqIndex = Math.floor(i / 3);
      const start =
        ctx.currentTime + i * (beepDuration + beepGap) + seqIndex * sequenceGap;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequencies[i % 3]!, start);
      gainNode.gain.setValueAtTime(0.25, start);
      gainNode.gain.setValueAtTime(0.25, start + beepDuration - 0.02);
      gainNode.gain.linearRampToValueAtTime(0, start + beepDuration);
      oscillator.start(start);
      oscillator.stop(start + beepDuration);
    }
  } catch (e) {
    console.warn("[Settings] Could not play beep:", e);
  }
});

const tabGuardianBeepTryBtn = $<HTMLButtonElement>("tab-guardian-beep-try-btn");
tabGuardianBeepTryBtn.addEventListener("click", () => {
  try {
    const ctx = new AudioContext();
    const notes = [523, 784]; // C5, G5
    const noteDuration = 0.2;
    const noteGap = 0.08;
    for (let i = 0; i < notes.length; i++) {
      const start = ctx.currentTime + i * (noteDuration + noteGap);
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(notes[i]!, start);
      gainNode.gain.setValueAtTime(0, start);
      gainNode.gain.linearRampToValueAtTime(0.2, start + 0.015);
      gainNode.gain.setValueAtTime(0.2, start + noteDuration - 0.04);
      gainNode.gain.linearRampToValueAtTime(0, start + noteDuration);
      oscillator.start(start);
      oscillator.stop(start + noteDuration);
    }
  } catch (e) {
    console.warn("[Settings] Could not play reopened chime:", e);
  }
});

init();
