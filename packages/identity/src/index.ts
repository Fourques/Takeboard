import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const scryptParameters = { N: 2 ** 15, r: 8, p: 3, maxmem: 160 * 1024 * 1024 } as const;
const commonPasswords = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "takeboard123",
  "admin123456",
  "iloveyou1234",
]);

export function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase("en-US");
}

export function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function csrfForSessionToken(token: string) {
  return createHash("sha256").update("takeboard-csrf\0").update(token).digest("base64url");
}

export function validatePassword(password: string) {
  if (password.length < 12) return "密码至少需要 12 个字符，推荐使用便于记忆的长口令";
  if (password.length > 256 || Buffer.byteLength(password, "utf8") > 1_024) {
    return "密码不能超过 256 个字符";
  }
  if (commonPasswords.has(password.toLocaleLowerCase("en-US"))) {
    return "这个密码过于常见，请换一个长口令";
  }
  return null;
}

export function hashPassword(password: string) {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, scryptParameters);
  return `scrypt$${scryptParameters.N}$${scryptParameters.r}$${scryptParameters.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string) {
  if (password.length > 256 || Buffer.byteLength(password, "utf8") > 1_024) return false;
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !saltValue || !hashValue) {
    return false;
  }
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (N < 2 ** 14 || N > 2 ** 18 || r < 1 || r > 16 || p < 1 || p > 10) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
