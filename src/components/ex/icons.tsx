import type { CSSProperties, ReactNode, SVGProps } from "react";
import {
  HomeSimple,
  PlugTypeC,
  Page,
  Sparks,
  Strategy,
  List,
  MailIn,
  Settings,
  Check,
  CheckCircle,
  Xmark,
  ArrowRight,
  ArrowDown,
  NavArrowRight,
  NavArrowLeft,
  Plus,
  Lock,
  Refresh,
  Search,
  Bell,
  Flash,
  Brain,
  Database,
  Clock,
  Eye,
  EditPencil,
  Filter,
  Hashtag,
  Group,
  SoundHigh,
  SoundOff,
  RefreshDouble,
  Microphone,
  Shop,
  UserPlus,
  Activity,
  Coins,
  Trash,
} from "iconoir-react";

type IcoProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
};

function toI(p: IcoProps): SVGProps<SVGSVGElement> {
  return {
    width: p.size ?? 14,
    height: p.size ?? 14,
    className: p.className ?? "ico",
    style: p.style,
    strokeWidth: p.strokeWidth ?? 1.5,
  };
}

export const Icons = {
  Home: (p: IcoProps) => <HomeSimple {...toI(p)} />,
  Plug: (p: IcoProps) => <PlugTypeC {...toI(p)} />,
  Doc: (p: IcoProps) => <Page {...toI(p)} />,
  Spark: (p: IcoProps) => <Sparks {...toI(p)} />,
  Flow: (p: IcoProps) => <Strategy {...toI(p)} />,
  Logs: (p: IcoProps) => <List {...toI(p)} />,
  Inbox: (p: IcoProps) => <MailIn {...toI(p)} />,
  Settings: (p: IcoProps) => <Settings {...toI(p)} />,
  Check: (p: IcoProps) => <Check {...toI(p)} />,
  CheckCircle: (p: IcoProps) => <CheckCircle {...toI(p)} />,
  X: (p: IcoProps) => <Xmark {...toI(p)} />,
  Arrow: (p: IcoProps) => <ArrowRight {...toI(p)} />,
  ArrowDown: (p: IcoProps) => <ArrowDown {...toI(p)} />,
  Chevron: (p: IcoProps) => <NavArrowRight {...toI(p)} />,
  ChevronLeft: (p: IcoProps) => <NavArrowLeft {...toI(p)} />,
  Plus: (p: IcoProps) => <Plus {...toI(p)} />,
  Lock: (p: IcoProps) => <Lock {...toI(p)} />,
  Refresh: (p: IcoProps) => <Refresh {...toI(p)} />,
  Search: (p: IcoProps) => <Search {...toI(p)} />,
  Bell: (p: IcoProps) => <Bell {...toI(p)} />,
  Zap: (p: IcoProps) => <Flash {...toI(p)} />,
  Bot: (p: IcoProps) => <Brain {...toI(p)} />,
  Database: (p: IcoProps) => <Database {...toI(p)} />,
  Clock: (p: IcoProps) => <Clock {...toI(p)} />,
  Eye: (p: IcoProps) => <Eye {...toI(p)} />,
  Pencil: (p: IcoProps) => <EditPencil {...toI(p)} />,
  Filter: (p: IcoProps) => <Filter {...toI(p)} />,
  Slack: (p: IcoProps) => <Hashtag {...toI(p)} />,
  Sparkle2: (p: IcoProps) => <Sparks {...toI(p)} />,
  Team: (p: IcoProps) => <Group {...toI(p)} />,
  Volume: (p: IcoProps) => <SoundHigh {...toI(p)} />,
  VolumeOff: (p: IcoProps) => <SoundOff {...toI(p)} />,
  Loader: (p: IcoProps) => <RefreshDouble {...toI(p)} />,
  Mic: (p: IcoProps) => <Microphone {...toI(p)} />,
  Store: (p: IcoProps) => <Shop {...toI(p)} />,
  UserPlus: (p: IcoProps) => <UserPlus {...toI(p)} />,
  Activity: (p: IcoProps) => <Activity {...toI(p)} />,
  DollarSign: (p: IcoProps) => <Coins {...toI(p)} />,
  Trash: (p: IcoProps) => <Trash {...toI(p)} />,
};

export type IconName = keyof typeof Icons;

// -----------------------------------------------------------------------------
// Inline SVG icons (brand + compact glyphs)
// Centralized here so the app doesn't scatter raw <svg> snippets across pages.
// -----------------------------------------------------------------------------

type BrandLogoProps = {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

function BrandLogo({
  size = 48,
  color = "#0A0A0A",
  className,
  style,
  children,
  viewBox = "0 0 24 24",
}: BrandLogoProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {children}
    </svg>
  );
}

export const BrandLogos = {
  Gmail: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.146C21.69 2.28 24 3.434 24 5.457z" />
    </BrandLogo>
  ),
  Slack: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.123 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.123a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </BrandLogo>
  ),
  GitHub: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </BrandLogo>
  ),
  Zoom: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12zm-5.5-3.5H7.862C6.834 8.5 6 9.334 6 10.362v3.877c0 .38.308.688.688.688H16.5c1.028 0 1.862-.834 1.862-1.862v-2.69a.688.688 0 0 0-.688-.687zm3.438.688L19.25 11v2l2.688 2.313c.196.169.062.437-.188.437V9.25c0-.25.39-.319.188-.062z" />
    </BrandLogo>
  ),
  Outlook: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M24 7.387v10.478L19.2 14.4l-5.4 3.787V8.013l5.4 3.774L24 7.387ZM13.8 6h8.85L13.8 11.212V6ZM0 4.35l12 2.137v11.026L0 19.65V4.35ZM6.337 15.293c1.564 0 2.595-1.26 2.595-3.293 0-2.009-1.019-3.233-2.57-3.233-1.577 0-2.612 1.256-2.612 3.27 0 2.052 1.022 3.256 2.587 3.256Zm.025-5.347c.87 0 1.385.826 1.385 2.082 0 1.272-.52 2.086-1.397 2.086-.885 0-1.4-.807-1.4-2.086 0-1.269.51-2.082 1.412-2.082Z" />
    </BrandLogo>
  ),
  Linear: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M4.222 21.778a.75.75 0 0 1-.067-1.058l14.303-14.303a.75.75 0 0 1 1.058 1.058L5.213 21.778a.75.75 0 0 1-.99 0zM2.25 18.5l3.25 3.25A12 12 0 0 1 2.25 18.5zM5.75 4.998 19.002 18.25A12 12 0 0 0 5.75 4.998zM2.143 13.857l8 8A12.03 12.03 0 0 1 2 12c0-.05.001-.1.002-.15l8.148 8.148L2.143 13.857z" />
    </BrandLogo>
  ),
  Jira: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.004-1.005zm5.723-5.756H5.757a5.215 5.215 0 0 0 5.214 5.214h2.141v2.07a5.216 5.216 0 0 0 5.214 5.215V6.758a1.001 1.001 0 0 0-1.032-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.485V1.005A1.001 1.001 0 0 0 23.013 0z" />
    </BrandLogo>
  ),
  Meet: (p: BrandLogoProps) => (
    <BrandLogo {...p}>
      <path d="M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12zm-6.521-5.214h-8.07C8.19 6.786 7.5 7.476 7.5 8.319v5.357c0 .843.69 1.538 1.538 1.538h.321v1.607c0 .214.262.321.406.167l1.96-1.774h3.754c.848 0 1.538-.69 1.538-1.538V8.32c0-.843-.69-1.533-1.538-1.533zm3.428 2.345l-2.357 1.476v2.786l2.357 1.476c.214.131.536-.024.536-.262V9.393c0-.238-.322-.393-.536-.262z" />
    </BrandLogo>
  ),
} as const;

export type BrandLogoId = keyof typeof BrandLogos;

type GlyphProps = {
  size?: number;
  bg?: string;
  fg?: string;
  className?: string;
  style?: CSSProperties;
};

function Glyph({
  children,
  size = 28,
  bg = "var(--bg-sunken)",
  fg = "var(--text)",
  className,
  style,
}: GlyphProps & { children: ReactNode }) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: bg,
        color: fg,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        border: "1px solid var(--hairline)",
        ...style,
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

export const Glyphs = {
  outlook: (p: GlyphProps) => (
    <Glyph {...p}>
      <rect x="2" y="3.5" width="9" height="9" rx="1" />
      <path d="M2 6l4.5 3L11 6" />
      <path d="M11 6h3v6h-3" />
    </Glyph>
  ),
  gmail: (p: GlyphProps) => (
    <Glyph {...p}>
      <path d="M2 4h12v8H2z" />
      <path d="M2 4l6 5 6-5" />
    </Glyph>
  ),
  teams: (p: GlyphProps) => (
    <Glyph {...p}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="11" cy="7" r="1.5" />
      <path d="M2.5 13c.5-2 2-3 3.5-3s3 1 3.5 3" />
      <path d="M9.5 13c.3-1.5 1.2-2.5 2.3-2.5" />
    </Glyph>
  ),
  meet: (p: GlyphProps) => (
    <Glyph {...p}>
      <rect x="2" y="5" width="8" height="6" rx="1" />
      <path d="M10 7l4-2v6l-4-2" />
    </Glyph>
  ),
  zoom: (p: GlyphProps) => (
    <Glyph {...p}>
      <rect x="2" y="5" width="8" height="6" rx="2" />
      <path d="M10 7.5l4-2v5l-4-2" />
    </Glyph>
  ),
  slack: (p: GlyphProps) => (
    <Glyph {...p}>
      <rect x="2" y="6.5" width="3" height="3" rx=".5" />
      <rect x="6.5" y="2" width="3" height="3" rx=".5" />
      <rect x="11" y="6.5" width="3" height="3" rx=".5" />
      <rect x="6.5" y="11" width="3" height="3" rx=".5" />
    </Glyph>
  ),
  github: (p: GlyphProps) => (
    <Glyph {...p}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6 13.5v-1.5c-1.5 0-2-1-2-1.5M10 13.5v-2c0-.5 0-1-.5-1.5 1.5 0 2.5-1 2.5-2.5 0-.6-.2-1.1-.5-1.5.1-.4.1-1-.1-1.5 0 0-.5 0-1.5.7-.5-.1-1-.2-1.5-.2s-1 .1-1.5.2C5 3.7 4.5 3.7 4.5 3.7c-.2.5-.2 1.1-.1 1.5-.3.4-.5.9-.5 1.5 0 1.5 1 2.5 2.5 2.5-.3.3-.4.7-.5 1.2" />
    </Glyph>
  ),
  linear: (p: GlyphProps) => (
    <Glyph {...p}>
      <path d="M3 9l4 4M3 6l7 7M3 3l10 10M6 3l7 7M9 3l4 4" />
    </Glyph>
  ),
  jira: (p: GlyphProps) => (
    <Glyph {...p}>
      <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8 8 1.5Z" />
      <path d="M8 4.5L11.5 8 8 11.5 4.5 8 8 4.5Z" />
    </Glyph>
  ),
  sharepoint: (p: GlyphProps) => (
    <Glyph {...p} bg="#e8f0fe" fg="#0078d4">
      <rect x="2" y="5" width="9" height="8" rx="1" />
      <path d="M8 3h5v9h-2" />
      <path d="M5 8h5M5 10.5h5" />
    </Glyph>
  ),
  onedrive: (p: GlyphProps) => (
    <Glyph {...p} bg="#e8f0fe" fg="#0078d4">
      <path d="M2 10.5c0-1.5 1-2.5 2.5-2.5.2 0 .5 0 .7.1C5.5 6.5 6.8 5.5 8.5 5.5c2 0 3.5 1.5 3.5 3.5 0 .2 0 .4-.1.5H14c0-2.5-2-4.5-4.5-4.5-.8 0-1.5.2-2.1.6C6.8 4.5 5.7 4 4.5 4 2.6 4 1 5.6 1 7.5c0 .4.1.7.2 1" />
      <path d="M1.5 11.5h13" />
    </Glyph>
  ),
  loop: (p: GlyphProps) => (
    <Glyph {...p} bg="#f0e8fe" fg="#7719aa">
      <path d="M8 3c-3 0-5 2-5 5s2 5 5 5" />
      <path d="M8 3c2.5 0 5 1.5 5 4s-2.5 4-5 4" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  planner: (p: GlyphProps) => (
    <Glyph {...p} bg="#e8f5fe" fg="#0097fb">
      <rect x="2" y="4" width="5.5" height="4" rx="1" />
      <rect x="8.5" y="4" width="5.5" height="4" rx="1" />
      <rect x="2" y="9.5" width="5.5" height="2.5" rx="1" />
      <rect x="8.5" y="9.5" width="5.5" height="2.5" rx="1" />
    </Glyph>
  ),
} as const;

export type GlyphId = keyof typeof Glyphs;
