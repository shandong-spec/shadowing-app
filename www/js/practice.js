// practice.js
// 5ステップ（意味理解→多聴→シャドーイング→フィードバック→アウトプット）の進行を管理
//
// 音声認識・録音は実機ネイティブプラグインに依存する部分があるため、
// ここでは呼び出しインターフェースを整え、プラグイン未導入時はモックで動作確認できるようにしている。
// 導入予定プラグイン:
//   - 録音: capacitor-voice-recorder (or 同等)
//   - 音声認識: @capacitor-community/speech-recognition

const PracticeController = {
  article: null,
  segmentIndex: 0,
  listenCount: 0,
  lastRecognizedText: "",
  lastScore: 0,

  async start(article) {
    this.article = article;
    this.segmentIndex = 0;
    this._goToSegment(0);
    App.showView("practice");
  },

  _goToSegment(index) {
    this.segmentIndex = index;
    this.listenCount = 0;
    const segment = this.article?.segments?.[index];

    if (!segment) {
      console.error("セグメントを取得できませんでした。記事データを確認してください。", {
        articleId: this.article?.id,
        index,
        segmentsLength: this.article?.segments?.length ?? 0,
      });
      alert("この記事は練習用のテキストを取得できませんでした。お手数ですが別の記事でお試しください。");
      App.showView("home");
      return;
    }

    document.getElementById("step-indicator").textContent =
      `Step 1 / 5 ・ セグメント ${index + 1} / ${this.article.segments.length}`;

    // Step1: 意味理解（今回は要約全文を提示。将来的にはセグメント別要約に分割）
    document.getElementById("segment-summary-ja").textContent =
      this.article.summaryJa || "（この記事の日本語要約は準備中です。まずは元の英文の雰囲気を感じ取ってみましょう）";

    // Step3で使う英文をセット（Glue Wordハイライト付き）
    document.getElementById("segment-text-en").innerHTML =
      ScoringService.highlightGlueWords(segment);

    document.getElementById("listen-count").textContent = "0";
    document.getElementById("btn-to-shadow").disabled = true;

    this._showStep("meaning");
  },

  _showStep(stepName) {
    const steps = ["meaning", "listen", "shadow", "feedback", "output"];
    steps.forEach((s) => {
      document.getElementById(`step-${s}`).classList.toggle("hidden", s !== stepName);
    });
  },

  async playModelAudio() {
    // MVP: 記事全体の音声を再生（セグメント単位の切り出しは将来対応。VOA音声は記事単位配信のため）
    const audio = new Audio(this.article.audioUrl);
    await audio.play().catch((e) => console.warn("音声再生エラー:", e));
    this.listenCount += 1;
    document.getElementById("listen-count").textContent = String(this.listenCount);
    if (this.listenCount >= 3) {
      document.getElementById("btn-to-shadow").disabled = false;
    }
  },

  async recordShadowing() {
    const segment = this.article.segments[this.segmentIndex];
    try {
      const recognizedText = await this._recognizeSpeech();
      this.lastRecognizedText = recognizedText;
      this.lastScore = ScoringService.scoreTranscript(segment, recognizedText);
    } catch (e) {
      console.warn("音声認識に失敗、スコアは保留:", e);
      this.lastRecognizedText = "";
      this.lastScore = 0;
    }
    document.getElementById("btn-to-feedback").classList.remove("hidden");
  },

  async _recognizeSpeech() {
    const plugins = window.Capacitor?.Plugins ?? {};
    if (plugins.SpeechRecognition) {
      // @capacitor-community/speech-recognition 導入後の想定コード
      await plugins.SpeechRecognition.requestPermissions();
      const result = await plugins.SpeechRecognition.start({
        language: "en-US",
        maxResults: 1,
        partialResults: false,
      });
      return result?.matches?.[0] ?? "";
    }
    // プラグイン未導入時（Web確認用モック）
    console.info("[mock] SpeechRecognitionプラグイン未導入のため、ダミーテキストを返します");
    return this.article.segments[this.segmentIndex];
  },

  showFeedback() {
    document.getElementById("feedback-message").textContent =
      ScoringService.feedbackMessage(this.lastScore);
    document.getElementById("feedback-score").textContent =
      `伝わる度スコア: ${this.lastScore}点（参考値）`;
    this._showStep("feedback");
  },

  goToOutput() {
    this._showStep("output");
  },

  async recordOutput() {
    // Step5は採点なし。録音して保存するのみ（将来: ファイル保存してヒストリーで再生可能に）
    console.info("[stub] アウトプット録音を保存（実装はcapacitor-voice-recorder導入後）");
  },

  async finishSegment() {
    const isLastSegment = this.segmentIndex >= this.article.segments.length - 1;

    // 今日の記録を更新
    const records = await StorageService.getDailyRecords();
    const todayKey = StorageService._dateKey(new Date());
    const existing = records[todayKey] ?? { segmentsDone: 0, totalSegments: this.article.segments.length, scores: [] };
    existing.segmentsDone += 1;
    existing.totalSegments = this.article.segments.length;
    existing.scores = [...(existing.scores ?? []), this.lastScore];

    const avgScore = existing.scores.reduce((a, b) => a + b, 0) / existing.scores.length;
    let status = "partial";
    if (existing.segmentsDone >= existing.totalSegments) {
      status = avgScore >= 85 ? "bonus" : "full";
    }

    await StorageService.updateTodayRecord({ ...existing, status });

    if (isLastSegment) {
      App.showView("home");
      await App.refreshHome();
    } else {
      this._goToSegment(this.segmentIndex + 1);
    }
  },
};
