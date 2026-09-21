export function safeReturnPath(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (value === "/dashboard" || value.startsWith("/dashboard/")) return value;
  return "/dashboard";
}
