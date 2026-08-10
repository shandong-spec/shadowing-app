// calendar.js
// GitHubコントリビューショングラフ風のマス目カレンダー描画

const CalendarService = {
  /**
   * 直近N日分のミニカレンダーをホーム画面に描画
   */
  async renderMini(containerEl, days = 14) {
    const records = await StorageService.getDailyRecords();
    containerEl.innerHTML = "";
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = StorageService._dateKey(d);
      const rec = records[key];
      containerEl.appendChild(this._makeCell(rec));
    }
  },

  /**
   * 過去1年分をフルカレンダー画面に描画
   */
  async renderFull(containerEl, days = 182) {
    const records = await StorageService.getDailyRecords();
    containerEl.innerHTML = "";
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = StorageService._dateKey(d);
      const rec = records[key];
      const cell = this._makeCell(rec);
      cell.title = key;
      containerEl.appendChild(cell);
    }
  },

  _makeCell(rec) {
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (rec) {
      if (rec.status === "bonus") cell.classList.add("bonus");
      else if (rec.status === "full") cell.classList.add("full");
      else if (rec.status === "partial") cell.classList.add("partial");
    }
    return cell;
  },
};
