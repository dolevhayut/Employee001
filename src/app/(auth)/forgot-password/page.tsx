import Link from "next/link";
import { cardStyle, Heading } from "@/components/auth/auth-ui";

// Self-hosted installs have no email sender for reset links: an admin
// resets the password in Settings → Users (which signs the user out
// everywhere).
export default function ForgotPasswordPage() {
  return (
    <div style={cardStyle}>
      <Heading title="Reset your password" sub="Ask an admin of this workspace to set a new password for you in Settings → Users. If you use single sign-on, reset it with your identity provider." />
      <Link href="/login" className="btn lg" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>Back to sign-in</Link>
    </div>
  );
}
