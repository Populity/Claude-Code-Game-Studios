/** Topic ids accepted by the API (labels live in the app). */
export const TOPIC_IDS = ["humor", "sport", "food", "dance", "travel", "beauty", "fashion", "music", "pets", "gaming", "fitness", "art", "tech", "cars", "edu", "life"] as const;
export const isTopic = (v: unknown): v is string => typeof v === "string" && (TOPIC_IDS as readonly string[]).includes(v);
export const REPORT_REASONS = ["rCopy", "rSpam", "rAbuse", "rAdult", "rOther"] as const;
