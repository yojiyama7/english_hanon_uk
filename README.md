# English Hanon Sound Player

English Hanonの音声と文字起こしを、ユーザーが端末上で選択したフォルダから取り込んで利用するSvelteKitアプリです。

各プレイヤーには、現在位置と総再生時間を小数第1位まで表示します。

## 音声データの扱い

- サイトが保持するのは、タイトル、Unit番号、Section番号、音声種別、想定ファイル名、ラベル付き再生位置からなる静的カタログだけです。
- 再生位置は秒単位の数値（例: `12.3`）で指定します。
- MP3ファイルはリポジトリ、ビルド成果物、サーバーには含めません。
- 選択されたMP3は容量確認とユーザーの承認後にブラウザ専用のOPFSへコピーされ、外部へアップロードされません。
- 初回取り込み後はOPFSから読み込むため、起動のたびに元フォルダへのアクセス許可を求めません。
- サイトデータを削除すると取り込んだ教材も削除されるため、その場合は再取り込みが必要です。
- ローカル音声フォルダ `english_hanon_mp3/` は `.gitignore` で除外されています。

カタログとピンは `src/lib/audio-catalog.ts` で管理します。

## 文字起こし

教材フォルダには任意でUTF-8の `.txt` ファイルを1つ置けます。各レッスンは次の見出し形式で指定します。順番は問いません。本文内の空行も保持されます。

```text
[Unit 0.1]
This is the transcript for Unit 0.1.

本文内では空行も自由に使えます。

[Unit 0.2]
This is the transcript for Unit 0.2.
```

カタログにない見出しは取り込み確認画面で警告され、無視されます。重複見出し、空の本文、見出し前の本文はエラーになります。文字起こしがないレッスンやTXT自体がない教材も音声のみで利用できます。

開発サーバーでは各プレイヤーにピン編集欄が表示されます。音声を目的の位置まで進め、ラベルを入力して「現在位置にピン」を押すと、0.1秒単位の位置が `src/lib/audio-pins.json` に保存されます。同じ時刻にもう一度保存するとラベルを更新します。作成済みピンのラベル名や秒数は、ピン横の入力欄を変更すると自動保存され、「削除」ボタンから削除できます。編集UIと保存APIは本番では無効です。

「音に合わせる」は、ピンより後にある次の発音開始をブラウザ内で検出し、その0.4秒前へピンを移動します。ピンごとの調整と、トラック内の全ピン一括調整に対応しています。ピン位置ですでに音が出ている場合や調整先が別ピンと重なる場合は変更しません。

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.17.0 create --template minimal --types ts --install npm .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
