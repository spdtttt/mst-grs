import { createHmac } from "node:crypto";
export function loginEmail(identifier: string, secret: string) {
  if (secret.length < 32)
    throw new Error("LOGIN_HMAC_SECRET must contain at least 32 characters");
  return `${createHmac("sha256", secret).update(identifier.trim().toLowerCase()).digest("hex")}@login.mst-grs.internal`;
}
export function identityPassword(
  role: string,
  citizenId: string,
  secret: string,
) {
  return (
    createHmac("sha256", secret)
      .update(`password:${role}:${citizenId.trim()}`)
      .digest("base64url") + "aA1!"
  );
}
