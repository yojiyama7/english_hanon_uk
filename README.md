# English Hanon Sound Player

English Hanonの音声を、ユーザーが端末上で選択したフォルダから再生するSvelteKitアプリです。

各プレイヤーには、現在位置と総再生時間を小数第1位まで表示します。

## 音声データの扱い

- サイトが保持するのは、タイトル、Unit番号、Section番号、音声種別、想定ファイル名、ラベル付き再生位置からなる静的カタログだけです。
- 再生位置は秒単位の数値（例: `12.3`）で指定します。
- MP3ファイルはリポジトリ、ビルド成果物、サーバーには含めません。
- 選択されたMP3はブラウザ内でローカルに参照され、外部へアップロードされません。
- ローカル音声フォルダ `english_hanon_mp3/` は `.gitignore` で除外されています。

カタログとピンは `src/lib/audio-catalog.ts` で管理します。

開発サーバーでは各プレイヤーにピン編集欄が表示されます。音声を目的の位置まで進め、ラベルを入力して「現在位置にピン」を押すと、0.1秒単位の位置が `src/lib/audio-pins.json` に保存されます。同じ時刻にもう一度保存するとラベルを更新します。作成済みピンの秒数は、ピン横の数値を変更すると自動保存されます。編集UIと保存APIは本番では無効です。

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
