# English Hanon Sound Player

English Hanonの音声と文字起こしを、ユーザーが端末上で選択したフォルダから取り込んで利用するSvelteKitアプリです。

## 音声データの扱い

- サイトが保持するのは、タイトル、Unit番号、Section番号、音声種別、想定ファイル名、トランスクリプトの文番号に対応する再生位置からなる静的カタログだけです。
- 再生位置は秒単位の数値（例: `12.3`）で指定します。
- MP3ファイルはリポジトリ、ビルド成果物、サーバーには含めません。
- 選択されたMP3は容量確認とユーザーの承認後にブラウザ専用のOPFSへコピーされ、外部へアップロードされません。
- 初回取り込み後はOPFSから読み込むため、起動のたびに元フォルダへのアクセス許可を求めません。
- サイトデータを削除すると取り込んだ教材も削除されるため、その場合は再取り込みが必要です。
- ローカル音声フォルダ `english_hanon_mp3/` は `.gitignore` で除外されています。

カタログとピンは `src/lib/audio-catalog.ts` で管理します。

## 文字起こし

教材フォルダの直下には、任意でUTF-8の `transcript.txt` を置けます。ファイル名は大文字・小文字を区別します。その他のTXTやサブフォルダ内の `transcript.txt` は読み込みません。各レッスンは次の見出し形式で指定します。順番は問いません。本文は `- ` で始まる箇条書き1行を1文として扱い、2文字分インデントした箇条書きは入れ子の文として表示します。

```text
[Unit 0.1]
- This is the first sentence for Unit 0.1.
  - This nested response is a separate sentence.

[Unit 0.2]
- This is the transcript for Unit 0.2.
```

カタログにない見出しは取り込み確認画面で警告され、無視されます。重複見出し、空の本文、見出し前の本文はエラーになります。文字起こしがないレッスンや `transcript.txt` 自体がない教材も音声のみで利用できます。

文字起こしがあるレッスンは、見出しと音声プレイヤーがある常時表示部分をクリックすると文字起こしを開閉できます。展開された文字起こし部分にはレッスンを閉じる機能はありません。登録済みの文は行全体をクリックすると、その文に対応する位置から音声を再生します。SlowとNaturalの両方があるレッスンでは、文字起こし内のトグルで再生対象を切り替えます。初期値はSlowです。文字起こしがないレッスンではピン操作を表示しません。

開発サーバーではヘッダーの「閲覧」「編集」でモードを切り替えられます。編集モードで、対象音声を目的の位置まで進めて「現在位置を保存」を押すか、0.1秒単位の時刻を直接入力すると、レッスン内の0始まりの文番号と再生位置が `src/lib/audio-pins.json` に保存されます。登録済みの時刻は更新、音合わせ、削除ができます。

編集UIは `src/dev/PinEditor.svelte`、保存APIは `src/dev/pins-api.ts` に分離されています。どちらも開発時だけ読み込まれ、本番ビルドには編集UIのチャンクも保存APIのルートも生成されません。本番では閲覧モードだけを利用できます。

「音に合わせる」は、0.4秒以上の連続した無音のあとにある次の発音開始をブラウザ内で検出し、その発音開始の0.4秒前へピンを移動します。弱い発音から主音へ続く場合は、主音直前の弱い立ち上がりも検出します。ピン位置ですでに音が出ている場合は変更しません。この位置を0.1秒単位で切り捨てたものを規定位置として扱い、「前の規定位置」と「次の規定位置」でピンを前後に移動できます。移動後は音声プレイヤーもその位置へ頭出ししますが、自動再生はしません。

Slow音源とNatural音源の未設定ピンは、`ffmpeg` と `ffprobe` が利用できる環境で一括補完できます。どちらも同じ規定位置の検出・選択ルールを使います。既定ではドライランだけを行い、`--write` を付けた場合だけ `src/lib/audio-pins.json` を更新します。

```sh
npm run pins:auto-assign-slow
npm run pins:auto-assign-slow -- --write
npm run pins:auto-assign-natural
npm run pins:auto-assign-natural -- --write
```

## ローカルで起動

Node.js 24 以降で実行します。

```sh
npm ci
npm run dev
```

表示された localhost の URL を開き、教材フォルダを選択してください。音声と文字起こしは端末内に保存されます。localhost と Pages の保存領域は別なので、それぞれで取り込みが必要です。

## GitHub Pages へ公開

1. 教材を含めず、このリポジトリを GitHub へ push します。
2. Settings → Pages → Build and deployment → Source で **GitHub Actions** を選びます。
3. `main` または `master` への push、または Actions の `Deploy GitHub Pages` → `Run workflow` で公開します。

型チェック・テスト・本番検証後に `build/` だけを公開します。公開先のサブパスは Pages の設定から自動取得します。サーバー処理は不要です。

教材は `english_hanon_mp3/` または `local-materials/` 内に置き、文字起こしは `transcript.txt` として管理してください。音声・TXT・字幕ファイルは Git の除外対象です。教材をソースへ貼り付けたり、`static/` に置いたりしないでください。ビルド前に Git 追跡対象と静的アセットに教材ファイルがないか検査します（`robots.txt` は除外）。

公開用ビルドの確認:

```sh
npm run verify:production
npm run preview
```

サブパスの確認には `BASE_PATH=/english_hanon_sound_player npm run verify:production` を使い、同じ環境変数で `npm run preview` を実行します。`build/index.html` の直接起動ではなく HTTP サーバー経由で利用してください。

静的配信の設定は [SvelteKit 公式ドキュメント](https://svelte.dev/docs/kit/adapter-static) に準拠しています。
