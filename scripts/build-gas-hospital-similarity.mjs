import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const OUTPUT_DIR = path.join(ROOT, "gas", "hospital-similarity-webapp");
const CHUNK_SIZE = 800_000;

const htmlPath = path.join(DASHBOARD_DIR, "hospital-similarity.html");
const jsPath = path.join(DASHBOARD_DIR, "hospital-similarity.js");
const cssPath = path.join(DASHBOARD_DIR, "styles.css");
const dataPath = path.join(DASHBOARD_DIR, "hospital-similarity-data.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  for (const entry of fs.readdirSync(dirPath)) {
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
  }
}

function extractBodyContent(html) {
  const match = html.match(/<body>([\s\S]*?)<\/body>/i);
  if (!match) {
    throw new Error("hospital-similarity.html の body を抽出できませんでした。");
  }

  let body = match[1].trim();
  body = body.replace(/<script[\s\S]*?<\/script>\s*$/i, "").trim();
  return body;
}

function buildIndexHtml(bodyContent) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>全国病院 類似病院TOP10 ダッシュボード</title>
    <style>
      <?!= include('Styles'); ?>
    </style>
  </head>
  <body>
${indent(bodyContent, 4)}
    <? for (const chunkName of getDataChunkTemplateNames()) { ?>
      <?!= include(chunkName); ?>
    <? } ?>
    <script>
      <?!= include('App'); ?>
    </script>
  </body>
</html>
`;
}

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length ? `${prefix}${line}` : line))
    .join("\n");
}

function buildCodeGs(chunkNames) {
  return `const DATA_CHUNK_TEMPLATE_NAMES = ${JSON.stringify(chunkNames, null, 2)};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('全国病院 類似病院TOP10 ダッシュボード')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDataChunkTemplateNames() {
  return DATA_CHUNK_TEMPLATE_NAMES;
}
`;
}

function buildAppScriptJson() {
  return JSON.stringify(
    {
      timeZone: "Asia/Tokyo",
      exceptionLogging: "STACKDRIVER",
      runtimeVersion: "V8",
      webapp: {
        access: "ANYONE",
        executeAs: "USER_DEPLOYING",
      },
    },
    null,
    2,
  );
}

function buildReadme(chunkNames, dataBytes) {
  return `# GAS版 類似病院TOP10 ダッシュボード

このフォルダは、\`dashboard/hospital-similarity.html\` をもとに生成した Google Apps Script 用の Web アプリ一式です。

## 含まれるファイル

- \`Code.gs\`
- \`Index.html\`
- \`Styles.html\`
- \`App.html\`
- \`DataChunk_*.html\` (${chunkNames.length} 分割)
- \`appsscript.json\`

## 生成元

- HTML: \`/dashboard/hospital-similarity.html\`
- CSS: \`/dashboard/styles.css\`
- JS: \`/dashboard/hospital-similarity.js\`
- データ: \`/dashboard/hospital-similarity-data.json\`

## デプロイ手順

1. このフォルダを Apps Script プロジェクトとして push します。
2. Web アプリとしてデプロイします。
3. 必要に応じてアクセス権を調整します。

## 注意

- データJSONは ${dataBytes.toLocaleString("ja-JP")} バイトあるため、Apps Script 用に複数HTMLファイルへ分割しています。
- 元のダッシュボードを修正した場合は、ルートで \`node scripts/build-gas-hospital-similarity.mjs\` を再実行してください。
`;
}

function transformAppJs(source) {
  return source.replace(
    /^const data = await fetch\("\.\/hospital-similarity-data\.json", \{ cache: "no-store" \}\)\.then\(\(response\) => response\.json\(\)\);\s*/u,
    `const data = JSON.parse((window.__HOSPITAL_DATA_JSON_PARTS || []).join(""));` + "\n\n",
  );
}

function splitIntoChunks(content, chunkSize) {
  const chunks = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildChunkHtml(chunk) {
  return `<script>
window.__HOSPITAL_DATA_JSON_PARTS = window.__HOSPITAL_DATA_JSON_PARTS || [];
window.__HOSPITAL_DATA_JSON_PARTS.push(${JSON.stringify(chunk)});
</script>
`;
}

function main() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const data = fs.readFileSync(dataPath, "utf8");

  const bodyContent = extractBodyContent(html);
  const appJs = transformAppJs(js);
  const dataChunks = splitIntoChunks(data, CHUNK_SIZE);
  const chunkNames = dataChunks.map((_, index) => `DataChunk_${String(index + 1).padStart(3, "0")}`);

  ensureDir(OUTPUT_DIR);
  cleanDir(OUTPUT_DIR);

  fs.writeFileSync(path.join(OUTPUT_DIR, "Index.html"), buildIndexHtml(bodyContent));
  fs.writeFileSync(path.join(OUTPUT_DIR, "Styles.html"), css);
  fs.writeFileSync(path.join(OUTPUT_DIR, "App.html"), appJs);
  fs.writeFileSync(path.join(OUTPUT_DIR, "Code.gs"), buildCodeGs(chunkNames));
  fs.writeFileSync(path.join(OUTPUT_DIR, "appsscript.json"), buildAppScriptJson());
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), buildReadme(chunkNames, Buffer.byteLength(data)));

  chunkNames.forEach((chunkName, index) => {
    fs.writeFileSync(path.join(OUTPUT_DIR, `${chunkName}.html`), buildChunkHtml(dataChunks[index]));
  });

  console.log(`生成完了: ${path.relative(ROOT, OUTPUT_DIR)}`);
  console.log(`データ分割数: ${chunkNames.length}`);
}

main();
