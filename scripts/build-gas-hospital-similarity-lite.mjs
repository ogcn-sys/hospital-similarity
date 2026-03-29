import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const OUTPUT_DIR = path.join(ROOT, "gas", "hospital-similarity-webapp-lite");

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

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length ? `${prefix}${line}` : line))
    .join("\n");
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
    <?!= include('App'); ?>
  </body>
</html>
`;
}

function buildCodeGs() {
  return `var DATA_FILE_ID_KEY = 'HOSPITAL_SIMILARITY_DATA_FILE_ID';

function doGet(e) {
  if (e && e.parameter && e.parameter.mode === 'data') {
    return getHospitalSimilarityData_();
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('全国病院 類似病院TOP10 ダッシュボード')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setDataFileId(fileId) {
  if (!fileId) {
    throw new Error('fileId を指定してください。');
  }
  PropertiesService.getScriptProperties().setProperty(DATA_FILE_ID_KEY, fileId);
}

function clearDataFileId() {
  PropertiesService.getScriptProperties().deleteProperty(DATA_FILE_ID_KEY);
}

function getConfiguredDataFileId() {
  return PropertiesService.getScriptProperties().getProperty(DATA_FILE_ID_KEY);
}

function getHospitalSimilarityData_() {
  var fileId = getConfiguredDataFileId();
  if (!fileId) {
    return ContentService
      .createTextOutput(JSON.stringify({ "error": "DATA_FILE_ID 未設定です。setDataFileId(fileId) を実行してください。" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
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

function buildReadme(dataBytes) {
  return `# GAS版 類似病院TOP10 ダッシュボード（軽量版）

このフォルダは、Google Apps Script 本体には HTML / CSS / JS だけを置き、病院データJSONは Google Drive 上の別ファイルを読む構成です。

## 生成元

- HTML: \`/dashboard/hospital-similarity.html\`
- CSS: \`/dashboard/styles.css\`
- JS: \`/dashboard/hospital-similarity.js\`
- データ: \`/dashboard/hospital-similarity-data.json\`

## データファイル

- 元データサイズ: ${dataBytes.toLocaleString("ja-JP")} バイト
- Apps Script へ同梱せず、Google Drive 上の JSON ファイルを参照します

## 使い方

1. \`dashboard/hospital-similarity-data.json\` を Google Drive にアップロード
2. ファイルIDを控える
3. Apps Script にこのフォルダを \`clasp push\`
4. スクリプトエディタで \`setDataFileId('ファイルID')\` を1回実行
5. Web アプリとしてデプロイ

## 再生成

\`\`\`bash
npm run build:gas:hospital-similarity:lite
\`\`\`
`;
}

function buildClaspIgnore() {
  return `.DS_Store
README.md
`;
}

function transformAppJs(source) {
  const transformed = source.replace(
    /^const data = await fetch\("\.\/hospital-similarity-data\.json", \{ cache: "no-store" \}\)\.then\(\(response\) => response\.json\(\)\);\s*/u,
    `const data = await fetch('?mode=data', { cache: 'no-store' }).then((response) => response.json());` + "\n\n",
  );

  return `<script>
(async function () {
${indent(transformed.trim(), 2)}
})();
</script>
`;
}

function main() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const dataBytes = fs.statSync(dataPath).size;

  const bodyContent = extractBodyContent(html);
  const appJs = transformAppJs(js);

  ensureDir(OUTPUT_DIR);
  cleanDir(OUTPUT_DIR);

  fs.writeFileSync(path.join(OUTPUT_DIR, "Index.html"), buildIndexHtml(bodyContent));
  fs.writeFileSync(path.join(OUTPUT_DIR, "Styles.html"), css);
  fs.writeFileSync(path.join(OUTPUT_DIR, "App.html"), appJs);
  fs.writeFileSync(path.join(OUTPUT_DIR, "Code.gs"), buildCodeGs());
  fs.writeFileSync(path.join(OUTPUT_DIR, "appsscript.json"), buildAppScriptJson());
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), buildReadme(dataBytes));
  fs.writeFileSync(path.join(OUTPUT_DIR, ".claspignore"), buildClaspIgnore());

  console.log(`生成完了: ${path.relative(ROOT, OUTPUT_DIR)}`);
}

main();
