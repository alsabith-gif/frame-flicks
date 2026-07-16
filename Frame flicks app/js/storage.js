// storage.js — single source of truth for every localStorage key.
// No other module should call localStorage directly.
//
// Reads/writes stay synchronous and localStorage-backed exactly as before —
// every page module is untouched. The only addition is that fbSave now also
// queues a background push to Supabase (see cloud.js) so the same data
// syncs to your other devices.

import { pushToCloud } from './cloud.js';

const KEYS = {
  prospects: 've_ct_prospects',
  groups: 've_ct_groups',
  aiResults: 've_ct_ai_results',
  addedAi: 've_ct_added_ai',
  goalSettings: 've_ct_goal_settings',
  goalHistory: 've_ct_goal_history',
  income: 've_ct_income',
  scripts: 've_ct_scripts',
  fuSettings: 've_ct_fu_settings',
  fuHistory: 've_ct_fu_history',
  appMode: 've_ct_app_mode',
};

// Generic central save helper — wraps localStorage.setItem + JSON.stringify.
export function fbSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    pushToCloud(key, value);
    return true;
  } catch (e) {
    console.error('fbSave failed', key, e);
    return false;
  }
}

function fbLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('fbLoad failed', key, e);
    return fallback;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export { uid };

/* ---------------- Prospects ---------------- */
export function getProspects() {
  return fbLoad(KEYS.prospects, []);
}
export function saveProspects(list) {
  return fbSave(KEYS.prospects, list);
}

/* ---------------- Groups ---------------- */
export function getGroups() {
  return fbLoad(KEYS.groups, []);
}
export function saveGroups(list) {
  return fbSave(KEYS.groups, list);
}

/* ---------------- AI Finder results ---------------- */
export function getAiResults() {
  return fbLoad(KEYS.aiResults, []);
}
export function saveAiResults(list) {
  return fbSave(KEYS.aiResults, list);
}
export function getAddedAi() {
  return fbLoad(KEYS.addedAi, []);
}
export function saveAddedAi(list) {
  return fbSave(KEYS.addedAi, list);
}

/* ---------------- Daily Goals ---------------- */
export function getGoalSettings() {
  return fbLoad(KEYS.goalSettings, { dms: 15, followups: 10, samples: 2, clients: 1 });
}
export function saveGoalSettings(obj) {
  return fbSave(KEYS.goalSettings, obj);
}
export function getGoalHistory() {
  return fbLoad(KEYS.goalHistory, {});
}
export function saveGoalHistory(obj) {
  return fbSave(KEYS.goalHistory, obj);
}

/* ---------------- Income ---------------- */
export function getIncome() {
  return fbLoad(KEYS.income, []);
}
export function saveIncome(list) {
  return fbSave(KEYS.income, list);
}

/* ---------------- Scripts ---------------- */
export function getScripts() {
  return fbLoad(KEYS.scripts, null); // null triggers default seed in scripts.js
}
export function saveScripts(list) {
  return fbSave(KEYS.scripts, list);
}

/* ---------------- Follow-ups ---------------- */
export function getFuSettings() {
  return fbLoad(KEYS.fuSettings, {
    day1: 3, day2: 7, day3: 14, autoNoReply: 21,
    scripts: {
      1: {
        Friendly: "Hey [Name]! Just following up on my last message 🙂 Would love to help {Niche} creators like you level up your video content. Let me know if you're interested!",
        Professional: "Hi [Name], following up on my previous message regarding video editing support for your [Platform] content. Happy to share samples if useful.",
        Curious: "Hey [Name] — curious if you had a chance to see my last message? Would love to know your thoughts on working together.",
        Urgency: "Hi [Name], I only have a couple of editing slots open this week — wanted to check if you're still interested before they fill up!",
      },
      2: {
        Friendly: "Hey [Name], no worries if you're busy! Just wanted to bump this up in case it got buried 📩 Still happy to send a free sample edit if you'd like to see my work.",
        Professional: "Hi [Name], circling back on this in case it slipped through. I'd be glad to put together a quick sample edit for your [Niche] content.",
        Curious: "Hey [Name], still curious to hear what you think! Any videos coming up I could help edit?",
        Urgency: "Hi [Name], following up once more — my current availability is limited, so wanted to reconnect before it changes.",
      },
      3: {
        Friendly: "Hey [Name], last note from me here! If now isn't the right time, totally understand — feel free to reach out whenever you're ready 🙌",
        Professional: "Hi [Name], this will be my final follow-up for now. Please reach out anytime if you'd like to revisit video editing support.",
        Curious: "Hey [Name], one last check-in — should I close the loop here, or is there still interest?",
        Urgency: "Hi [Name], last chance before I release this slot — let me know if you'd like to move forward!",
      },
    },
  });
}
export function saveFuSettings(obj) {
  return fbSave(KEYS.fuSettings, obj);
}
export function getFuHistory() {
  return fbLoad(KEYS.fuHistory, []);
}
export function saveFuHistory(list) {
  return fbSave(KEYS.fuHistory, list);
}

/* ---------------- App Mode (Outreach vs Client Dashboard) ---------------- */
export function getAppMode() {
  return fbLoad(KEYS.appMode, 'outreach'); // 'outreach' | 'clients'
}
export function saveAppMode(mode) {
  return fbSave(KEYS.appMode, mode);
}
