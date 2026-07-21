// clients.js — the single shared Clients list that both Outreach (a Prospect
// marked "Closed") and the Dashboard (a project added manually) feed into.
// Every project links to exactly one client record via clientId, and every
// client carries a `source` (where they came from) regardless of which side
// created them.

import { getClients, saveClients, uid } from './storage.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Looks up a client by name (case-insensitive, trimmed). If none exists yet,
// creates one with the given source. If one already exists but has no
// source on file, backfills it from whatever was just provided — otherwise
// an existing client's source is left alone (first source wins).
export function findOrCreateClient(name, source, extra) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  const list = getClients();
  let client = list.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (!client) {
    client = {
      id: uid(),
      name: trimmed,
      source: source || 'Other',
      createdAt: todayStr(),
      ...(extra || {}),
    };
    list.push(client);
    saveClients(list);
  } else if (!client.source && source) {
    client.source = source;
    saveClients(list);
  }
  return client;
}

export function getClientById(id) {
  if (!id) return null;
  return getClients().find((c) => c.id === id) || null;
}
