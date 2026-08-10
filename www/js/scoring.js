// scoring.js
// フェーズ1: SpeechRecognizerで文字起こしした結果と原文を単語一致率で比較する簡易スコアリング
// Language Parent方式: 減点ではなく「伝わる度」として肯定的にフィードバックする

const GLUE_WORDS = [
  "the", "a", "an", "that", "this", "these", "those",
  "would", "could", "should", "because", "although", "however",
  "and", "but", "or", "so", "if", "when", "while", "of", "in", "on", "at",
  "to", "for", "with", "as", "by", "than", "then",
];

const ScoringService = {
  /**
   * 原文と認識結果テキストを比較し、0-100のスコアを返す
   */
  scoreTranscript(originalText, recognizedText) {
    const normalize = (s) =>
      s
        .toLowerCase()
        .replace(/[^\w\s']/g, "")
        .split(/\s+/)
        .filter(Boolean);

    const originalWords = normalize(originalText);
    const recognizedWords = new Set(normalize(recognizedText));

    if (originalWords.length === 0) return 0;

    const matched = originalWords.filter((w) => recognizedWords.has(w)).length;
    const rawScore = Math.round((matched / originalWords.length) * 100);
    return Math.min(100, rawScore);
  },

  /**
   * スコアに応じた「Language Parent」的な肯定的フィードバック文を返す
   */
  feedbackMessage(score) {
    if (score >= 85) return "すごく伝わってます！お手本にかなり近い発音でした。";
    if (score >= 60) return "しっかり伝わってます。この調子で続けましょう！";
    if (score >= 35) return "半分くらい聞き取れる音になってます。耳と口はちゃんと動いてますよ。";
    return "まずは声に出せたことが大事な一歩です。次はもう少しゆっくりでもOK。";
  },

  /**
   * 英文中の頻出機能語(Glue Words)をハイライト用HTMLに変換する。
   * 併せて、記事のkeywords（ポーカー用語+絵文字）に一致する単語には絵文字を併記する。
   * 2つの装飾は同じ単語に重なる場合があるため、1回の正規表現走査で両方判定する。
   * @param {string} text セグメントの英文
   * @param {Array<{term:string, emoji:string}>} [keywords] 記事のキーワード一覧（term+emoji）
   */
  highlightGlueWords(text, keywords = []) {
    const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

    const keywordMap = new Map(
      (keywords ?? [])
        .filter((k) => k && k.term)
        .map((k) => [k.term.toLowerCase(), k.emoji ?? ""])
    );

    return escaped.replace(/\b([A-Za-z']+)\b/g, (match, word) => {
      const lower = word.toLowerCase();
      const isGlue = GLUE_WORDS.includes(lower);
      const emoji = keywordMap.get(lower);

      if (!isGlue && !emoji) return word;

      const classNames = [isGlue ? "glue-word" : null, emoji ? "keyword-term" : null]
        .filter(Boolean)
        .join(" ");
      const wordHtml = `<span class="${classNames}">${word}</span>`;

      if (!emoji) return wordHtml;

      // 単語と絵文字が行末で分離して絵文字だけ次行に孤立しないよう、まとめてnowrapで包む
      const emojiHtml = `<span class="keyword-emoji" title="${word}">${emoji}</span>`;
      return `<span class="keyword-wrap">${wordHtml}${emojiHtml}</span>`;
    });
  },
};
