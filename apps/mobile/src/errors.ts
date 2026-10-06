import { ApiError } from "./api";
import type { Key } from "./i18n";

type T = (k: Key, v?: Record<string, string | number>) => string;

const BY_CODE: Record<string, Key> = {
  network: "errNet", timeout: "errNet", rate_limited: "errRate", handle_taken: "errHandleTaken", bad_handle: "errBadHandle",
  too_large: "errTooLarge", too_small: "errTooSmall", unknown_format: "errBadFile", format_not_allowed: "errBadFile", read_failed: "errReadFile",
  bad_link: "badLink", bad_topic: "errBadTopic", rights_not_confirmed: "errRights", min_3_topics: "errMin3", unauthorized: "errUnauthorized",
  vote_rejected: "errVoteStale", replayed: "errVoteStale", battle_closed: "errVoteStale", expired: "errVoteStale", ticket_expired: "errVoteStale", not_owner: "errNotOwner", not_found: "errGeneric",
};

/** Localized, user-facing message for any failure from the API client. */
export function errMsg(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return t("errGeneric");
  if (e.code === "duplicate") return t("dup", { h: String(e.data.handle ?? "") });
  const k = BY_CODE[e.code];
  return t(k ?? (e.status === 413 ? "errTooLarge" : "errGeneric"));
}
