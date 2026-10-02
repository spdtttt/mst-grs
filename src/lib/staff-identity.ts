import { createCipheriv, createHmac, randomBytes } from "node:crypto";

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
