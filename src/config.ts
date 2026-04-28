/** Telegram bot token — get it from @BotFather */
export const TELEGRAM_BOT_TOKEN =
  "8604250752:AAE5sm7GyyWr06U7aIEK6tKGv7DSDGo788Q";

/** Your personal Telegram chat ID — find it via @userinfobot */
export const TELEGRAM_CHAT_ID = "2026070984";

/** Default minimum reward in GBP that triggers a notification. */
export const DEFAULT_MIN_REWARD_GBP = 0;

/** Default minimum number of available places that triggers a notification. */
export const DEFAULT_MIN_PLACES = 1;

/** Fixed GBP → USD conversion rate. */
export const GBP_TO_USD = 1.35;

/** Storage keys */
export const STORAGE_KEYS = {
  EXTENSION_ID: "extensionInstallId",
  MIN_REWARD: "minRewardGbp",
  NOTIFICATIONS_ENABLED: "notificationsEnabled",
  MIN_PLACES: "minPlaces",
  BEEP_ENABLED: "beepEnabled",
  TAB_GUARDIAN_ENABLED: "tabGuardianEnabled",
  TAB_GUARDIAN_BEEP_ENABLED: "tabGuardianBeepEnabled",
} as const;
