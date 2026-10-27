import type { ReactNode } from "react";
import AuthLayout from "../(auth)/layout";

export const metadata = { title: "Approve a sign-in · Employee001" };

export default function DeviceLayout({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
