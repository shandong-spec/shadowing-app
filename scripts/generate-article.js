#!/usr/bin/env node
// scripts/generate-article.js
// Claude API でポーカー(テキサスホールデム)をテーマにした英文記事を生成し、
// docs/articles/YYYY-MM-DD.json と docs/latest.json に保存する。
// GitHub Actions (.github/workflows/daily-article.yml) から毎日実行される想定。

const fs = require("fs");
const path = require("path");

// ローカル実行時: .env.local から環境変数を読み込む（ANTHROPIC_API_KEYなど）。
// GitHub Actions上ではSecretsから直接環境変数が渡るため、.env.localが存在せず
// 何も読み込まれなくても問題ない（dotenvはファイル未検出時、エラーを投げず無視する）。
require("dotenv").config({ path: ".env.local" });

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-haiku-4-5";
const ARTICLES_DIR = path.join(__dirname, "..", "docs", "articles");
const LATEST_PATH = path.join(__dirname, "..", "docs", "latest.json");

const THEMES = {
  culture: {
    key: "culture",
    label: "一般的なポーカー文化・トレンド解説",
    prompt:
      "Write about a general aspect of poker culture or a current trend in the poker world " +
      "(for example: the growth of online poker, poker in movies or TV, how home poker games work, " +
      "or how poker communities have changed over time). Keep it broad and accessible, not focused " +
      "on one specific person, company, or event.",
  },
  terminology: {
    key: "terminology",
    label: "ポーカー用語の解説",
    prompt:
      "Explain one or two common Texas Hold'em poker terms (for example: bluff, all-in, fold, flop, " +
      "pot odds, position, big blind). Describe what each term means in simple words and give a short, " +
      "easy-to-follow example of it being used at the table.",
  },
  player_or_event: {
    key: "player_or_event",
    label: "実在の有名プレイヤーや大会の紹介",
    prompt:
      "Introduce a well-known, real professional poker player or a well-known poker tournament " +
      "(for example, the World Series of Poker). Only include facts that are widely and publicly known. " +
      "Do not include any uncertain, speculative, or unverifiable details - if you are not confident " +
      "about a specific fact (exact dates, exact prize amounts, recent results, career statistics), " +
      "omit it rather than guessing.",
  },
  dialogue: {
    key: "dialogue",
    label: "実践フレーズ会話",
  },
};

// 「実践フレーズ会話」テーマ内でローテーションする、実際のテーブルで起こりうるシチュエーション
const DIALOGUE_SITUATIONS = {
  dealer_interaction: {
    key: "dealer_interaction",
    label: "ディーラーとのやり取り",
    prompt:
      "A conversation between a player (You) and the dealer during a hand - for example confirming a " +
      "chip count, asking for a time extension, requesting a rebuy, or checking a bet amount.",
  },
  table_talk: {
    key: "table_talk",
    label: "対戦相手とのテーブルトーク",
    prompt:
      "A short, friendly social exchange between the player (You) and an opponent at the table - for " +
      "example greeting a new player, complimenting a nice hand after a showdown, or casual small talk " +
      "between hands.",
  },
  rules_check: {
    key: "rules_check",
    label: "ルール確認",
    prompt:
      "A conversation where the player (You) asks the dealer to clarify a rule during play - for example " +
      "the minimum raise amount, the current blind levels, or how much more is needed to call.",
  },
  betting_action: {
    key: "betting_action",
    label: "ベッティングアクションの宣言",
    prompt:
      "A conversation showing the player (You) clearly declaring a betting action out loud (call, raise, " +
      "or all-in), with the dealer or an opponent responding to confirm or react to the action.",
  },
};

// 週7日のうち4日を「実践フレーズ会話」に割り当て、残り3日を既存3テーマに1日ずつ割り当てる。
// 日付から一意に決まる（曜日ベースの)ため、GitHub Actionsの日次実行でも状態を持たず再現できる。
const WEEKDAY_SCHEDULE = [
  { theme: "dialogue", situation: "dealer_interaction" }, // 0: 日曜
  { theme: "culture" }, // 1: 月曜
  { theme: "dialogue", situation: "table_talk" }, // 2: 火曜
  { theme: "terminology" }, // 3: 水曜
  { theme: "dialogue", situation: "rules_check" }, // 4: 木曜
  { theme: "player_or_event" }, // 5: 金曜
  { theme: "dialogue", situation: "betting_action" }, // 6: 土曜
];

function getJstNow() {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

// getJstNow()でずらしたDateにUTC系メソッドを使うと、JSTでの日付・曜日が取れる
function dateKey(jstShiftedDate) {
  return jstShiftedDate.toISOString().slice(0, 10);
}

function pickTheme(jstShiftedDate) {
  const weekday = jstShiftedDate.getUTCDay(); // 0=日曜 ... 6=土曜（JST基準）
  const entry = WEEKDAY_SCHEDULE[weekday];
  const theme = THEMES[entry.theme];
  const situation = entry.situation ? DIALOGUE_SITUATIONS[entry.situation] : null;
  return { theme, situation };
}

// 文章テーマ用: 文単位で区切り、2文ずつをまとめて1セグメントにする
function splitIntoSegments(text, sentencesPerSegment = 2) {
  const sentences = text
    .split(/(?<=[.?!])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const segments = [];
  for (let i = 0; i < sentences.length; i += sentencesPerSegment) {
    segments.push(sentences.slice(i, i + sentencesPerSegment).join(" "));
  }

  if (segments.length === 0) {
    const fallback = text.trim();
    if (fallback) segments.push(fallback);
  }

  return segments;
}

// 会話テーマ用: 1行(=1発言、"Speaker: 発言内容"の形式)をそのまま1セグメントにする。
// アプリ側(practice.js等)はsegmentsを常にstring[]として扱っているため、話者情報は
// 別フィールドに構造化せず、文字列の先頭に含める形にしている（アプリ側の変更は不要）。
function splitDialogueIntoSegments(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSchema(theme) {
  const isDialogue = theme.key === "dialogue";
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: isDialogue ? "Short English title describing the situation." : "Short English article title.",
      },
      summaryJa: {
        type: "string",
        description: isDialogue
          ? "A 2-3 sentence Japanese summary of what is happening in the conversation and why it's useful."
          : "A 2-3 sentence Japanese summary of the article's key point (not a full translation).",
      },
      bodyEn: {
        type: "string",
        description: isDialogue
          ? "The dialogue, one utterance per line separated by \\n, each line formatted exactly as " +
            '"Speaker: line text" (for example "Dealer: Can I get a count, please?"). No narration or ' +
            "stage directions outside the dialogue lines."
          : "The full English article body, about 4 short paragraphs, using easy vocabulary and short " +
            "sentences (VOA Learning English style).",
      },
      keywords: {
        type: "array",
        description:
          "3 to 5 frequently used poker/table terms that actually appear in bodyEn, each mapped to one " +
          "representative emoji.",
        items: {
          type: "object",
          properties: {
            term: { type: "string" },
            emoji: { type: "string" },
          },
          required: ["term", "emoji"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "summaryJa", "bodyEn", "keywords"],
    additionalProperties: false,
  };
}

function buildUserPrompt(theme, situation) {
  if (theme.key === "dialogue") {
    return `You write short, realistic English dialogues for poker players learning English, set at a real-money poker table during a tournament (like the WSOP or EPT).

Today's situation: ${situation.prompt}

Requirements:
- Write 3 to 5 exchanges (6 to 10 lines total) between "You" (the poker player practicing English) and one other realistic speaker appropriate to the situation (for example "Dealer" or "Opponent").
- Format "bodyEn" as one utterance per line, in the exact form "Speaker: line text" (for example: "Dealer: Can I get a count, please?"). Separate lines with \\n. Do not add narration, stage directions, or commentary outside the dialogue lines.
- Vocabulary and sentence length should stay simple and natural, roughly VOA Learning English level, but the phrases should be realistic things actually said at a real poker table.
- "summaryJa" is a 2-3 sentence Japanese summary of what is happening in this conversation and why it's useful to know.
- "keywords" must list 3 to 5 poker/table terms that actually appear in "bodyEn" (for example: raise, all-in, call, count, chips), each with one representative emoji.
- Only use realistic, natural table language. Do not invent fictional tournament names, player names, or specific results.`;
  }

  return `You write short English news-style articles about Texas Hold'em poker for English learners.

Today's topic angle: ${theme.prompt}

Requirements:
- Vocabulary and sentence length should match VOA Learning English style: simple words, short sentences (roughly a Japanese junior-high-school-plus-a-bit level of English).
- "bodyEn" should be about 4 short paragraphs.
- Only state facts you are confident are generally well-known and accurate. Do not include uncertain or speculative information, especially about real people, dates, or results.
- "summaryJa" is a 2-3 sentence Japanese summary of the key point, not a full translation.
- "keywords" must list 3 to 5 poker terms that actually appear in "bodyEn", each with one representative emoji.`;
}

async function generateArticle(theme, situation) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("環境変数 ANTHROPIC_API_KEY が設定されていません");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: {
      format: { type: "json_schema", schema: buildSchema(theme) },
    },
    messages: [{ role: "user", content: buildUserPrompt(theme, situation) }],
  });

  if (!response.parsed_output) {
    throw new Error("記事生成に失敗しました（構造化出力の検証に失敗しました）");
  }

  return response.parsed_output;
}

async function main() {
  const jstShifted = getJstNow();
  const key = dateKey(jstShifted);
  const { theme, situation } = pickTheme(jstShifted);

  const situationLabel = situation ? ` situation=${situation.key} (${situation.label})` : "";
  console.log(`[generate-article] date=${key} theme=${theme.key} (${theme.label})${situationLabel}`);

  const generated = await generateArticle(theme, situation);
  const segments =
    theme.key === "dialogue" ? splitDialogueIntoSegments(generated.bodyEn) : splitIntoSegments(generated.bodyEn);

  const article = {
    date: key,
    title: generated.title,
    summaryJa: generated.summaryJa,
    // segmentsは常にstring[]（会話テーマの場合は各要素が"Speaker: 発言"の形式）。
    // formatはアプリ側(practice.js)が話者ラベルを表示すべきかどうかの判定にのみ使う。
    format: theme.key === "dialogue" ? "dialogue" : "prose",
    segments,
    keywords: generated.keywords,
    source: "AI-generated (Claude)",
  };

  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const articlePath = path.join(ARTICLES_DIR, `${key}.json`);
  const json = JSON.stringify(article, null, 2) + "\n";

  fs.writeFileSync(articlePath, json, "utf8");
  fs.writeFileSync(LATEST_PATH, json, "utf8");

  console.log(`[generate-article] saved: ${articlePath}`);
  console.log(`[generate-article] saved: ${LATEST_PATH}`);
}

main().catch((err) => {
  console.error("[generate-article] failed:", err);
  process.exit(1);
});
