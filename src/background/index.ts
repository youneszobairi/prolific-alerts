import {
  getExtensionId,
  getBeepEnabled,
  getTabGuardianEnabled,
  getTabGuardianBeepEnabled,
} from "../lib/storage.js";
import {
  notifyStudy,
  notifyStudyReappeared,
  notifyReappearedSummary,
  notifySummary,
  notifyTabGuardianWrongPage,
} from "../lib/api.js";

const LOG = "[Prolific Alerts][BG]";

/**
 * Play the beep alert sound via an offscreen document.
 * Service workers cannot use AudioContext directly, so we create
 * an offscreen document that owns the audio context.
 */
async function playBeepViaOffscreen(): Promise<void> {
  try {
    // Ensure the offscreen document exists (no-op if already created)
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: "src/offscreen/offscreen.html",
        reasons: ["AUDIO_PLAYBACK" as chrome.offscreen.Reason],
        justification: "Play beep alert sound for new study notification",
      });
      // Wait briefly for the offscreen document's script to load and
      // register its onMessage listener — createDocument resolves when
      // the document is created, not when its scripts have executed.
      await new Promise((r) => setTimeout(r, 150));
    }
    // Tell the offscreen document to play the beep
    chrome.runtime.sendMessage({ type: "PLAY_BEEP" });
  } catch (err) {
    console.warn(`${LOG} ⚠️ Could not play beep via offscreen:`, err);
  }
}

/**
 * Play the tab-reopened chime via the offscreen document.
 */
async function playReopenedViaOffscreen(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: "src/offscreen/offscreen.html",
        reasons: ["AUDIO_PLAYBACK" as chrome.offscreen.Reason],
        justification: "Play chime when Prolific tab is reopened",
      });
      await new Promise((r) => setTimeout(r, 150));
    }
    chrome.runtime.sendMessage({ type: "PLAY_REOPENED" });
  } catch (err) {
    console.warn(`${LOG} ⚠️ Could not play reopened chime via offscreen:`, err);
  }
}

/** Prolific URL patterns matching the manifest content_scripts. */
const PROLIFIC_URLS = [
  "https://www.prolific.com/*",
  "https://app.prolific.com/*",
  "file:///*test-page*",
];

/**
 * Inject the content script into any already-open Prolific tabs.
 * Called on install/update so users don't need to manually refresh.
 */
async function injectIntoExistingTabs(): Promise<void> {
  console.log(
    `${LOG} 🔌 Injecting content script into existing Prolific tabs...`,
  );
  try {
    const tabs = await chrome.tabs.query({ url: PROLIFIC_URLS });
    console.log(
      `${LOG} 🔌 Found ${tabs.length} existing Prolific tab(s) to inject into`,
    );
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        console.log(
          `${LOG} ✅ Injected content script into tab ${tab.id}: ${tab.url}`,
        );
      } catch (err) {
        // Tab may be discarded, crashed, or URL restricted — skip it.
        console.warn(`${LOG} ❌ Could not inject into tab ${tab.id}:`, err);
      }
    }
  } catch (err) {
    console.warn(`${LOG} ❌ Failed to query tabs for injection:`, err);
  }
}

/**
 * Background service worker for the Prolific Alerts extension.
 *
 * Responsibilities:
 * - Generates/persists a unique extension install ID on first install.
 * - Periodically checks the user's status via the API.
 * - Listens for messages from content scripts about detected studies.
 */

// On install: inject into already-open tabs and set up keep-alive alarm
chrome.runtime.onInstalled.addListener(async () => {
  console.log(`${LOG} 🚀 onInstalled event fired`);
  chrome.alarms.create("keep-alive", { periodInMinutes: 0.4 });
  chrome.alarms.create("tab-guardian", { periodInMinutes: 5 });
  await injectIntoExistingTabs();
  console.log(`${LOG} 🚀 onInstalled setup complete`);
});

// Re-create the keep-alive alarm on every service worker startup
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keep-alive", { periodInMinutes: 0.4 });
  chrome.alarms.create("tab-guardian", { periodInMinutes: 5 });
});

// Heartbeat: fires every ~24s to prevent Chrome from killing the service worker
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep-alive") {
    console.log(`${LOG} 💓 keep-alive ping`);
  }
  if (alarm.name === "tab-guardian") {
    checkAndRestoreProlificTab().catch((err) =>
      console.warn(`${LOG} ❌ Tab guardian error:`, err),
    );
  }
});

/** The exact URL the Tab Guardian watches for. */
const PROLIFIC_STUDIES_URL = "https://app.prolific.com/studies";

/**
 * Every 5 minutes, check if a tab is open on the studies page.
 * If not: close all other tabs and open a fresh one on the studies URL.
 * Plays a chime if the tab was restored and the sound is enabled.
 */
async function checkAndRestoreProlificTab(): Promise<void> {
  const guardianEnabled = await getTabGuardianEnabled();
  if (!guardianEnabled) return;

  console.log(`${LOG} 🛡️ Tab Guardian: checking for studies tab...`);

  const allTabs = await chrome.tabs.query({});
  const studiesTabs = allTabs.filter(
    (t) =>
      t.url === PROLIFIC_STUDIES_URL || t.url === PROLIFIC_STUDIES_URL + "/",
  );

  if (studiesTabs.length > 0) {
    console.log(`${LOG} 🛡️ Tab Guardian: studies tab found, nothing to do`);
    return;
  }

  console.log(
    `${LOG} 🛡️ Tab Guardian: no studies tab found — opening studies tab in background`,
  );

  // Find the currently focused tab so we keep it and return focus to it
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const activeTabId = activeTab?.id;

  // Open the Prolific tab in the background (active: false) so the user
  // is not pulled away from what they are doing. Chrome still loads the
  // page fully, so the content script will run and detect studies.
  const newTab = await chrome.tabs.create({
    url: PROLIFIC_STUDIES_URL,
    active: false,
  });
  console.log(
    `${LOG} 🛡️ Tab Guardian: opened background tab ${newTab.id} → ${PROLIFIC_STUDIES_URL}`,
  );

  // Close every tab that is neither the currently active tab nor the new one
  const tabsToClose = allTabs
    .map((t) => t.id)
    .filter(
      (id): id is number =>
        id !== undefined && id !== activeTabId && id !== newTab.id,
    );

  if (tabsToClose.length > 0) {
    await chrome.tabs.remove(tabsToClose);
    console.log(
      `${LOG} 🛡️ Tab Guardian: closed ${tabsToClose.length} other tab(s)`,
    );
  }

  // Wait for the tab to finish loading, then verify it landed on the right page
  const finalUrl = await waitForTabLoad(newTab.id!, 15_000);
  const normalised = finalUrl?.replace(/\/$/, "");
  if (normalised !== PROLIFIC_STUDIES_URL) {
    console.warn(
      `${LOG} ⚠️ Tab Guardian: tab did not land on studies page — actual URL: ${finalUrl}`,
    );
    await notifyTabGuardianWrongPage(finalUrl ?? "(unknown)").catch((err) =>
      console.warn(`${LOG} ❌ Could not send wrong-page Telegram alert:`, err),
    );
  } else {
    console.log(`${LOG} 🛡️ Tab Guardian: tab confirmed on studies page ✅`);
  }

  // Play chime if the sound is enabled
  const beepEnabled = await getTabGuardianBeepEnabled();
  if (beepEnabled) {
    await playReopenedViaOffscreen();
  }
}

/**
 * Wait for a tab to reach status "complete" and return its final URL.
 * Resolves early if the tab is already complete.
 * Falls back to chrome.tabs.get after the timeout.
 */
function waitForTabLoad(
  tabId: number,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      // Fallback: read whatever URL the tab has right now
      try {
        const tab = await chrome.tabs.get(tabId);
        resolve(tab.url);
      } catch {
        resolve(undefined);
      }
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: { status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab.url);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log(
    `${LOG} 📨 Message received: type=${message.type}`,
    message.type === "STUDY_DETECTED" || message.type === "STUDY_REAPPEARED"
      ? `study="${message.study?.title}"`
      : message.type === "STUDIES_SUMMARY" ||
          message.type === "STUDIES_REAPPEARED_SUMMARY"
        ? `count=${message.summary?.totalNew}`
        : "",
  );

  if (message.type === "STUDY_DETECTED") {
    handleStudyDetected(message.study)
      .then((result) => {
        console.log(
          `${LOG} 📤 Study handled, responding:`,
          JSON.stringify(result),
        );
        sendResponse(result);
      })
      .catch((error) => {
        console.error(`${LOG} ❌ Study handling error:`, error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "STUDY_REAPPEARED") {
    handleStudyReappeared(message.study)
      .then((result) => {
        console.log(
          `${LOG} 📤 Reappeared study handled, responding:`,
          JSON.stringify(result),
        );
        sendResponse(result);
      })
      .catch((error) => {
        console.error(`${LOG} ❌ Reappeared study handling error:`, error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "STUDIES_SUMMARY") {
    handleStudiesSummary(message.summary)
      .then((result) => {
        console.log(
          `${LOG} 📤 Summary handled, responding:`,
          JSON.stringify(result),
        );
        sendResponse(result);
      })
      .catch((error) => {
        console.error(`${LOG} ❌ Summary handling error:`, error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "STUDIES_REAPPEARED_SUMMARY") {
    handleStudiesReappearedSummary(message.summary)
      .then((result) => {
        console.log(
          `${LOG} 📤 Reappeared summary handled, responding:`,
          JSON.stringify(result),
        );
        sendResponse(result);
      })
      .catch((error) => {
        console.error(`${LOG} ❌ Reappeared summary handling error:`, error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }
});

// ── Message handlers ────────────────────────────────────────────────────────

interface StudyPayload {
  title: string;
  reward: string;
  completionTime?: string | null;
  places?: string | null;
  url: string;
  postedAt: string;
  mobileSupported: boolean;
}

interface SummaryStudyPayload {
  title: string;
  reward: string;
  completionTime?: string | null;
  places?: string | null;
  url: string;
  mobileSupported: boolean;
}

interface SummaryPayload {
  totalNew: number;
  topStudies: SummaryStudyPayload[];
}

/**
 * Handle a new study detected by the content script.
 */
async function handleStudyDetected(study: StudyPayload) {
  console.log(
    `${LOG} 📋 handleStudyDetected(): "${study.title}" — ${study.reward}`,
  );
  const extensionId = await getExtensionId();

  console.log(`${LOG} 📋 Calling /api/notify-study for "${study.title}"...`);
  const response = await notifyStudy(extensionId, study);
  console.log(
    `${LOG} 📋 notify-study response: success=${response.success}, deduplicated=${response.data?.deduplicated}`,
  );

  if (response.success && !response.data?.deduplicated) {
    console.log(`${LOG} 🔔 Showing Chrome notification for "${study.title}"`);
    chrome.notifications.create(`study-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "New Prolific Study!",
      message: `${study.title} — ${study.reward}`,
    });

    const beepOn = await getBeepEnabled();
    if (beepOn) {
      await playBeepViaOffscreen();
    }
  } else if (response.data?.deduplicated) {
    console.log(
      `${LOG} ♻️ Study "${study.title}" was deduplicated server-side`,
    );
  }

  return response;
}

/**
 * Handle a re-appeared study.
 */
async function handleStudyReappeared(study: StudyPayload) {
  console.log(
    `${LOG} 🔄 handleStudyReappeared(): "${study.title}" — ${study.reward}`,
  );
  const extensionId = await getExtensionId();

  const response = await notifyStudyReappeared(extensionId, study);
  console.log(
    `${LOG} 🔄 notify-study (reappeared) response: success=${response.success}`,
  );

  if (response.success) {
    console.log(
      `${LOG} 🔔 Showing Chrome notification for re-appeared "${study.title}"`,
    );
    chrome.notifications.create(`study-reappeared-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "🔄 Study Re-appeared!",
      message: `${study.title} — ${study.reward}`,
    });

    const beepOn = await getBeepEnabled();
    if (beepOn) {
      await playBeepViaOffscreen();
    }
  }

  return response;
}

/**
 * Handle a batch summary of new studies.
 */
async function handleStudiesSummary(summary: SummaryPayload) {
  console.log(
    `${LOG} 📊 handleStudiesSummary(): ${summary.totalNew} studies, top ${summary.topStudies.length} included`,
  );
  const extensionId = await getExtensionId();

  const response = await notifySummary(extensionId, summary);
  console.log(`${LOG} 📊 notify-summary response: success=${response.success}`);

  if (response.success) {
    const bestTitle = summary.topStudies[0]?.title ?? "N/A";
    const bestReward = summary.topStudies[0]?.reward ?? "";
    chrome.notifications.create(`studies-summary-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "📊 New Studies Available!",
      message: `${summary.totalNew} new studies. Best: ${bestTitle} — ${bestReward}`,
    });

    const beepOn = await getBeepEnabled();
    if (beepOn) {
      await playBeepViaOffscreen();
    }
  }

  return response;
}

/**
 * Handle a batch summary of re-appeared studies.
 */
async function handleStudiesReappearedSummary(summary: SummaryPayload) {
  console.log(
    `${LOG} 📊 handleStudiesReappearedSummary(): ${summary.totalNew} studies, top ${summary.topStudies.length} included`,
  );
  const extensionId = await getExtensionId();

  const response = await notifyReappearedSummary(extensionId, summary);
  console.log(
    `${LOG} 📊 notify-summary (reappeared) response: success=${response.success}`,
  );

  if (response.success) {
    const bestTitle = summary.topStudies[0]?.title ?? "N/A";
    const bestReward = summary.topStudies[0]?.reward ?? "";
    chrome.notifications.create(`studies-reappeared-summary-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "🔄 Re-appeared Studies!",
      message: `${summary.totalNew} re-appeared studies. Best: ${bestTitle} — ${bestReward}`,
    });

    const beepOn = await getBeepEnabled();
    if (beepOn) {
      await playBeepViaOffscreen();
    }
  }

  return response;
}
