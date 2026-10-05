# VSV — mobile app (trial, single user)

Expo SDK 57 · React Native 0.86 · TypeScript. Battle rules come from `packages/core` (unit-tested).

## Run on your phone
1. Install **Expo Go** (App Store / Google Play).
2. On a computer: `cd apps/mobile && npm install && npx expo start`
3. Scan the QR code with the camera (iOS) or Expo Go (Android).

Web: `npx expo start --web`. Typecheck: `npm run typecheck`. Web build: `npx expo export --platform web --output-dir dist`.

## What works in the trial
Onboarding (RU/EN, rules, handle login placeholder, consent, topics) · battle feed (both / one-by-one,
double-tap or button vote, VS / bolt / win animations, auto-advance) · king and elimination
celebrations · report and hide author · explore by topic · ranking with podium · profile with
10-battle qualification dots · create: record with camera, pick from gallery (rights confirmation),
Instagram link (duplicate check) · settings: language, topics, demo "run 10 battles", reset, log out.
Data is stored on the device (AsyncStorage); demo opponents are generated locally.

Not in the trial: real Instagram login, server, other users (needs backend — see
`docs/architecture/ADR-0001-vsv-stack.md` and `packages/security`).
