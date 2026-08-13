import { randomBytes } from "node:crypto";
import { DomainError } from "./errors.js";

const maxUuidTimestamp = 0xffffffffffff;

export function createUuidV7(nowMilliseconds = Date.now()) {
  if (
    !Number.isInteger(nowMilliseconds) ||
    nowMilliseconds < 0 ||
    nowMilliseconds > maxUuidTimestamp
  ) {
    throw new DomainError("INVALID_TIMESTAMP", "UUIDv7 time must be an unsigned 48-bit integer");
  }

  const bytes = randomBytes(16);
  let timestamp = BigInt(nowMilliseconds);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function createTakeBoardId<const Prefix extends string>(
  prefix: Prefix,
  nowMilliseconds = Date.now(),
): `${Prefix}_${string}` {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) {
    throw new DomainError("INVALID_ID_PREFIX", "ID prefixes must use lowercase snake_case");
  }
  return `${prefix}_${createUuidV7(nowMilliseconds)}`;
}

export function toIsoTimestamp(value: Date | number = new Date()) {
  const date = typeof value === "number" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new DomainError("INVALID_TIMESTAMP", "Cannot format an invalid date");
  }
  return date.toISOString();
}
