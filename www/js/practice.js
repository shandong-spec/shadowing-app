// practice.js
// 5ステップ（意味理解→多聴→シャドーイング→フィードバック→アウトプット）の進行を管理
//
// 音声認識・録音・読み上げは実機ネイティブプラグインに依存するため、
// プラグイン未導入時（Web確認時）はモックで動作確認できるようにしている。
// 使用プラグイン:
//   - お手本読み上げ: @capacitor-community/text-to-speech
//   - アウトプット録音(Step5): capacitor-voice-recorder + @capacitor/filesystem（ファイル保存）
//   - シャドーイング音声認識(Step3): @capacitor-community/speech-recognition
//     -> ボタンはトグル式。start()は「終了」タップ or 自然な無音検知まで解決しないPromiseなので、
//        開始時にawaitせず保持しておき、終了タップ時にstop()を呼んでから改めてawaitする。
//   - シャドーイング音声録音(Step3): capacitor-voice-recorder（音声認識と並行して開始・終了する）

const PracticeController = {
  article: null,
  segmentIndex: 0,
  listenCount: 0,
  lastRecognizedText: "",
  lastScore: 0,
  isRecordingOutput: false,
  isRecordingShadowing: false,
  showSegmentText: false,
  _shadowingAudioStarted: false,
  _shadowingRecognitionPromise: null,

  async start(article) {
    this.article = article;
    this.segmentIndex = 0;
    this.showSegmentText = await StorageService.getShowSegmentTextStep5();
    document.getElementById("chk-show-segment-text").checked = this.showSegmentText;
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
    document.getElementById("output-recording-status").classList.remove("save-warning");

    // Step3: 録音ボタン/保存失敗メッセージを新しいセグメント用にリセット
    this.isRecordingShadowing = false;
    this._shadowingAudioStarted = false;
    this._shadowingRecognitionPromise = null;
    document.getElementById("btn-record").textContent = "🎤 話してみる（タップして発音）";
    document.getElementById("btn-record").disabled = false;
    document.getElementById("shadowing-recording-status").classList.add("hidden");

    // Step5: 英文表示（トグルがONの場合のみ、Glue Word/キーワードハイライト付きで表示）
    this._renderOutputSegmentText(segment);

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

  // Step3のボタンはStep5と同じトグル式（🎤 話してみる ⇄ ■ 終了）。
  // SpeechRecognizerの自然な無音検知に任せると発話の途中で切れてしまうため、
  // ユーザーが「■ 終了」を押した時点でstop()を呼んで確定させる。
  // capacitor-voice-recorderでも同時に録音し、後で聞き返せるように保存する。
  async recordShadowing() {
    const btn = document.getElementById("btn-record");
    const plugins = window.Capacitor?.Plugins ?? {};

    if (!this.isRecordingShadowing) {
      // 開始: 録音と音声認識を同時に始める。認識結果は「終了」が押されるまで待つ。
      this._shadowingAudioStarted = false;
      if (plugins.VoiceRecorder) {
        try {
          const permission = await plugins.VoiceRecorder.requestAudioRecordingPermission();
          if (permission?.value) {
            await plugins.VoiceRecorder.startRecording();
            this._shadowingAudioStarted = true;
          }
        } catch (e) {
          // 音声認識自体は録音の成否に関わらず続行する
          console.warn("シャドーイング音声の録音開始に失敗（音声認識は続行します）:", e);
        }
      }

      // start()のPromiseは「終了」タップ or 自然な無音検知まで解決しないため、
      // ここではawaitせず保持しておく（早期rejectでコンソール警告が出ないよう空catchを付けておく）
      this._shadowingRecognitionPromise = this._startRecognition();
      this._shadowingRecognitionPromise.catch(() => {});

      this.isRecordingShadowing = true;
      btn.textContent = "■ 終了";
      return;
    }

    // 終了: 音声認識・録音の両方を止めて結果を確定させる
    btn.disabled = true;
    btn.textContent = "👂 認識中...";

    const segment = this.article.segments[this.segmentIndex];
    try {
      const recognizedText = await this._stopRecognitionAndGetResult();
      this.lastRecognizedText = recognizedText;
      this.lastScore = ScoringService.scoreTranscript(segment, recognizedText);
    } catch (e) {
      console.warn("音声認識に失敗、スコアは保留:", e);
      this.lastRecognizedText = "";
      this.lastScore = 0;
    }

    const statusEl = document.getElementById("shadowing-recording-status");
    if (this._shadowingAudioStarted) {
      try {
        const result = await plugins.VoiceRecorder.stopRecording();
        const { recordDataBase64, mimeType, msDuration } = result.value;

        const isValid = await this._isRecordingValid(recordDataBase64, mimeType, msDuration);
        if (!isValid) {
          // SpeechRecognitionとの同時録音は稀に破損したデータを返すことがある（実測で約1割）。
          // 破損データを保存しても再生できないだけなので、スコアには一切影響を与えずスキップする。
          console.warn(`シャドーイング音声が破損している可能性があるため保存をスキップします（報告時間${msDuration}ms）`);
          this._showSaveWarning(statusEl);
        } else {
          const filePath = await this._saveRecordingFile(recordDataBase64, mimeType, "shadowing");
          await StorageService.addShadowingRecording(
            StorageService._dateKey(new Date()),
            this.article.id,
            this.segmentIndex,
            filePath,
            this.article.title,
            mimeType,
            segment,
            this.lastScore
          );
        }
      } catch (e) {
        // capacitor-voice-recorderとSpeechRecognitionの同時利用はマイクリソースが競合し、
        // 稀にFAILED_TO_FETCH_RECORDING等で失敗することがある（実測で約4割）。
        // スコアには影響させず、音声保存のみ失敗として扱う。
        console.warn("シャドーイング音声の保存に失敗（スコアには影響しません）:", e);
        this._showSaveWarning(statusEl);
      }
    }

    document.getElementById("btn-to-feedback").classList.remove("hidden");

    this.isRecordingShadowing = false;
    btn.textContent = "🎤 話してみる（タップして発音）";
    btn.disabled = false;
  },

  // SpeechRecognition.start()を発火だけさせ、Promiseはユーザーが終了ボタンを押すまで待つ。
  async _startRecognition() {
    const plugins = window.Capacitor?.Plugins ?? {};
    if (plugins.SpeechRecognition) {
      await plugins.SpeechRecognition.requestPermissions();
      // このPromiseは stop() が呼ばれる（or 自然に発話が途切れる）まで解決しない
      return plugins.SpeechRecognition.start({
        language: "en-US",
        maxResults: 1,
        partialResults: false,
      });
    }
    // プラグイン未導入時（Web確認用モック）
    console.info("[mock] SpeechRecognitionプラグイン未導入のため、ダミーテキストを返します");
    return { matches: [this.article.segments[this.segmentIndex]] };
  },

  // stop()はAndroidのSpeechRecognizer.stopListening()相当。
  // 「その時点までに話した内容」で認識を確定させ、start()側のPromiseが結果を持って解決する。
  // すでに自然に終了していた場合はネイティブ側で無視される安全な呼び出し。
  //
  // 注意: @capacitor-community/speech-recognition@7.0.1のAndroid実装は、stop()の
  // 成功パスでcall.resolve()を一度も呼んでいない（call.reject()のみ実装）ため、
  // await stop() は永久にハングする（実機・エミュレータ両方で確認済みのプラグイン側バグ）。
  // stop()はawaitせず発火のみに留め、結果はstart()側のPromiseから受け取る。
  async _stopRecognitionAndGetResult() {
    const plugins = window.Capacitor?.Plugins ?? {};
    if (plugins.SpeechRecognition) {
      plugins.SpeechRecognition.stop().catch(() => {});
    }
    // プラグインの未知の不具合でstart()側も解決しないケースに備え、UIが永久に固まらないよう保険を掛ける
    const result = await this._raceWithTimeout(this._shadowingRecognitionPromise, 8000);
    return result?.matches?.[0] ?? "";
  },

  _raceWithTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      promise.then(finish).catch(() => finish(null));
      setTimeout(() => finish(null), timeoutMs);
    });
  },

  _showSaveWarning(statusEl) {
    if (!statusEl) return;
    statusEl.textContent = "今回は音声を保存できませんでした（スコアは記録されています）";
    statusEl.classList.add("save-warning");
    statusEl.classList.remove("hidden");
  },

  // stopRecording()が返すmsDurationと、実際にデコードできる再生時間を突き合わせて
  // 録音データが破損していないか検証する。SpeechRecognitionとの同時録音時のみ発生しうる。
  async _isRecordingValid(base64Data, mimeType, msDuration) {
    if (!msDuration || msDuration <= 0) return false;
    const actualMs = await this._measureAudioDurationMs(base64Data, mimeType);
    // 大きく乖離（半分未満）していたら破損とみなす
    return actualMs >= msDuration * 0.5;
  },

  _measureAudioDurationMs(base64Data, mimeType) {
    return new Promise((resolve) => {
      const audio = new Audio(`data:${mimeType};base64,${base64Data}`);
      let settled = false;
      const finish = (ms) => {
        if (settled) return;
        settled = true;
        resolve(ms);
      };
      audio.addEventListener("loadedmetadata", () => finish((audio.duration || 0) * 1000));
      audio.addEventListener("error", () => finish(0));
      // 一部環境ではloadedmetadataが発火しないことがあるためフォールバック
      setTimeout(() => finish((audio.duration || 0) * 1000), 1500);
    });
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

  // Step5の「セグメントの英文を表示する」トグル。設定は端末に記憶し、次回以降も維持する。
  async toggleSegmentTextVisibility(checked) {
    this.showSegmentText = checked;
    await StorageService.setShowSegmentTextStep5(checked);
    this._renderOutputSegmentText(this.article.segments[this.segmentIndex]);
  },

  _renderOutputSegmentText(segment) {
    const el = document.getElementById("output-segment-text-en");
    if (this.showSegmentText) {
      el.innerHTML = ScoringService.highlightGlueWords(segment, this.article.keywords);
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
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
      const { recordDataBase64, mimeType, msDuration } = result.value;

      const isValid = await this._isRecordingValid(recordDataBase64, mimeType, msDuration);
      if (!isValid) {
        console.warn(`アウトプット音声が破損している可能性があるため保存をスキップします（報告時間${msDuration}ms）`);
        btn.textContent = "● 録音開始";
        this._showSaveWarning(status);
      } else {
        const filePath = await this._saveRecordingFile(recordDataBase64, mimeType, "recordings");
        await StorageService.addOutputRecording(
          StorageService._dateKey(new Date()),
          this.article.id,
          this.segmentIndex,
          filePath,
          this.article.title,
          mimeType
        );
        btn.textContent = "✓ 録音済み";
        status?.classList.add("hidden");
      }
    } catch (e) {
      console.warn("録音の保存に失敗:", e);
      btn.textContent = "● 録音開始";
      this._showSaveWarning(status);
    } finally {
      this.isRecordingOutput = false;
      btn.disabled = false;
    }
  },

  // Step3(shadowing/)・Step5(recordings/)共通の録音ファイル保存処理。
  async _saveRecordingFile(base64Data, mimeType, subDir) {
    const { Filesystem } = window.Capacitor.Plugins;
    // 実際の拡張子・MIMEタイプはプラットフォーム依存（Android/iOSは audio/aac、Web(Chrome)は audio/webm 等）。
    // 固定で.wav扱いにすると再生できないため、プラグインが返すmimeTypeをそのまま使う。
    const ext = (mimeType.split("/")[1] || "m4a").split(";")[0];
    const dateKey = StorageService._dateKey(new Date());
    const fileName = `${dateKey}_${this.article.id}_${this.segmentIndex}.${ext}`;
    const filePath = `${subDir}/${fileName}`;

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
