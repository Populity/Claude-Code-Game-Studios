/** Tunable battle rules. Gameplay values live here, never inline in logic. */
export interface BattleRules {
  /** Battles every new clip must play before it is judged. */
  qualBattles: number;
  /** Losses within qualification that eliminate a clip. */
  maxQualLosses: number;
  /** Win rate a qualified clip must exceed to become king of the hill. */
  kingWinRate: number;
  /** Matchmaking weight of kings (they are pushed into battles more often). */
  kingWeight: number;
  /** Matchmaking weight of clips still in qualification. */
  qualWeight: number;
  /** Weight multiplier for clips the viewer saw recently. */
  recentPenalty: number;
  /** Elo K-factor. */
  eloK: number;
  /** Rating every clip starts with. */
  startRating: number;
}

/** Defaults agreed with the founder: 10 battles, ≥7 losses out, >70% wins king. */
export const DEFAULT_RULES: Readonly<BattleRules> = Object.freeze({
  qualBattles: 10,
  maxQualLosses: 7,
  kingWinRate: 0.7,
  kingWeight: 3,
  qualWeight: 2,
  recentPenalty: 0.15,
  eloK: 32,
  startRating: 1500,
});
