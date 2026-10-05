/** A battle topic. `keywords` are lowercase stems matched against captions and hashtags. */
export interface Topic { id: string; keywords: readonly string[] }

/**
 * Scores topics from caption/hashtag text the user consented to share.
 * Returns topic ids sorted by number of keyword hits (desc), ties by catalogue order.
 */
export function rankTopics(texts: readonly string[], catalogue: readonly Topic[]): string[] {
  const corpus = texts.join(" ").toLowerCase();
  return catalogue
    .map((t, i) => ({ id: t.id, i, hits: t.keywords.reduce((n, k) => n + (corpus.split(k).length - 1), 0) }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .map(x => x.id);
}

/** Topic to pre-select for a new clip: best caption match, else the user's first topic, else `fallback`. */
export function suggestTopic(caption: string, userTopics: readonly string[], catalogue: readonly Topic[], fallback: string): string {
  return rankTopics([caption], catalogue)[0] ?? userTopics[0] ?? fallback;
}
