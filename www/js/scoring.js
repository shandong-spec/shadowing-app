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
   * 英文中の頻出機能語(Glue Words)をハイライト用HTMLに変換
   */
  highlightGlueWords(text) {
    const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    return escaped.replace(/\b([A-Za-z']+)\b/g, (match, word) => {
      if (GLUE_WORDS.includes(word.toLowerCase())) {
        return `<span class="glue-word">${word}</span>`;
      }
      return word;
    });
  },
};
