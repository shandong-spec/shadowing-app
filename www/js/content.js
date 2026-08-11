// content.js
// GitHub Pages上でAI(Claude)が毎日自動生成するポーカー記事(latest.json)を取得する
//
// 注意: ブラウザ(WebView)からの直接fetchはCORSで弾かれる可能性があるため、
// 実機では @capacitor/core の CapacitorHttp (Native HTTP) を使うのが確実。

const CONTENT_URL = "https://shandong-spec.github.io/shadowing-app/latest.json";

const ContentService = {
  /**
   * 今日の記事を取得する
   * @returns {Promise<{id:string, date:string, title:string, summaryJa:string, format:string, segments:string[], keywords:Array<{term:string, emoji:string}>}>}
   */
  async fetchTodayArticle() {
    const data = await this._fetchJson(CONTENT_URL);
    return this._normalize(data);
  },

  _normalize(data) {
    return {
      id: `article_${data.date ?? "unknown"}`,
      date: data.date ?? "",
      title: data.title ?? "",
      summaryJa: data.summaryJa ?? "",
      // "dialogue"の場合、segmentsの各要素は"Speaker: 発言"形式（practice.jsが話者ラベル表示に使う）
      format: data.format === "dialogue" ? "dialogue" : "prose",
      segments: Array.isArray(data.segments) ? data.segments : [],
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
    };
  },

  async _fetchJson(url) {
    // Capacitorネイティブ環境かどうかで取得方法を分岐
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // ネイティブ実行時: CapacitorHttpプラグイン(CORS制限なし)を使用
      // CapacitorHttpはcontent-typeがapplication/jsonの場合、res.dataを自動でオブジェクトにパースする
      const { CapacitorHttp } = window.Capacitor.Plugins;
      const res = await CapacitorHttp.get({ url });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`取得失敗: ${res.status} (${url})`);
      }
      return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    }
    // Web/開発時: 通常のfetch（CORSエラーが出る場合は実機/エミュレータで確認）
    const res = await fetch(url);
    if (!res.ok) throw new Error(`取得失敗: ${res.status} (${url})`);
    return await res.json();
  },
};
