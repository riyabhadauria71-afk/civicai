export const ISSUE_CATEGORIES = [
  "Pothole",
  "Garbage / Waste",
  "Water leakage",
  "Damaged road",
  "Broken streetlight",
  "Drainage / sewer",
  "Fallen tree",
  "Electrical infrastructure",
  "Other",
] as const;

export type ReportStatus =
  "REPORTED" | "AI_ANALYZED" | "VERIFIED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";

export type CivicReport = {
  id: string;
  category: string | null;
  description: string | null;
  media_path: string;
  media_mime: string;
  status: string;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

export function statusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function statusTone(status: string) {
  if (status === "RESOLVED") return "status-resolved";
  if (status === "IN_PROGRESS" || status === "ASSIGNED") return "status-progress";
  if (status === "REJECTED") return "status-rejected";
  return "status-reported";
}

export function formatReportDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}
