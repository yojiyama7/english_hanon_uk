# English Hanon Sound Player

English Hanonの音声を、ユーザーが端末上で選択したフォルダから再生するSvelteKitアプリです。

## 音声データの扱い

- サイトが保持するのは、タイトル、Unit番号、Section番号、音声種別、想定ファイル名、ラベル付き再生位置からなる静的カタログだけです。
- 再生位置は秒単位の数値（例: `12.3`）で指定します。
- MP3ファイルはリポジトリ、ビルド成果物、サーバーには含めません。
- 選択されたMP3はブラウザ内でローカルに参照され、外部へアップロードされません。
- ローカル音声フォルダ `english_hanon_mp3/` は `.gitignore` で除外されています。

カタログとピンは `src/lib/audio-catalog.ts` で管理します。

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
