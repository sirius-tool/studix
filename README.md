# STUDIX プッシュ通知機能（実装パッケージ）

このフォルダーは、既存STUDIXに締切通知・毎日の勉強リマインドを追加するための更新ファイル一式です。既存の画面やlocalStorageのデータ形式は維持し、課題・テスト日程を通知APIへ同期します。

## 含まれるもの
- `index.html`：通知設定画面・プッシュ購読・同期処理を追加したSTUDIX本体
- `manifest.json`：既存PWAマニフェスト
- `service-worker.js`：既存キャッシュ処理＋push/notificationclickイベント
- `icons/`：既存アイコン
- `backend/worker.js`：Cloudflare Worker APIと定期通知処理
- `backend/schema.sql`：D1データベースのテーブル
- `backend/wrangler.toml`：Worker / D1 / 毎時Cronの設定ひな形

## 大事な注意
**ファイルをGitHub Pagesにアップロードしただけでは、通知配信はまだ有効になりません。** Cloudflare側のWorkerとD1を作成し、VAPIDキーを秘密情報として設定してから、フロントエンドのAPI URLを指定する必要があります。VAPID秘密鍵は絶対に `index.html` やGitHubへ入れないでください。

## A. GitHub Pages側
1. 念のため現在のリポジトリをバックアップします。
2. このフォルダー内の `index.html`、`manifest.json`、`service-worker.js` と `icons/` を、`sirius-tool/studix` の公開元へ配置します。
3. GitHub PagesのURLは `https://sirius-tool.github.io/studix/` を想定しています。

## B. Cloudflare側の準備
この作業はCloudflareアカウントが必要です。

1. Cloudflare DashboardでD1データベースを `studix-push` という名前で作成します。
2. D1のConsoleで `backend/schema.sql` のSQLを実行します。
3. D1のDatabase IDをコピーし、`backend/wrangler.toml` の `database_id` に設定します。
4. `backend/` フォルダーでターミナルを開き、`npm install` を実行します。
5. VAPIDキーを生成します（Node.jsとnpmが必要）：
   ```bash
   npx web-push generate-vapid-keys
   ```
6. `backend/` 内でWorkerをCloudflareへデプロイします。Cloudflareの案内に沿ってログインし、`npx wrangler deploy` を実行します。初回はD1 IDを設定してから実行してください。
7. WorkerのSettings → Variables and Secretsで次の**Secrets**を追加します：
   - `VAPID_PUBLIC_KEY`：生成した公開鍵
   - `VAPID_PRIVATE_KEY`：生成した秘密鍵（Secret）
   - `VAPID_SUBJECT`：`mailto:連絡用メールアドレス`
8. WorkerのURL（例：`https://studix-push-api.<あなたのサブドメイン>.workers.dev`）を控えます。
9. `index.html` の `window.STUDIX_PUSH_API` の値 `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` を、実際のWorker URLに置き換えてGitHubへ反映します。
10. WorkerのCron Triggersで `0 * * * *` が登録されていることを確認します。

> 注意：Cloudflareの管理画面やCLIの表記は変更される場合があります。Workerを公開する前に、Cloudflareの現在の設定画面で必要なバインディング・シークレットを確認してください。

## C. テスト手順
1. `https://sirius-tool.github.io/studix/` をChrome / Edgeで開く。HTTPSであることを確認します。
2. 「通知設定」→「通知を有効にする」を押し、通知を許可します。
3. 「テスト通知」を押し、通知が届くか確認します。
4. 課題に明日の日付を締切として登録し、同期後に締切通知が配信されるか確認します。
5. 毎日の通知時刻を次の日本時間の正時に設定し、曜日を選んで、Workerの次回Cron実行後に通知を確認します。

## 仕様と制約
- 時刻は日本時間（Asia/Tokyo）で扱います。毎日のリマインド時刻は毎時0分（例：19:00）に設定できます。
- Cronは毎時実行のため、配信はスケジュール処理の実行時刻に依存します。
- 通知対象は、現在のブラウザに保存されている未完了課題とテスト日程です。端末をまたいだデータ共有・ログイン機能は含みません。
- この実装は端末ごとのランダムなID/トークンでAPIを保護しますが、一般公開APIなので悪用防止のためCloudflare側の利用状況を確認してください。将来ユーザー登録や共有機能を追加するなら、認証とレート制限を強化してください。
- OSやブラウザーの通知設定、端末の省電力設定、ブラウザーの対応状況によっては通知が遅れたり届かなかったりする場合があります。
- 「この端末の通知を停止」はサーバー側の端末登録を削除します。再開するときは「通知を有効にする」を押してください。
