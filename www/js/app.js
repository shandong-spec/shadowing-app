// app.js
// エントリーポイント: 画面ルーティングと各種イベントの配線

const App = {
  todayArticle: null,
  _currentPlayback: null, // { audio, btn } 再生中の録音（同時に複数再生させないための管理用）

  async init() {
    this._wireNav();
    this._wirePracticeButtons();
    this._wireSettings();
    this._wireHistory();
    await this.refreshHome();
  },

  showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${name}`).classList.add("active");

    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });

    if (name === "calendar") {
      CalendarService.renderFull(document.getElementById("full-calendar"));
    }
    if (name === "history") {
      this._renderHistory();
    }
  },

  _wireNav() {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.showView(btn.dataset.view));
    });
  },

  async refreshHome() {
    const streak = await StorageService.getStreak();
    document.getElementById("streak-count").textContent = String(streak);

    await CalendarService.renderMini(document.getElementById("mini-calendar"));

    const container = document.getElementById("today-article");
    const startBtn = document.getElementById("btn-start-practice");

    try {
      this.todayArticle = await this._loadTodayArticle();
      container.innerHTML = `
        <h3>${this._escape(this.todayArticle.title)}</h3>
        <p class="hint">${this.todayArticle.segments.length}セグメント / ${this.todayArticle.date}</p>
      `;
      startBtn.disabled = false;
    } catch (e) {
      console.error("記事の取得に失敗:", e);
      // TODO(デバッグ用・一時的): 原因調査後は元のメッセージに戻すこと
      container.innerHTML = `<p class="loading">エラー: ${this._escape(e.message)}</p>`;
      startBtn.disabled = true;
    }
  },

  async _loadTodayArticle() {
    // まずキャッシュを確認し、未取得 or 古い場合はGitHub Pages(latest.json)から再取得
    const cache = await StorageService.getArticlesCache();
    const todayKey = StorageService._dateKey(new Date());

    const cachedForToday = cache.find((a) => a.cachedDateKey === todayKey);
    if (cachedForToday) return cachedForToday;

    const fetched = await ContentService.fetchTodayArticle();
    const article = { ...fetched, cachedDateKey: todayKey };

    await StorageService.setArticlesCache([article, ...cache].slice(0, 30));
    return article;
  },

  _wirePracticeButtons() {
    document.getElementById("btn-start-practice").addEventListener("click", () => {
      if (this.todayArticle) PracticeController.start(this.todayArticle);
    });

    document.querySelectorAll(".next-step").forEach((btn) => {
      // Step1 -> Step2 の遷移のみここで共通処理、他は個別ボタンで制御
    });

    document.querySelector("#step-meaning .next-step").addEventListener("click", () => {
      PracticeController._showStep("listen");
    });

    document.getElementById("btn-play-model").addEventListener("click", () => {
      PracticeController.playModelAudio();
    });

    document.getElementById("btn-to-shadow").addEventListener("click", () => {
      PracticeController._showStep("shadow");
    });

    document.getElementById("btn-skip-listen").addEventListener("click", () => {
      // 再生回数に関わらずシャドーイングへ進める（慣れたユーザー向けのスキップ）
      PracticeController._showStep("shadow");
    });

    document.getElementById("btn-record").addEventListener("click", () => {
      // ボタンテキストや状態表示はrecordShadowing()側でトグル管理する
      PracticeController.recordShadowing();
    });

    document.getElementById("btn-to-output").addEventListener("click", () => {
      PracticeController.goToOutput();
    });

    document.getElementById("btn-record-output").addEventListener("click", () => {
      // ボタンテキストや録音中表示はrecordOutput()側でトグル管理する
      PracticeController.recordOutput();
    });

    document.getElementById("chk-show-segment-text").addEventListener("change", (e) => {
      PracticeController.toggleSegmentTextVisibility(e.target.checked);
    });

    document.getElementById("btn-finish-segment").addEventListener("click", () => {
      PracticeController.finishSegment();
    });
  },

  _wireSettings() {
    document.getElementById("btn-reset-data").addEventListener("click", async () => {
      const ok = confirm("学習データをすべて削除します。よろしいですか？");
      if (!ok) return;
      await StorageService.resetAll();
      await this.refreshHome();
      this.showView("home");
    });
  },

  async _renderHistory() {
    const cache = await StorageService.getArticlesCache();
    const container = document.getElementById("history-list");
    if (cache.length === 0) {
      container.innerHTML = `<p class="hint">まだ履歴がありません。</p>`;
    } else {
      container.innerHTML = cache
        .map(
          (a) => `
        <div class="card" style="margin-bottom:12px;">
          <h3>${this._escape(a.title)}</h3>
          <p class="hint">${a.date ?? ""}</p>
        </div>
      `
        )
        .join("");
    }

    await this._renderOutputRecordings();
    await this._renderShadowingRecordings();
  },

  async _renderOutputRecordings() {
    const recordings = await StorageService.getOutputRecordings();
    const container = document.getElementById("my-recordings-list");

    if (recordings.length === 0) {
      container.innerHTML = `<p class="hint">まだ録音がありません。</p>`;
      return;
    }

    container.innerHTML = recordings
      .map(
        (r, i) => `
        <div class="card recording-item">
          <div>
            <div>${this._escape(r.title || "")}</div>
            <p class="hint">${r.date ?? ""}</p>
          </div>
          <button class="play-recording-btn" data-list="output" data-index="${i}" aria-label="再生">▶</button>
        </div>
      `
      )
      .join("");
  },

  async _renderShadowingRecordings() {
    const recordings = await StorageService.getShadowingRecordings();
    const container = document.getElementById("shadowing-recordings-list");

    if (recordings.length === 0) {
      container.innerHTML = `<p class="hint">まだ録音がありません。</p>`;
      return;
    }

    container.innerHTML = recordings
      .map((r, i) => {
        const scoreText = r.score != null ? ` ・ 伝わる度 ${r.score}点` : "";
        return `
        <div class="card recording-item">
          <div>
            <div>${this._escape(r.title || "")}</div>
            <p class="hint">${r.date ?? ""}${scoreText}</p>
          </div>
          <button class="play-recording-btn" data-list="shadowing" data-index="${i}" aria-label="再生">▶</button>
        </div>
      `;
      })
      .join("");
  },

  _wireHistory() {
    document.getElementById("view-history").addEventListener("click", async (e) => {
      const btn = e.target.closest(".play-recording-btn");
      if (!btn) return;

      const recordings =
        btn.dataset.list === "shadowing"
          ? await StorageService.getShadowingRecordings()
          : await StorageService.getOutputRecordings();
      const rec = recordings[Number(btn.dataset.index)];
      if (!rec) return;

      await this._playRecording(rec, btn);
    });
  },

  async _playRecording(rec, btn) {
    const { Filesystem } = window.Capacitor?.Plugins ?? {};
    if (!Filesystem) {
      console.info("[mock] Filesystemプラグイン未導入のため、録音の再生をスキップします");
      return;
    }

    // 別の録音が再生中なら止めてから、新しい方を再生する（同時に2つ鳴らないように）
    this._stopCurrentPlayback();

    try {
      const { data } = await Filesystem.readFile({ path: rec.filePath, directory: "DATA" });
      const mime = rec.mimeType || "audio/aac";
      const audio = new Audio(`data:${mime};base64,${data}`);

      const resetButton = () => {
        if (this._currentPlayback?.audio === audio) {
          this._currentPlayback = null;
        }
        btn.textContent = "▶";
        btn.disabled = false;
      };
      audio.addEventListener("ended", resetButton);
      audio.addEventListener("error", resetButton);

      this._currentPlayback = { audio, btn };
      btn.textContent = "⏸ 再生中...";
      btn.disabled = true;

      await audio.play().catch((e) => {
        console.warn("録音再生エラー:", e);
        resetButton();
      });
    } catch (e) {
      console.error("録音の読み込みに失敗:", e);
      alert("録音を再生できませんでした。");
      btn.textContent = "▶";
      btn.disabled = false;
    }
  },

  _stopCurrentPlayback() {
    if (!this._currentPlayback) return;
    const { audio, btn } = this._currentPlayback;
    audio.pause();
    audio.currentTime = 0;
    btn.textContent = "▶";
    btn.disabled = false;
    this._currentPlayback = null;
  },

  _escape(str) {
    return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  },
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
