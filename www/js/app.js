// app.js
// エントリーポイント: 画面ルーティングと各種イベントの配線

const App = {
  todayArticle: null,

  async init() {
    this._wireNav();
    this._wirePracticeButtons();
    this._wireSettings();
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

    document.getElementById("btn-record").addEventListener("click", async (e) => {
      e.target.textContent = "認識中...";
      e.target.disabled = true;
      await PracticeController.recordShadowing();
      e.target.textContent = "● 録音開始";
      e.target.disabled = false;
    });

    document.getElementById("btn-to-feedback").addEventListener("click", () => {
      PracticeController.showFeedback();
    });

    document.getElementById("btn-to-output").addEventListener("click", () => {
      PracticeController.goToOutput();
    });

    document.getElementById("btn-record-output").addEventListener("click", async (e) => {
      await PracticeController.recordOutput();
      e.target.textContent = "✓ 録音済み";
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
      return;
    }
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
  },

  _escape(str) {
    return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  },
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
