import type { Role } from "./domain";

export function safeReturnPath(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (value === "/dashboard" || value.startsWith("/dashboard/")) return value;
  return "/dashboard";
}

export function roleHomePath(role: Role) {
  return role === "admin" ? "/dashboard/admin"
    : role === "manager" ? "/dashboard/manager" : "/dashboard";
}

export function roleReturnPath(role: Role, value: unknown) {
  const path = safeReturnPath(value);
  if (role === "admin" || role === "manager") return roleHomePath(role);
  return path === "/dashboard" ||
    /^\/dashboard\/assignments\/[0-9a-f-]{36}$/i.test(path)
    ? path : "/dashboard";
}
