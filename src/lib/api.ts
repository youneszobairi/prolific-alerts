import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../config.js";

const LOG = "[Prolific Alerts][API]";

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

async function sendTelegramMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  console.log(`${LOG} ➔ Telegram sendMessage`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${error}`);
  }
}

function formatStudyNotification(study: StudyPayload): string {
  const lines = [`🔬 <b>New Study Available!</b>`, ``];
  lines.push(`💰 <b>Reward:</b> ${study.reward}`);
  if (study.completionTime)
    lines.push(`⏱ <b>Time:</b> ${study.completionTime}`);
  if (study.places) lines.push(`👥 <b>Places:</b> ${study.places}`);
  lines.push(`📋 <b>Title:</b> ${study.title}`);
  if (study.mobileSupported)
    lines.push(`📱 <b>Mobile supported</b> — <a href="${study.url}">open</a>`);
  return lines.join("\n");
}

function formatStudyReappeared(study: StudyPayload): string {
  const lines = [`🔄 <b>Study Re-appeared!</b>`, ``];
  lines.push(`💰 <b>Reward:</b> ${study.reward}`);
  if (study.completionTime)
    lines.push(`⏱ <b>Time:</b> ${study.completionTime}`);
  if (study.places) lines.push(`👥 <b>Places:</b> ${study.places}`);
  lines.push(`📋 <b>Title:</b> ${study.title}`);
  if (study.mobileSupported)
    lines.push(`📱 <b>Mobile supported</b> — <a href="${study.url}">open</a>`);
  return lines.join("\n");
}

function formatSummary(payload: SummaryPayload, reappeared = false): string {
  const lines = [
    reappeared
      ? `🔄 <b>${payload.totalNew} Re-appeared Studies Available!</b>`
      : `📊 <b>${payload.totalNew} New Studies Available!</b>`,
    ``,
  ];
  for (let i = 0; i < payload.topStudies.length; i++) {
    const study = payload.topStudies[i]!;
    if (i > 0) lines.push(``);
    lines.push(`💰 ${study.reward}`);
    if (study.completionTime) lines.push(`⏱ ${study.completionTime}`);
    if (study.places) lines.push(`👥 ${study.places}`);
    lines.push(`📋 ${study.title}`);
    if (study.mobileSupported)
      lines.push(`📱 Mobile supported — <a href="${study.url}">open</a>`);
  }
  const remaining = payload.totalNew - payload.topStudies.length;
  if (remaining > 0) {
    lines.push(``);
    lines.push(`<i>…and ${remaining} more</i>`);
  }
  return lines.join("\n");
}

export async function notifyStudy(_extensionId: string, study: StudyPayload) {
  console.log(`${LOG} 📢 notifyStudy() — "${study.title}" (${study.reward})`);
  await sendTelegramMessage(formatStudyNotification(study));
  return { success: true, data: { deduplicated: false } };
}

export async function notifyStudyReappeared(
  _extensionId: string,
  study: StudyPayload,
) {
  console.log(`${LOG} 🔄 notifyStudyReappeared() — "${study.title}"`);
  await sendTelegramMessage(formatStudyReappeared(study));
  return { success: true, data: { deduplicated: false } };
}

export async function notifySummary(
  _extensionId: string,
  summary: SummaryPayload,
) {
  console.log(`${LOG} 📊 notifySummary() — ${summary.totalNew} studies`);
  await sendTelegramMessage(formatSummary(summary, false));
  return { success: true };
}

export async function notifyReappearedSummary(
  _extensionId: string,
  summary: SummaryPayload,
) {
  console.log(
    `${LOG} 📊 notifyReappearedSummary() — ${summary.totalNew} studies`,
  );
  await sendTelegramMessage(formatSummary(summary, true));
  return { success: true };
}

export async function notifyTabGuardianWrongPage(
  actualUrl: string,
): Promise<void> {
  console.log(
    `${LOG} ⚠️ notifyTabGuardianWrongPage() — landed on: ${actualUrl}`,
  );
  const text = [
    `⚠️ <b>Tab Guardian — mauvaise page détectée</b>`,
    ``,
    `L'onglet Prolific ne s'est pas ouvert sur la bonne page.`,
    ``,
    `📍 <b>Page actuelle :</b> <code>${actualUrl}</code>`,
    `✅ <b>Page attendue :</b> <code>https://app.prolific.com/studies</code>`,
    ``,
    `<i>Vous êtes peut-être déconnecté ou en cours d'étude.</i>`,
  ].join("\n");
  await sendTelegramMessage(text);
}
