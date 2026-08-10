# シャドーイング日課（MVP雛形）

英語ニュース（VOA Learning English）でシャドーイング練習をするAndroidアプリの初期プロジェクトです。
Capacitorベース。CHAIN ARROWSと同じ勘所でセットアップできます。

## セットアップ手順（Mac mini M1想定）

```bash
cd shadowing-app
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Android Studioが開いたら、実機 or エミュレータでRunして動作確認してください。

## 先にやること（重要・未完了タスク）

1. **VOA RSSの実URLに差し替え**
   `www/js/rss.js` の `VOA_RSS_URL` はプレースホルダーです。
   https://learningenglish.voanews.com/ を開き、使いたいカテゴリ（Top Stories等）のRSSフィードURLを確認して差し替えてください。

2. **AndroidManifest.xmlに権限追加**
   `npx cap add android` 後、`android/app/src/main/AndroidManifest.xml` に以下を追加：
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   ```

3. **音声認識・録音プラグインの実装確認**
   `package.json` に以下を仮追加済みです。`npm install` 後、`npx cap sync` で反映されます。
   - `@capacitor-community/speech-recognition`（Step3のシャドーイング判定に使用）
   - `capacitor-voice-recorder`（Step5のアウトプット録音に使用。現状は保存処理が未実装のstubです）

   `www/js/practice.js` の `_recognizeSpeech()` と `recordOutput()` に実装が必要です。
   プラグイン未導入の状態でもWebViewでは動作確認できるよう、モックにフォールバックする作りにしてあります。

4. **CORS対策の確認**
   `rss.js` は `Capacitor.isNativePlatform()` で判定し、ネイティブ実行時は `CapacitorHttp`（CORS制限なし）を使う設計にしています。ブラウザでのデバッグ時にRSS取得がCORSで失敗する場合は、開発中だけプロキシを挟むか、実機/エミュレータで確認してください。

5. **日本語要約（Step1）の生成方法**
   現状、`article.summaryJa` は未設定（プレースホルダー表示）です。以下のいずれかで用意する想定：
   - RSSの `description` を簡易的に機械翻訳して保存
   - Claude APIなどで記事要約を生成しキャッシュ

## ディレクトリ構成

```
shadowing-app/
├── capacitor.config.json
├── package.json
└── www/
    ├── index.html          # 5画面のSPA構造（ホーム/練習/カレンダー/履歴/設定）
    ├── css/style.css
    └── js/
        ├── rss.js          # VOA RSS取得・パース
        ├── storage.js      # Capacitor Preferencesラッパー（記録・キャッシュ）
        ├── scoring.js      # 発音スコアリング（フェーズ1: 単語一致率）+ Glue Wordハイライト
        ├── calendar.js     # マス目カレンダー描画
        ├── practice.js     # 5ステップ練習フローの制御
        └── app.js           # ルーティング・イベント配線
```

## 仕様書

`shadowing_app_spec.md`（別途作成済み）を参照してください。
