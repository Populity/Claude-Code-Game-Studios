# ADR-0001: VSV technology stack

- **Status:** Accepted (founder chose mobile app, own clip pool, Instagram login, prototype first)
- **Date:** 2026-10-05
- **Owners:** technical-director, lead-programmer, mobile-programmer

## Context
VSV is a mobile app where two clips of the same topic battle 1v1 and the community
votes (king of the hill). Requirements: iOS + Android, in-app recording, fast uploads,
RU/EN, Instagram login with consent, official Instagram embeds for links, duplicate
detection, reporting/blocking, AAA-grade motion. This is not a game-engine project:
the Godot/Unity/Unreal code-root rules of this studio template do not apply.

## Decision
| Layer | Choice | Why |
|---|---|---|
| App | **Expo (SDK 57) + React Native + TypeScript** | One codebase for iOS/Android; `expo-camera`, `expo-image-picker`, `expo-video` cover recording and playback |
| Motion | **Reanimated + Gesture Handler** | UI-thread springs and gestures at 60/120 fps — the motion bar from the prototype |
| i18n | **i18next** (RU, EN) | Language switch at runtime, string tables per locale |
| Backend | **Supabase** (Postgres, Auth, Storage, Edge Functions) | Auth with custom OAuth (Instagram), row-level security, storage for user-owned videos |
| Battle rules | **`packages/core`** — pure TypeScript, no I/O | Same rules on server (authoritative vote) and client (optimistic UI); unit-tested |
| Instagram | Instagram API with Instagram Login (`instagram_business_basic`), Meta oEmbed for links | Only official APIs; no scraping, no re-hosting other people's videos |
| Video | Resumable upload → server transcode (HLS) → CDN; SHA-256 + perceptual hash for duplicates | Fast, robust uploads; same clip cannot battle twice |

## Rules that follow
- Votes are **server-authoritative**: the client never writes ratings. An Edge Function
  calls `applyVote` from `packages/core` inside a transaction.
- One vote per (viewer, battle); rate limits per account and device.
- Gameplay numbers live in `packages/core/src/rules.ts` (`DEFAULT_RULES`), never inline.
- Brand/IP constraints: `design/legal/brand-and-ip-compliance.md` (no "Reels"/Instagram marks in branding).

## Alternatives considered
- **Flutter** — great performance, but the team's motion/i18n/web prototype stack is JS/TS; rejected for velocity.
- **Native Swift + Kotlin** — best quality, double the cost; rejected for an MVP.
- **Firebase** — viable; Supabase chosen for SQL (ranking queries, leaderboards) and row-level security.

## Consequences
- `packages/core` must stay dependency-free and fully tested (`npm test` in `packages/core`).
- Instagram topic detection works only for professional accounts; personal accounts pick topics manually.
