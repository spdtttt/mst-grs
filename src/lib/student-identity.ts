import { createCipheriv, createHmac, randomBytes } from "node:crypto";

/** Store imported identity data separately from the derived Auth password. */
export function encryptStudentCitizenId(
  citizenId: string,
  studentCode: string,
  secret: string,
) {
  if (
    !/^\d{13}$/.test(citizenId) ||
    !/^\d{5,10}$/.test(studentCode) ||
    secret.length < 32
  )
    throw new Error("Invalid student identity encryption input");
  const key = createHmac("sha256", secret)
    .update("mst-grs:student-citizen:v1")
    .digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`student:${studentCode}`));
  const encrypted = Buffer.concat([
    cipher.update(citizenId, "utf8"),
    cipher.final(),
  ]);
  return `v1:${nonce.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
