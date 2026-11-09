import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.CREDENTIALS_KEY;
  if (!hex || hex.length !== 64) throw new Error("CREDENTIALS_KEY must be set to 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptJson<T>(payload: string): T {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised credentials payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as T;
}
