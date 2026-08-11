// storage.js
// Capacitor Preferences をラップしたローカル永続化レイヤー
// キー設計:
//   articles_cache     -> 取得済み記事リスト(JSON)
//   daily_records      -> { "2026-08-10": { status: "full", segmentsDone: 3, totalSegments: 3 }, ... }
//   streak_count       -> 数値
//   output_recordings  -> [{ date, articleId, segmentIndex, filePath, title, mimeType }, ...]（新しい順・Step4アウトプット）
//   shadowing_recordings -> [{ date, articleId, segmentIndex, filePath, title, mimeType, segmentText }, ...]（新しい順・Step3シャドーイング）
//                         音声本体は@capacitor/filesystemでファイル保存し、ここには軽量なメタデータのみ持つ
//   show_segment_text_step5 -> 真偽値（Step4アウトプットで英文を表示するかどうかの設定。端末に記憶し次回起動時も維持）
//   last_interstitial_date  -> "YYYY-MM-DD"（インタースティシャル広告を最後に表示した日。1日1回までの制御に使う）

const StorageService = {
  async get(key) {
    const { Preferences } = window.Capacitor?.Plugins ?? {};
    if (!Preferences) {
      // Web開発時のフォールバック（localStorageは本番のCapacitorアプリでは使用しない）
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    }
    const { value } = await Preferences.get({ key });
    return value ? JSON.parse(value) : null;
  },

  async set(key, value) {
    const { Preferences } = window.Capacitor?.Plugins ?? {};
    const json = JSON.stringify(value);
    if (!Preferences) {
      localStorage.setItem(key, json);
      return;
    }
    await Preferences.set({ key, value: json });
  },

  async getArticlesCache() {
    return (await this.get("articles_cache")) ?? [];
  },

  async setArticlesCache(articles) {
    await this.set("articles_cache", articles);
  },

  async getDailyRecords() {
    return (await this.get("daily_records")) ?? {};
  },

  async updateTodayRecord(partialUpdate) {
    const records = await this.getDailyRecords();
    const todayKey = this._todayKey();
    records[todayKey] = { ...(records[todayKey] ?? {}), ...partialUpdate };
    await this.set("daily_records", records);
    await this._recalcStreak(records);
    return records[todayKey];
  },

  async _recalcStreak(records) {
    let streak = 0;
    let cursor = new Date();
    while (true) {
      const key = this._dateKey(cursor);
      const rec = records[key];
      if (rec && (rec.status === "partial" || rec.status === "full" || rec.status === "bonus")) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    await this.set("streak_count", streak);
    return streak;
  },

  async getStreak() {
    return (await this.get("streak_count")) ?? 0;
  },

  _todayKey() {
    return this._dateKey(new Date());
  },

  _dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },

  async getOutputRecordings() {
    return (await this.get("output_recordings")) ?? [];
  },

  async addOutputRecording(date, articleId, segmentIndex, filePath, title, mimeType) {
    const recordings = await this.getOutputRecordings();
    recordings.unshift({ date, articleId, segmentIndex, filePath, title, mimeType });
    await this.set("output_recordings", recordings);
    return recordings;
  },

  async getShadowingRecordings() {
    return (await this.get("shadowing_recordings")) ?? [];
  },

  async addShadowingRecording(date, articleId, segmentIndex, filePath, title, mimeType, segmentText) {
    const recordings = await this.getShadowingRecordings();
    recordings.unshift({ date, articleId, segmentIndex, filePath, title, mimeType, segmentText });
    await this.set("shadowing_recordings", recordings);
    return recordings;
  },

  async getShowSegmentTextStep5() {
    return (await this.get("show_segment_text_step5")) ?? false;
  },

  async setShowSegmentTextStep5(value) {
    await this.set("show_segment_text_step5", value);
  },

  async getLastInterstitialDate() {
    return (await this.get("last_interstitial_date")) ?? null;
  },

  async setLastInterstitialDate(dateKey) {
    await this.set("last_interstitial_date", dateKey);
  },

  async resetAll() {
    const { Preferences } = window.Capacitor?.Plugins ?? {};
    if (!Preferences) {
      localStorage.clear();
      return;
    }
    await Preferences.clear();
  },
};
