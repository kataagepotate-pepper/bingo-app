// オフライン版を「ダブルクリックで開ける1つのHTMLファイル」にまとめる。
// CSS・JavaScript・効果音・画像（offline/assets/）を全部ファイルの中に埋め込むので、ネットがなくても動く。
//   npm run offline                     → デスクトップに「ビンゴ大会.html」を作る
//   node scripts/build-offline.mjs 出力先 → 好きな場所に作る
// 作る前の確認だけなら offline/index.html を直接ブラウザで開いてもいい（音は鳴らない）
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const src = join(root, "offline");
const out = process.argv[2] || join(homedir(), "Desktop", "ビンゴ大会.html");

// 使う効果音（public/sounds の mp3。音源：効果音ラボ）
const SOUND_FILES = { drumroll: "drumroll.mp3", rollEnd: "roll-end.mp3" };
const sounds = Object.fromEntries(
  Object.entries(SOUND_FILES).map(([name, file]) => [name, readFileSync(join(root, "public", "sounds", file)).toString("base64")]),
);

// </script> がJavaScriptの中に出てきてもHTMLが壊れないようにする
const safeScript = (s) => s.replace(/<\/script/gi, "<\\/script");
const imageCount = { n: 0 };

const html = readFileSync(join(src, "index.html"), "utf8")
  .replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${readFileSync(join(src, "style.css"), "utf8")}\n</style>`)
  .replace(
    '<script src="app.js"></script>',
    () => `<script>\nconst SOUNDS = ${JSON.stringify(sounds)};\n${safeScript(readFileSync(join(src, "app.js"), "utf8"))}\n</script>`,
  )
  .replace(/src="assets\/([\w-]+\.png)"/g, (_, file) => {
    imageCount.n++;
    return `src="data:image/png;base64,${readFileSync(join(src, "assets", file)).toString("base64")}"`;
  });

writeFileSync(out, html);
console.log(`作成しました: ${out}（${(html.length / 1024 / 1024).toFixed(1)}MB、画像${imageCount.n}枚・効果音${Object.keys(sounds).length}つ）`);
