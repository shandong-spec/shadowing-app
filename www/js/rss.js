// rss.js
// VOA Learning English の RSS を取得し、記事データに変換する
//
// 注意: ブラウザ(WebView)からの直接fetchはCORSで弾かれる可能性があるため、
// 実機では @capacitor/core の CapacitorHttp (Native HTTP) を使うのが確実。
// ここではまず fetch ベースで実装し、CORSエラーが出た場合は
// Capacitor.Plugins.CapacitorHttp.get(...) に差し替える。

const VOA_RSS_URL = "https://learningenglish.voanews.com/api/";
// ↑ VOA Learning English トップページの <link rel="alternate" type="application/rss+xml"
//   title="VOA - Top Stories [RSS]"> が指す全カテゴリ横断のフィード。
//   番組別フィードに切り替えたい場合は https://learningenglish.voanews.com/rssfeeds
//   で公開されている各カテゴリ（As It Is, Words and Their Stories 等）のURLに差し替える。
//
// 注意: このフィードの <enclosure> はサムネイル画像(image/jpeg)であり、
//   お手本MP3音声は含まれていない。MP3は記事ページ(/a/xxxxx.html)内の
//   <audio src="https://voa-audio.voanews.eu/...mp3"> にのみ存在するため、
//   audioUrl を正しく取得するには記事ページ側のスクレイピングが別途必要。
//   （_parseRss の audioUrl 抽出ロジックは要修正・未実装のTODO）

const RssService = {
  /**
   * RSSを取得し、記事オブジェクトの配列を返す
   * @returns {Promise<Array<{id:string, title:string, pubDate:string, summaryEn:string, audioUrl:string, segments:string[]}>>}
   */
  async fetchLatestArticles(limit = 5) {
    const xmlText = await this._fetchRawXml(VOA_RSS_URL);
    const items = this._parseRss(xmlText);
    return items.slice(0, limit);
  },

  /**
   * 記事ページのHTMLを取得し、<audio ... src="....mp3" ...> のsrc属性を抽出する。
   * RSSの<enclosure>はサムネイル画像のみで音声を含まないため、記事ページ本体から補完する。
   * @param {string} articleLink 記事ページのURL（RSS itemのlink）
   * @returns {Promise<string>} MP3のURL。見つからない場合は空文字列。
   */
  async fetchArticleAudioUrl(articleLink) {
    if (!articleLink) return "";
    const html = await this._fetchText(articleLink);
    const audioTagMatch = html.match(/<audio\b[^>]*>/i);
    if (!audioTagMatch) return "";
    const srcMatch = audioTagMatch[0].match(/\bsrc="([^"]+?\.mp3[^"]*)"/i);
    return srcMatch ? srcMatch[1] : "";
  },

  /**
   * 記事ページのHTML本文（段落）を抽出する。
   * RSSの<description>は短い定型文のみで本文を含まないことが多いため、
   * 記事ページ本体（`#article-content` 内の `.wsw` ブロック）の<p>タグを集めて返す。
   * 記事末尾にある語彙集(glossary)は、区切り線("____...")以降を除外する。
   * @param {string} articleLink 記事ページのURL（RSS itemのlink）
   * @returns {Promise<string>} 本文テキスト（段落をスペース区切りで連結）。取得できない場合は空文字列。
   */
  async fetchArticleBodyText(articleLink) {
    if (!articleLink) return "";
    const html = await this._fetchText(articleLink);

    const doc = new DOMParser().parseFromString(html, "text/html");
    const container =
      doc.querySelector("#article-content .wsw") ||
      doc.querySelector(".wsw") ||
      doc.querySelector("#article-content");
    if (!container) return "";

    const paragraphs = [];
    // class付きの<p>は音声プレイヤーのフォールバック文言や共有ボタン等のUI要素であり、
    // 本文の段落は常にclass無しの<p>であるため、それだけを対象にする。
    for (const p of container.querySelectorAll("p:not([class])")) {
      const text = p.textContent.trim();
      if (!text) continue;
      if (/^_{5,}$/.test(text)) break; // 本文と語彙集の区切り線以降は除外
      paragraphs.push(text);
    }

    return paragraphs.join(" ");
  },

  async _fetchRawXml(url) {
    return this._fetchText(url);
  },

  async _fetchText(url) {
    // Capacitorネイティブ環境かどうかで取得方法を分岐
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // ネイティブ実行時: CapacitorHttpプラグイン(CORS制限なし)を使用
      const { CapacitorHttp } = window.Capacitor.Plugins;
      const res = await CapacitorHttp.get({ url });
      return res.data;
    }
    // Web/開発時: 通常のfetch（CORSエラーが出る場合はプロキシ経由に変更が必要）
    const res = await fetch(url);
    if (!res.ok) throw new Error(`取得失敗: ${res.status} (${url})`);
    return await res.text();
  },

  _parseRss(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const items = Array.from(doc.querySelectorAll("item"));

    return items.map((item) => {
      const title = item.querySelector("title")?.textContent?.trim() ?? "";
      const pubDate = item.querySelector("pubDate")?.textContent?.trim() ?? "";
      const description = item.querySelector("description")?.textContent?.trim() ?? "";
      const link = item.querySelector("link")?.textContent?.trim() ?? "";
      const enclosure = item.querySelector("enclosure");
      const audioUrl = enclosure?.getAttribute("url") ?? "";
      const guid = item.querySelector("guid")?.textContent?.trim() ?? link;

      const cleanText = this._stripHtml(description);
      const segments = this._splitIntoSegments(cleanText);

      return {
        id: this._hashId(guid || title),
        title,
        pubDate,
        link,
        summaryEn: cleanText,
        audioUrl,
        segments, // string[] 2-3文単位
      };
    });
  },

  _stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || "").trim();
  },

  // 簡易な文分割 → 2文ずつグルーピングしてセグメント化
  // 文末記号の直後にスペースが無い記事（"U.S.News"のような詰まった表記等）でも
  // 分割できるよう、`\s+`の存在を前提にしない後読み(lookbehind)で分割する。
  _splitIntoSegments(text, sentencesPerSegment = 2) {
    const sentences = text
      .split(/(?<=[.?!])\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    const segments = [];
    for (let i = 0; i < sentences.length; i += sentencesPerSegment) {
      segments.push(sentences.slice(i, i + sentencesPerSegment).join(" "));
    }

    // 文分割の結果が0件（記事本文に文区切りが無い/短すぎる等）の場合は、
    // 記事全文を1セグメントとして扱うフォールバック
    if (segments.length === 0) {
      const fallback = text.trim();
      if (fallback) segments.push(fallback);
    }

    return segments;
  },

  _hashId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return `article_${Math.abs(hash)}`;
  },
};
