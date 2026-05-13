import type { CSSProperties } from "react";
import { BrandLogos } from "@/components/ex/icons";

export type LogoProps = { size?: number; color?: string; className?: string; style?: CSSProperties };

export const GmailLogo = BrandLogos.Gmail;
export const SlackLogo = BrandLogos.Slack;
export const GitHubLogo = BrandLogos.GitHub;
export const ZoomLogo = BrandLogos.Zoom;
export const OutlookLogo = BrandLogos.Outlook;
export const LinearLogo = BrandLogos.Linear;
export const JiraLogo = BrandLogos.Jira;
export const MeetLogo = BrandLogos.Meet;

// Back-compat: existing callers use lowercase ids.
export const BRAND_LOGOS = {
  gmail: GmailLogo,
  slack: SlackLogo,
  github: GitHubLogo,
  zoom: ZoomLogo,
  outlook: OutlookLogo,
  linear: LinearLogo,
  jira: JiraLogo,
  meet: MeetLogo,
} as const;
