export type SourceType = "system" | "human";

export type Source = {
  type: SourceType;
  icon: string;
  label: string;
  detail: string;
};

export type ProfileSource = {
  file: string;
  emoji: string;
  title: string;
  accentColor: string;
  sources: Source[];
};

export const PROFILE_SOURCES: ProfileSource[] = [
  {
    file: "EXPERTISE.md",
    emoji: "🧠",
    title: "Technical Expertise",
    accentColor: "#2563EB",
    sources: [
      { type: "system", icon: "github", label: "GitHub", detail: "Repositories touched, languages by commit count, files authored from scratch vs. modified" },
      { type: "system", icon: "git", label: "PR Descriptions", detail: "How she explains what she did and why — reveals architectural understanding" },
      { type: "system", icon: "doc", label: "Confluence / Notion", detail: "Design docs written, RFCs, Architecture Decision Records" },
      { type: "human", icon: "user", label: "Opening question", detail: "\"If a new dev joins the team, what must they know before touching the code?\"" },
      { type: "human", icon: "user", label: "Deep question", detail: "\"What's the most non-obvious thing you learned in the past year?\"" },
    ],
  },
  {
    file: "TONE.md",
    emoji: "🗣️",
    title: "Communication Style",
    accentColor: "#7C3AED",
    sources: [
      { type: "system", icon: "message", label: "Slack Export", detail: "Average message length, emoji usage, response to urgency, how she opens and closes conversations" },
      { type: "system", icon: "git", label: "Code Review Comments", detail: "Tone in GitHub comments — direct? encouraging? explanatory?" },
      { type: "system", icon: "mail", label: "Email threads", detail: "If accessible — phrasing, length, formality" },
      { type: "human", icon: "users", label: "Peer question", detail: "\"If you had to mimic [name] in a Slack message — what would you notice first?\"" },
      { type: "human", icon: "user", label: "Direct question", detail: "\"Write me a reply to a bad PR — without overthinking.\" (execution reveals more than description)" },
    ],
  },
  {
    file: "MOTIVATION.md",
    emoji: "🔥",
    title: "What Drives & Frustrates Her",
    accentColor: "#DC2626",
    sources: [
      { type: "system", icon: "grid", label: "Jira / Linear patterns", detail: "Which ticket types close fast? Which linger? What keeps getting deferred?" },
      { type: "system", icon: "star", label: "GitHub Stars & Forks", detail: "Side projects, starred repos — reveals genuine interests" },
      { type: "human", icon: "user", label: "Peak experience question", detail: "\"Tell me about a project where you felt in flow. What was present that caused it?\"" },
      { type: "human", icon: "user", label: "Friction question", detail: "\"What's the one thing that, if removed, would make you twice as effective?\"" },
      { type: "human", icon: "user", label: "Legacy question", detail: "\"In 3 years, what do you want people to say you influenced?\"" },
    ],
  },
  {
    file: "PHILOSOPHY.md",
    emoji: "🧭",
    title: "Guiding Principles",
    accentColor: "#0F766E",
    sources: [
      { type: "system", icon: "message", label: "Long Slack threads", detail: "Discussions where she took a stance, technical debates, places she didn't back down" },
      { type: "system", icon: "git", label: "PRs she rejected", detail: "Request Changes + explanation — reveals what she won't compromise on" },
      { type: "human", icon: "user", label: "Dilemma question", detail: "\"Describe a time you had to choose between speed and quality. What did you choose and why?\"" },
      { type: "human", icon: "user", label: "Boundary question", detail: "\"What's the one technical thing you'd never do, no matter the pressure?\"" },
      { type: "human", icon: "user", label: "Failure question", detail: "\"What's the biggest mistake you've made and what did you take from it?\"" },
    ],
  },
  {
    file: "INITIATIVES.md",
    emoji: "🚀",
    title: "Initiatives & Changes",
    accentColor: "#D97706",
    sources: [
      { type: "system", icon: "grid", label: "Jira — Epics she opened", detail: "Not tickets assigned to her — tickets she opened on her own initiative" },
      { type: "system", icon: "doc", label: "Confluence — docs she initiated", detail: "RFCs, process change proposals, post-mortems she authored" },
      { type: "system", icon: "message", label: "Slack — messages starting with 'I'd like to propose'", detail: "Pattern search for initiative signals in conversations" },
      { type: "human", icon: "user", label: "Bottleneck question", detail: "\"What's the biggest bottleneck you see in the team/org today?\"" },
      { type: "human", icon: "user", label: "Push question", detail: "\"Give me an example of a change you drove that wouldn't have happened without you.\"" },
    ],
  },
  {
    file: "ARTIFACTS.md",
    emoji: "🏗️",
    title: "Outputs & Work Products",
    accentColor: "#0891B2",
    sources: [
      { type: "system", icon: "github", label: "GitHub — authored files", detail: "Files she primarily authored (git blame), large PRs she led" },
      { type: "system", icon: "doc", label: "Confluence — most viewed pages", detail: "Docs she wrote that many read — what's considered reference material?" },
      { type: "system", icon: "figma", label: "Figma", detail: "Frames she designed, component libraries she built, design reviews she led" },
      { type: "human", icon: "user", label: "Pride question", detail: "\"What's the technical thing you built that you're most proud of? Show me.\"" },
      { type: "human", icon: "user", label: "Impact question", detail: "\"What did you build that the most people use, even if they don't know it's yours?\"" },
    ],
  },
  {
    file: "TECHNICS.md",
    emoji: "⚙️",
    title: "Work Methods",
    accentColor: "#4F46E5",
    sources: [
      { type: "system", icon: "git", label: "PR review patterns", detail: "What does she check first in every PR? What never passes? How long does she take?" },
      { type: "system", icon: "grid", label: "Jira — workflow", detail: "How do tickets flow through her? Does she break into subtasks? Write acceptance criteria?" },
      { type: "system", icon: "message", label: "Slack — responses to problems", detail: "When someone reports a bug — what's the first response? Clarifying questions? Straight to solution?" },
      { type: "human", icon: "user", label: "Debug question", detail: "\"Take a real bug you fixed recently and walk me through exactly how you thought — step by step.\"" },
      { type: "human", icon: "user", label: "Toolbox question", detail: "\"What tools can't you work without? What do you add to a fresh dev environment in the first 10 minutes?\"" },
    ],
  },
  {
    file: "QUESTIONS.md",
    emoji: "❓",
    title: "Recurring Questions",
    accentColor: "#BE185D",
    sources: [
      { type: "system", icon: "message", label: "Slack — threads she started", detail: "Questions she asked publicly — what recurs? What does she always ask before agreeing?" },
      { type: "system", icon: "git", label: "PR Comments — questions", detail: "Comments ending in ? — what does she always want to understand?" },
      { type: "system", icon: "doc", label: "Meeting notes / Confluence", detail: "If meeting records exist — what does she ask in design reviews?" },
      { type: "human", icon: "user", label: "Design review question", detail: "\"Do a quick design review on this system. What are the first things you'd ask?\"" },
      { type: "human", icon: "users", label: "Peer question", detail: "\"What's the question you can always predict [name] will ask in a meeting?\"" },
    ],
  },
  {
    file: "ACHIEVEMENTS.md",
    emoji: "🏆",
    title: "Wins & Crisis Moments",
    accentColor: "#B45309",
    sources: [
      { type: "system", icon: "grid", label: "Jira — resolved critical bugs", detail: "Tickets with Priority: Critical/Blocker closed by her" },
      { type: "system", icon: "github", label: "GitHub — hotfix branches", detail: "Commits to hotfix and production branches at unusual hours" },
      { type: "system", icon: "doc", label: "Post-mortems", detail: "Incident retrospectives she authored — what happened, what she did, what changed" },
      { type: "human", icon: "user", label: "Crisis question", detail: "\"Tell me about your hardest production night. What happened and what did you do?\"" },
      { type: "human", icon: "user", label: "Impact question", detail: "\"What's the thing you did that you felt moved the needle most? How many people were affected?\"" },
    ],
  },
  {
    file: "MEASUREMENTS.md",
    emoji: "📈",
    title: "Performance Metrics",
    accentColor: "#065F46",
    sources: [
      { type: "system", icon: "grid", label: "Jira / Linear metrics", detail: "Cycle time, throughput, tickets closed on time vs. past deadline" },
      { type: "system", icon: "github", label: "GitHub — PR metrics", detail: "Average time from open to merge, review turnaround time, revert rate" },
      { type: "system", icon: "zap", label: "Deployment frequency", detail: "How often do deployments pass through her? Incident rate by author?" },
      { type: "human", icon: "user", label: "Benchmark question", detail: "\"How do you know you had a good week? What did you measure at end of Friday?\"" },
      { type: "human", icon: "user", label: "Quality question", detail: "\"Give me an example of work you delivered on time but weren't satisfied with. Why?\"" },
    ],
  },
  {
    file: "CIRCLES.md",
    emoji: "🕸️",
    title: "Social Circles",
    accentColor: "#6D28D9",
    sources: [
      { type: "system", icon: "message", label: "Slack — @mentions", detail: "Who tags her most? Who does she tag? In what context?" },
      { type: "system", icon: "git", label: "PR Reviewers", detail: "Who does she request as reviewer? Who requests her? Who always approves vs. always requests changes?" },
      { type: "system", icon: "calendar", label: "Calendar", detail: "Recurring meetings, regular 1-on-1s, who appears in her private meetings" },
      { type: "human", icon: "user", label: "Trust question", detail: "\"If you have a technical doubt at 11pm, who do you call?\"" },
      { type: "human", icon: "user", label: "Influence question", detail: "\"Who are the people that, if they agree with your idea — it happens? And if they're against — it doesn't?\"" },
    ],
  },
  {
    file: "VISIONCONTEXT.md",
    emoji: "👁️",
    title: "Visual Context",
    accentColor: "#374151",
    sources: [
      { type: "system", icon: "figma", label: "Figma / Notion", detail: "How she organizes information visually — diagrams she created, layout of her docs" },
      { type: "system", icon: "slides", label: "Slides / presentations", detail: "Style of presentations she gave — how much text? visuals-heavy? bullet points?" },
      { type: "system", icon: "message", label: "Slack profile & avatar", detail: "Profile picture, title, status messages she uses" },
      { type: "human", icon: "user", label: "Medium question", detail: "\"When you want to explain something complex — do you prefer to write, draw, or talk? Why?\"" },
      { type: "human", icon: "user", label: "Design question", detail: "\"Show me a diagram you made recently to explain something to the team.\"" },
    ],
  },
];

export const SOURCE_TYPE_CONFIG = {
  system: { label: "System", bg: "#EDE8E1", text: "#6B6560" },
  human:  { label: "Human",  bg: "#0A0A0A", text: "#F5F2ED" },
} as const;
