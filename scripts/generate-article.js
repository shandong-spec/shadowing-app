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

const THEMES = [
  {
    key: "culture",
    label: "一般的なポーカー文化・トレンド解説",
    prompt:
      "Write about a general aspect of poker culture or a current trend in the poker world " +
      "(for example: the growth of online poker, poker in movies or TV, how home poker games work, " +
      "or how poker communities have changed over time). Keep it broad and accessible, not focused " +
      "on one specific person, company, or event.",
  },
  {
    key: "terminology",
    label: "ポーカー用語の解説",
    prompt:
      "Explain one or two common Texas Hold'em poker terms (for example: bluff, all-in, fold, flop, " +
      "pot odds, position, big blind). Describe what each term means in simple words and give a short, " +
      "easy-to-follow example of it being used at the table.",
  },
  {
    key: "player_or_event",
    label: "実在の有名プレイヤーや大会の紹介",
    prompt:
      "Introduce a well-known, real professional poker player or a well-known poker tournament " +
      "(for example, the World Series of Poker). Only include facts that are widely and publicly known. " +
      "Do not include any uncertain, speculative, or unverifiable details - if you are not confident " +
      "about a specific fact (exact dates, exact prize amounts, recent results, career statistics), " +
      "omit it rather than guessing.",
  },
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
  return THEMES[weekday % THEMES.length];
}

// www/js/rss.js の _splitIntoSegments() を移植（Node環境にDOMが無いため独立実装）
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

function buildSchema() {
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short English article title.",
      },
      summaryJa: {
        type: "string",
        description: "A 2-3 sentence Japanese summary of the article's key point (not a full translation).",
      },
      bodyEn: {
        type: "string",
        description:
          "The full English article body, about 4 short paragraphs, using easy vocabulary and short " +
          "sentences (VOA Learning English style).",
      },
      keywords: {
        type: "array",
        description:
          "3 to 5 frequently used poker terms that actually appear in bodyEn, each mapped to one " +
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

function buildUserPrompt(theme) {
  return `You write short English news-style articles about Texas Hold'em poker for English learners.

Today's topic angle: ${theme.prompt}

Requirements:
- Vocabulary and sentence length should match VOA Learning English style: simple words, short sentences (roughly a Japanese junior-high-school-plus-a-bit level of English).
- "bodyEn" should be about 4 short paragraphs.
- Only state facts you are confident are generally well-known and accurate. Do not include uncertain or speculative information, especially about real people, dates, or results.
- "summaryJa" is a 2-3 sentence Japanese summary of the key point, not a full translation.
- "keywords" must list 3 to 5 poker terms that actually appear in "bodyEn", each with one representative emoji.`;
}

async function generateArticle(theme) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("環境変数 ANTHROPIC_API_KEY が設定されていません");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: {
      format: { type: "json_schema", schema: buildSchema() },
    },
    messages: [{ role: "user", content: buildUserPrompt(theme) }],
  });

  if (!response.parsed_output) {
    throw new Error("記事生成に失敗しました（構造化出力の検証に失敗しました）");
  }

  return response.parsed_output;
}

async function main() {
  const jstShifted = getJstNow();
  const key = dateKey(jstShifted);
  const theme = pickTheme(jstShifted);

  console.log(`[generate-article] date=${key} theme=${theme.key} (${theme.label})`);

  const generated = await generateArticle(theme);
  const segments = splitIntoSegments(generated.bodyEn);

  const article = {
    date: key,
    title: generated.title,
    summaryJa: generated.summaryJa,
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
