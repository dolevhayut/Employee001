import Link from "next/link";
import { cardStyle, Heading } from "@/components/auth/auth-ui";

// Accounts are created by the workspace's admins (Settings → Users), or on
// first sign-in through the company's identity provider when SSO is set up.
export default function SignupPage() {
  return (
    <div style={cardStyle}>
      <Heading title="Ask an admin for an account" sub="Employee001 accounts are created by the admins of this workspace. If your company uses single sign-on, you can sign in with it directly." />
      <Link href="/login" className="btn primary lg" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>Go to sign-in</Link>
    </div>
  );
}
