// ads.js
// AdMob広告(バナー・インタースティシャル)の初期化・表示を担当する
//
// 開発中は必ずisTesting: trueにして、本番の広告ユニットIDを使っていても
// テスト広告だけが表示されるようにしている。Google Play公開が近づいたら
// IS_TESTINGをfalseにする（このコメント自体がその時の目印）。

const ADS_IS_TESTING = true;

// isTesting:trueの間は本質的に不要だが、IS_TESTINGをfalseにした後もこの端末では
// 誤って実広告が出ないよう保険として端末IDを登録できるようにしている。
// 取得方法: 実機でAdMob.initialize()を一度実行し、logcatに出力される
// "Use RequestConfiguration.Builder.setTestDeviceIds(Arrays.asList("XXXX"))"のIDを転記する。
const ADS_TEST_DEVICE_IDS = [
  "83E89B1A3096E983CDA68DAFD54876AB", // Pixel 9 (実機確認用)
];

const BANNER_AD_ID = "ca-app-pub-2465265118773151/7492243090";
const INTERSTITIAL_AD_ID = "ca-app-pub-2465265118773151/2871040020";

const AdsService = {
  _ready: false,

  async init() {
    const { AdMob } = window.Capacitor?.Plugins ?? {};
    if (!AdMob) {
      console.info("[mock] AdMobプラグイン未導入のため、広告をスキップします");
      return;
    }

    try {
      await AdMob.initialize({
        testingDevices: ADS_TEST_DEVICE_IDS,
        initializeForTesting: ADS_TEST_DEVICE_IDS.length > 0,
      });
      this._ready = true;
    } catch (e) {
      console.warn("AdMobの初期化に失敗:", e);
    }
  },

  // ホーム画面下部にバナー広告を表示する。
  //
  // 注意: @capacitor-community/admob@8.0.0のBannerExecutorは、Android 15(API 35)以降で
  // 「Safe Area」対応のためbottom marginをこちらが指定した値ではなく常にシステムの
  // ジェスチャーナビゲーションバーのinsetだけで上書きしてしまう(margin指定が実質無視される)。
  // そのため、画面下端(ジェスチャーバーのすぐ上)にバナーが張り付き、こちらのボトムナビと
  // 重なってしまう。native側のmarginを当てにせず、実際に確定したバナー高さ(bannerAdSizeChanged)
  // をアプリ側のCSSに反映してボトムナビ自体を押し上げることで、確実に重ならないようにしている。
  async showHomeBanner() {
    const { AdMob } = window.Capacitor?.Plugins ?? {};
    if (!AdMob || !this._ready || this._bannerShown) return;

    const bottomNav = document.querySelector(".bottom-nav");
    const margin = bottomNav ? Math.ceil(bottomNav.getBoundingClientRect().height) : 0;

    try {
      AdMob.addListener("bannerAdSizeChanged", (size) => {
        const height = size?.height > 0 ? Math.ceil(size.height) : 0;
        if (bottomNav) bottomNav.style.bottom = `${height}px`;
        document.body.style.paddingBottom = `${64 + height}px`;
      });

      await AdMob.showBanner({
        adId: BANNER_AD_ID,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        margin,
        isTesting: ADS_IS_TESTING,
      });
      this._bannerShown = true;
    } catch (e) {
      console.warn("バナー広告の表示に失敗:", e);
    }
  },

  // その日のシャドーイングセッション完了時に、1日1回だけインタースティシャル広告を表示する。
  // 表示に成功した場合のみ「表示済み」を記録する（失敗時は次回の完了操作で再挑戦できるようにする）。
  async maybeShowDailyInterstitial() {
    const { AdMob } = window.Capacitor?.Plugins ?? {};
    if (!AdMob || !this._ready) return;

    const todayKey = StorageService._dateKey(new Date());
    const lastShownDate = await StorageService.getLastInterstitialDate();
    if (lastShownDate === todayKey) return;

    try {
      await AdMob.prepareInterstitial({ adId: INTERSTITIAL_AD_ID, isTesting: ADS_IS_TESTING });
      await AdMob.showInterstitial();
      await StorageService.setLastInterstitialDate(todayKey);
    } catch (e) {
      console.warn("インタースティシャル広告の表示に失敗:", e);
    }
  },
};
