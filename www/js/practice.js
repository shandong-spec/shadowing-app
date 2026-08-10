// practice.js
// 5ステップ（意味理解→多聴→シャドーイング→フィードバック→アウトプット）の進行を管理
//
// 音声認識・録音・読み上げは実機ネイティブプラグインに依存するため、
// プラグイン未導入時（Web確認時）はモックで動作確認できるようにしている。
// 使用プラグイン:
//   - お手本読み上げ: @capacitor-community/text-to-speech
//   - アウトプット録音: capacitor-voice-recorder + @capacitor/filesystem（ファイル保存）
//   - シャドーイング音声認識: @capacitor-community/speech-recognition（未実装・モックのまま）

const PracticeController = {
  article: null,
  segmentIndex: 0,
  listenCount: 0,
  lastRecognizedText: "",
  lastScore: 0,
  isRecordingOutput: false,

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

    // Step3で使う英文をセット（Glue Word + キーワード絵文字ハイライト付き）
    document.getElementById("segment-text-en").innerHTML =
      ScoringService.highlightGlueWords(segment, this.article.keywords);

    document.getElementById("listen-count").textContent = "0";
    document.getElementById("btn-to-shadow").disabled = true;

    // Step5: 録音ボタン/ステータスを新しいセグメント用にリセット（前セグメントの「✓ 録音済み」が残らないように）
    this.isRecordingOutput = false;
    document.getElementById("btn-record-output").textContent = "● 録音開始";
    document.getElementById("btn-record-output").disabled = false;
    document.getElementById("output-recording-status").classList.add("hidden");

    this._showStep("meaning");
  },

  _showStep(stepName) {
    const steps = ["meaning", "listen", "shadow", "feedback", "output"];
    steps.forEach((s) => {
      document.getElementById(`step-${s}`).classList.toggle("hidden", s !== stepName);
    });
  },

  async playModelAudio() {
    // お手本音声はTTS（@capacitor-community/text-to-speech）で読み上げる。
    // VOAのようにゆっくり聞こえるよう、rateを標準(1.0)より落として指定する。
    const segment = this.article.segments[this.segmentIndex];
    const plugins = window.Capacitor?.Plugins ?? {};

    if (plugins.TextToSpeech) {
      await plugins.TextToSpeech.speak({
        text: segment,
        lang: "en-US",
        rate: 0.8,
      }).catch((e) => console.warn("音声読み上げエラー:", e));
    } else {
      // プラグイン未導入時（Web確認用モック）
      console.info("[mock] TextToSpeechプラグイン未導入のため、読み上げをスキップします");
    }

    this.listenCount += 1;
    document.getElementById("listen-count").textContent = String(this.listenCount);
    if (this.listenCount >= 3) {
      document.getElementById("btn-to-shadow").disabled = false;
    }
  },

  // Step3は「録音」ではなく、SpeechRecognizerによる一発勝負の音声認識。
  // 無音/認識失敗時はOS側が数秒でタイムアウトし、エラーとして返ってくる（仕様通り）。
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

  // Step5は採点なし。ボタンはトグル式（● 録音開始 ⇄ ■ 録音停止）。
  // 停止時に@capacitor/filesystemへファイル保存し、StorageServiceに軽量メタデータを記録する。
  async recordOutput() {
    const plugins = window.Capacitor?.Plugins ?? {};
    const btn = document.getElementById("btn-record-output");
    const status = document.getElementById("output-recording-status");

    if (!plugins.VoiceRecorder) {
      // プラグイン未導入時（Web確認用モック）
      console.info("[mock] VoiceRecorderプラグイン未導入のため、録音をスキップします");
      return;
    }

    if (!this.isRecordingOutput) {
      // 録音開始
      try {
        const permission = await plugins.VoiceRecorder.requestAudioRecordingPermission();
        if (!permission?.value) {
          alert("録音を行うには、マイクの使用を許可してください。");
          return;
        }
        await plugins.VoiceRecorder.startRecording();
        this.isRecordingOutput = true;
        btn.textContent = "■ 録音停止";
        status?.classList.remove("hidden");
      } catch (e) {
        console.error("録音開始に失敗:", e);
        alert("録音を開始できませんでした。");
      }
      return;
    }

    // 録音停止 -> ファイル保存 -> メタデータ記録
    btn.disabled = true;
    try {
      const result = await plugins.VoiceRecorder.stopRecording();
      const { recordDataBase64, mimeType } = result.value;
      const filePath = await this._saveOutputRecording(recordDataBase64, mimeType);

      await StorageService.addOutputRecording(
        StorageService._dateKey(new Date()),
        this.article.id,
        this.segmentIndex,
        filePath,
        this.article.title,
        mimeType
      );

      btn.textContent = "✓ 録音済み";
    } catch (e) {
      console.error("録音の保存に失敗:", e);
      alert("録音の保存に失敗しました。");
      btn.textContent = "● 録音開始";
    } finally {
      this.isRecordingOutput = false;
      status?.classList.add("hidden");
      btn.disabled = false;
    }
  },

  async _saveOutputRecording(base64Data, mimeType) {
    const { Filesystem } = window.Capacitor.Plugins;
    // 実際の拡張子・MIMEタイプはプラットフォーム依存（Android/iOSは audio/aac、Web(Chrome)は audio/webm 等）。
    // 固定で.wav扱いにすると再生できないため、プラグインが返すmimeTypeをそのまま使う。
    const ext = (mimeType.split("/")[1] || "m4a").split(";")[0];
    const dateKey = StorageService._dateKey(new Date());
    const fileName = `${dateKey}_${this.article.id}_${this.segmentIndex}.${ext}`;
    const filePath = `recordings/${fileName}`;

    await Filesystem.writeFile({
      path: filePath,
      data: base64Data,
      directory: "DATA",
      recursive: true,
    });

    return filePath;
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
