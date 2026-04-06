import "dotenv/config";
import crypto from "node:crypto";
import { getAdminPasswordHash, setAdminPasswordHash } from "./store.js";

const SESSION_COOKIE_NAME = "lpmc_admin_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const SESSION_SECRET = process.env.SESSION_SECRET ?? "lpmc-scheduler-session-secret";

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";
export const SYSTEM_USERNAME = process.env.SYSTEM_USERNAME ?? "system";
const SYSTEM_PASSWORD = process.env.SYSTEM_PASSWORD ?? "manager";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPasswordHash(password, storedHash) {
  const [salt, expectedHash] = String(storedHash ?? "").split(":");

  if (!salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return safeEqual(actualHash, expectedHash);
}

async function ensureAdminPasswordHash() {
  const existingHash = await getAdminPasswordHash();

  if (existingHash) {
    return existingHash;
  }

  const seededHash = createPasswordHash(DEFAULT_ADMIN_PASSWORD);
  await setAdminPasswordHash(seededHash);
  return seededHash;
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = decodeURIComponent(part.slice(0, separatorIndex));
      const value = decodeURIComponent(part.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function signPayload(encodedPayload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
}

function readSession(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const rawValue = cookies[SESSION_COOKIE_NAME];

  if (!rawValue) {
    return null;
  }

  const [encodedPayload, signature] = rawValue.split(".");

  if (!encodedPayload || !signature || !safeEqual(signPayload(encodedPayload), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    if (!payload?.role || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS,
    path: "/"
  };
}

function clearCookieOptions() {
  const { maxAge, ...options } = cookieOptions();
  return options;
}

export function attachAuth(request, _response, next) {
  request.auth = readSession(request.headers.cookie ?? "");
  next();
}

export function isAdmin(request) {
  return request.auth?.role === "admin";
}

export function isSystem(request) {
  return request.auth?.role === "system";
}

export function setAuthCookie(response, role) {
  const payload = {
    role,
    exp: Date.now() + SESSION_DURATION_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload);

  response.cookie(SESSION_COOKIE_NAME, `${encodedPayload}.${signature}`, cookieOptions());
}

export function clearAuthCookie(response) {
  response.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions());
}

export function getAuthSessionPayload(request) {
  return {
    authenticated: isAdmin(request),
    isSystem: isSystem(request),
    username: isAdmin(request) ? ADMIN_USERNAME : null
  };
}

export async function validateAdminCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string" || username !== ADMIN_USERNAME) {
    return false;
  }

  const passwordHash = await ensureAdminPasswordHash();
  return verifyPasswordHash(password, passwordHash);
}

export function validateSystemCredentials(username, password) {
  if (
    !SYSTEM_USERNAME ||
    !SYSTEM_PASSWORD ||
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return false;
  }

  return username === SYSTEM_USERNAME && safeEqual(password, SYSTEM_PASSWORD);
}

export async function updateAdminPassword(newPassword) {
  const nextHash = createPasswordHash(newPassword);
  await setAdminPasswordHash(nextHash);
}

export async function validateCurrentAdminPassword(password) {
  if (typeof password !== "string") {
    return false;
  }

  const passwordHash = await ensureAdminPasswordHash();
  return verifyPasswordHash(password, passwordHash);
}
