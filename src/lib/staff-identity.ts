import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export function staffCitizenHash(citizenId: string, secret: string) {
  if (!/^\d{13}$/.test(citizenId) || secret.length < 32) throw new Error("Invalid staff identity input");
  return createHmac("sha256", secret).update(`mst-grs:staff-identity:v1:${citizenId}`).digest("hex");
}

export function decryptStaffCitizenId(value: string, profileId: string, secret: string) {
  if (!/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$/.test(value) || secret.length < 32)
    throw new Error("Invalid staff identity ciphertext");
  const [, nonce, tag, encrypted] = value.split(":");
  const key = createHmac("sha256", secret).update("mst-grs:staff-citizen:v1").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "hex"));
  decipher.setAAD(Buffer.from(`staff:${profileId}`));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const citizenId = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]).toString("utf8");
  if (!/^\d{13}$/.test(citizenId)) throw new Error("Invalid staff identity plaintext");
  return citizenId;
}

export function encryptStaffCitizenId(
  citizenId: string,
  profileId: string,
  secret: string,
) {
  if (
    !/^\d{13}$/.test(citizenId) ||
    !/^[0-9a-f-]{36}$/i.test(profileId) ||
    secret.length < 32
  )
    throw new Error("Invalid staff identity encryption input");
  const key = createHmac("sha256", secret)
    .update("mst-grs:staff-citizen:v1")
    .digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`staff:${profileId}`));
  const encrypted = Buffer.concat([
    cipher.update(citizenId, "utf8"),
    cipher.final(),
  ]);
  return `v1:${nonce.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
