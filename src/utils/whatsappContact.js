import { toE164Phone } from "./phoneE164";

/**
 * WHATSAPP-USERNAME-01 — a customer's WhatsApp USERNAME is a contact
 * identifier of its own, stored in `customers/{id}.whatsappUsername`, next to
 * (never instead of) `phone`. Pure module: no React, no Firestore.
 *
 * A username is never a phone number and never becomes one: it needs at least
 * one letter (so an all-digit cell can't be mistaken for — or later turned
 * into — a number), it is stored in its normalized form (lowercase, no
 * leading "@", no wa.me URL wrapper), and it is matched/deduplicated on that
 * normalized form only. WhatsApp usernames are case-insensitive, hence the
 * lowercasing; no "@" is ever added to the stored value.
 */

/** Zero-width / bidi marks and NBSP that spreadsheets and chat apps sneak into copied text. */
const INVISIBLE = /[\s ​-‏‪-‮⁦-⁩﻿]/g;
const WA_URL_PREFIX = /^(?:https?:\/\/)?(?:www\.)?wa\.me\//i;

export const WHATSAPP_USERNAME_MIN = 3;
export const WHATSAPP_USERNAME_MAX = 35;

/** The comparable/stored form of whatever was typed or pasted; "" for nothing. Never throws. */
export function normalizeWhatsappUsername(raw) {
  let s = String(raw ?? "").replace(INVISIBLE, "");
  if (!s) return "";
  // A pasted wa.me link is reduced to the username in it; a bare value is never truncated (so "a/b" stays invalid).
  if (WA_URL_PREFIX.test(s)) s = s.replace(WA_URL_PREFIX, "").replace(/[/?#].*$/, "");
  s = s.replace(/^@+/, "");
  return s.toLowerCase();
}

/**
 * Validates ONE username. Result: { status: "empty" } for nothing,
 * { status: "ok", normalized } or { status: "invalid", normalized, why } with
 * why in: too_short | too_long | invalid_characters | no_letter | bad_period.
 * Rules: a-z 0-9 "." "_" only, 3–35 characters, at least one letter, and
 * periods may not lead, trail, or repeat.
 */
export function parseWhatsappUsername(raw) {
  const normalized = normalizeWhatsappUsername(raw);
  if (!normalized) return { status: "empty", normalized: "" };
  const bad = (why) => ({ status: "invalid", normalized, why });
  if (!/^[a-z0-9._]+$/.test(normalized)) return bad("invalid_characters");
  if (normalized.length < WHATSAPP_USERNAME_MIN) return bad("too_short");
  if (normalized.length > WHATSAPP_USERNAME_MAX) return bad("too_long");
  if (!/[a-z]/.test(normalized)) return bad("no_letter");
  if (normalized.startsWith(".") || normalized.endsWith(".") || normalized.includes("..")) return bad("bad_period");
  return { status: "ok", normalized };
}

/** `https://wa.me/<username>` for a valid username, else null. The ONLY place this link format is built. */
export function whatsappUsernameLink(raw) {
  const p = parseWhatsappUsername(raw);
  return p.status === "ok" ? `https://wa.me/${p.normalized}` : null;
}

/** `https://wa.me/<international digits>` for a phone the CRM can dial, else null. Same result the pages built inline before. */
export function whatsappPhoneLink(phone) {
  const e164 = toE164Phone(phone);
  return e164 ? `https://wa.me/${e164.replace("+", "")}` : null;
}

/**
 * Everything a row needs to render a customer's contact actions:
 * { phone, e164, phoneLink, username, usernameLink } — each piece null when
 * the customer doesn't have it, so "neither" renders no WhatsApp link at all.
 */
export function customerContactTargets(customer) {
  const phone = String(customer?.phone || "").trim() || null;
  const e164 = phone ? toE164Phone(phone) : null;
  const parsed = parseWhatsappUsername(customer?.whatsappUsername);
  const username = parsed.status === "ok" ? parsed.normalized : null;
  return {
    phone, e164,
    phoneLink: phone ? whatsappPhoneLink(phone) : null,
    username,
    usernameLink: username ? whatsappUsernameLink(username) : null,
  };
}

/** True when a free-text search query matches the customer's username ("@ahmed" and "ahmed" both work). */
export function matchesWhatsappUsernameQuery(customer, query) {
  const q = normalizeWhatsappUsername(query);
  if (!q) return false;
  return normalizeWhatsappUsername(customer?.whatsappUsername).includes(q);
}
