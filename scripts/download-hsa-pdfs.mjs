import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const ROOT_URL = "https://nkgr.co.jp/hsa/";
const OUTPUT_DIR = path.resolve(process.cwd(), "data", "hsa");
const PDF_DIR = path.join(OUTPUT_DIR, "pdfs");
const INDEX_PATH = path.join(OUTPUT_DIR, "index.json");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "summary.json");

function decodeHtml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&#038;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripTags(text) {
  return decodeHtml(text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeSegment(text) {
  return text
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "secondary-medical-area-analysis/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`取得失敗: ${url} (${response.status})`);
  }
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "secondary-medical-area-analysis/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`PDF取得失敗: ${url} (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parsePrefectures(html) {
  const prefectures = [];
  const seen = new Set();
  const regex = /<li><a href="(https:\/\/nkgr\.co\.jp\/hsa\/[^"]+\/)">([^<]+)<\/a><\/li>/g;
  for (const match of html.matchAll(regex)) {
    const url = match[1];
    const name = stripTags(match[2]);
    if (name === "都道府県一覧に戻る") {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    prefectures.push({ name, url, slug: new URL(url).pathname.split("/").filter(Boolean).at(-1) });
  }
  return prefectures;
}

function parseAreas(prefecture, html) {
  const matches = [...html.matchAll(/<li>\s*<a href="(https:\/\/nkgr\.co\.jp\/wp-content\/hsa\/[^"]+\.pdf)"[^>]*>\s*<span class="link-text">([\s\S]*?)<\/span>\s*<\/a>\s*<\/li>/g)];
  return matches.map((match, index) => {
    const pdfUrl = decodeHtml(match[1]);
    const areaName = stripTags(match[2]);
    const sourceFilename = path.basename(new URL(pdfUrl).pathname);
    return {
      prefecture: prefecture.name,
      prefectureSlug: prefecture.slug,
      prefectureUrl: prefecture.url,
      areaName,
      pdfUrl,
      sourceFilename,
      sortOrder: index + 1,
      localRelativePath: path.join(
        "pdfs",
        prefecture.slug,
        `${String(index + 1).padStart(3, "0")}_${sanitizeSegment(areaName)}_${sourceFilename}`,
      ),
    };
  });
}

async function downloadAll() {
  await mkdir(PDF_DIR, { recursive: true });

  const rootHtml = await fetchText(ROOT_URL);
  const prefectures = parsePrefectures(rootHtml);
  if (prefectures.length === 0) {
    throw new Error("都道府県一覧を抽出できませんでした。");
  }

  const allEntries = [];
  let downloaded = 0;
  let skipped = 0;

  for (const prefecture of prefectures) {
    console.log(`都道府県ページ取得: ${prefecture.name}`);
    const html = await fetchText(prefecture.url);
    const entries = parseAreas(prefecture, html);
    if (entries.length === 0) {
      throw new Error(`PDFリンクを抽出できませんでした: ${prefecture.name} (${prefecture.url})`);
    }

    const prefectureDir = path.join(PDF_DIR, prefecture.slug);
    await mkdir(prefectureDir, { recursive: true });

    for (const entry of entries) {
      const destination = path.join(OUTPUT_DIR, entry.localRelativePath);
      if (await exists(destination)) {
        skipped += 1;
      } else {
        const pdf = await fetchBuffer(entry.pdfUrl);
        await writeFile(destination, pdf);
        downloaded += 1;
      }
      allEntries.push({
        ...entry,
        localPath: destination,
      });
    }
  }

  const summary = {
    fetchedAt: new Date().toISOString(),
    rootUrl: ROOT_URL,
    prefectureCount: prefectures.length,
    pdfCount: allEntries.length,
    downloaded,
    skipped,
  };

  await writeFile(INDEX_PATH, `${JSON.stringify(allEntries, null, 2)}\n`);
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
}

downloadAll().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
