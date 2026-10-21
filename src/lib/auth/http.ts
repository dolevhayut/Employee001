// Helpers shared by the /api/auth routes.

import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_MS } from "./store";

export function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local").slice(0, 64);
}

export function isHttps(request: NextRequest | Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export function setSession(res: NextResponse, value: string, request: Request): void {
  res.cookies.set({ name: SESSION_COOKIE, value, httpOnly: true, sameSite: "lax", secure: isHttps(request), path: "/", maxAge: Math.floor(SESSION_MAX_MS / 1000) });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function isLoopbackBind(): boolean {
  const v = process.env.EMPLOYEE001_BIND?.trim();
  return !v || v === "127.0.0.1" || v === "::1" || v === "localhost";
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
