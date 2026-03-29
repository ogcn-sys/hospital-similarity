import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const ROOT = process.cwd();
const HSA_INDEX_PATH = path.join(ROOT, "data", "hsa", "index.json");
const OUTPUT_DIR = path.join(ROOT, "data", "verification", "hsa_vs_jmap");
const REPORT_PATH = path.join(OUTPUT_DIR, "report.json");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "summary.json");
const MISMATCH_PATH = path.join(OUTPUT_DIR, "mismatches.json");
const PREF_CODE_BY_NAME = {
  "北海道": 1,
  "青森県": 2,
  "岩手県": 3,
  "宮城県": 4,
  "秋田県": 5,
  "山形県": 6,
  "福島県": 7,
  "茨城県": 8,
  "栃木県": 9,
  "群馬県": 10,
  "埼玉県": 11,
  "千葉県": 12,
  "東京都": 13,
  "神奈川県": 14,
  "新潟県": 15,
  "富山県": 16,
  "石川県": 17,
  "福井県": 18,
  "山梨県": 19,
  "長野県": 20,
  "岐阜県": 21,
  "静岡県": 22,
  "愛知県": 23,
  "三重県": 24,
  "滋賀県": 25,
  "京都府": 26,
  "大阪府": 27,
  "兵庫県": 28,
  "奈良県": 29,
  "和歌山県": 30,
  "鳥取県": 31,
  "島根県": 32,
  "岡山県": 33,
  "広島県": 34,
  "山口県": 35,
  "徳島県": 36,
  "香川県": 37,
  "愛媛県": 38,
  "高知県": 39,
  "福岡県": 40,
  "佐賀県": 41,
  "長崎県": 42,
  "熊本県": 43,
  "大分県": 44,
  "宮崎県": 45,
  "鹿児島県": 46,
  "沖縄県": 47,
};

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(text) {
  return text
    .normalize("NFKC")
    .replace(/医療圏/g, "")
    .replace(/ヶ/g, "ケ")
    .replace(/\s+/g, "")
    .trim();
}

function parseJapaneseNumber(text) {
  const normalized = text.replaceAll(",", "").replace(/[^\d.-]/g, "");
  if (!normalized) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function buildJmapAreaCodeMap(html) {
  const map = new Map();
  for (const match of html.matchAll(/<a href="\/cities\/detail\/medical_area\/(\d+)">([^<]+)<\/a>/g)) {
    map.set(normalizeText(stripHtml(match[2])), match[1]);
  }
  return map;
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

async function pdfToText(pdfPath) {
  const { stdout } = await execFile("pdftotext", ["-layout", pdfPath, "-"]);
  return stdout.normalize("NFKC");
}

function extractJmapBasics(html) {
  const compact = html.replace(/\r/g, "");
  const areaMatch = compact.match(/<tr><th colspan="2">面積<\/th><td[^>]*>([^<]+)<\/td><\/tr>/);
  const populationMatch = compact.match(/<tr><th>（2020年）<\/th><td>([^<]+)<\/td><\/tr>/);
  const densityMatch = compact.match(/<tr><th colspan="2">人口密度<br>（2020年）<\/th><td>([^<]+)<br>/);

  return {
    areaKm2: parseJapaneseNumber(areaMatch?.[1] ?? ""),
    population2020: parseJapaneseNumber(populationMatch?.[1] ?? ""),
    density2020: parseJapaneseNumber(densityMatch?.[1] ?? ""),
  };
}

function extractPdfBasics(text, prefectureName, areaName) {
  const sectionStart = text.indexOf(`${prefectureName}│二次医療圏の概況`);
  if (sectionStart === -1) {
    return null;
  }
  const sectionEnd = text.indexOf("出典：", sectionStart);
  const section = text.slice(sectionStart, sectionEnd === -1 ? sectionStart + 4000 : sectionEnd);
  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  const target = normalizeText(areaName);

  for (const line of lines) {
    if (!normalizeText(line).startsWith(target)) {
      continue;
    }
    const numbers = line.match(/[\d,]+(?:\.\d+)?/g) ?? [];
    if (numbers.length < 3) {
      continue;
    }
    return {
      population2020: parseJapaneseNumber(numbers[0]),
      areaKm2: parseJapaneseNumber(numbers[1]),
      density2020: parseJapaneseNumber(numbers[2]),
    };
  }

  return null;
}

function compareNumber(pdfValue, jmapValue, tolerance = 0) {
  if (pdfValue == null || jmapValue == null) {
    return { status: "missing", pdfValue, jmapValue };
  }
  const diff = pdfValue - jmapValue;
  const same = Math.abs(diff) <= tolerance;
  return {
    status: same ? "match" : "mismatch",
    pdfValue,
    jmapValue,
    diff: same ? 0 : diff,
  };
}

function summarizeComparisons(comparisons) {
  let match = 0;
  let mismatch = 0;
  let missing = 0;

  for (const value of Object.values(comparisons)) {
    if (value.status === "match") {
      match += 1;
    } else if (value.status === "mismatch") {
      mismatch += 1;
    } else {
      missing += 1;
    }
  }

  return { match, mismatch, missing };
}

async function main() {
  const index = JSON.parse(await readFile(HSA_INDEX_PATH, "utf8"));
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  let processed = 0;
  const prefAreaMapCache = new Map();

  for (const entry of index) {
    processed += 1;
    const prefCode = PREF_CODE_BY_NAME[entry.prefecture];
    if (!prefCode) {
      throw new Error(`都道府県コードが未定義です: ${entry.prefecture}`);
    }

    let prefAreaMap = prefAreaMapCache.get(entry.prefecture);
    if (!prefAreaMap) {
      const prefHtml = await fetchText(`https://jmap.jp/cities/detail/pref/${prefCode}`);
      prefAreaMap = buildJmapAreaCodeMap(prefHtml);
      prefAreaMapCache.set(entry.prefecture, prefAreaMap);
    }

    const medicalAreaCode = prefAreaMap.get(normalizeText(entry.areaName));
    if (!medicalAreaCode) {
      report.push({
        medicalAreaCode: null,
        prefecture: entry.prefecture,
        areaName: entry.areaName,
        pdfPath: entry.localPath,
        jmapUrl: null,
        status: "error",
        error: `JMAP の医療圏コードを特定できません: ${entry.prefecture} ${entry.areaName}`,
      });
      continue;
    }

    const jmapUrl = `https://jmap.jp/cities/detail/medical_area/${medicalAreaCode}`;

    console.log(`照合中: ${processed}/${index.length} ${entry.prefecture} ${entry.areaName}`);

    let pdfText;
    let jmapHtml;

    try {
      [pdfText, jmapHtml] = await Promise.all([
        pdfToText(entry.localPath),
        fetchText(jmapUrl),
      ]);
    } catch (error) {
      report.push({
        medicalAreaCode,
        prefecture: entry.prefecture,
        areaName: entry.areaName,
        pdfPath: entry.localPath,
        jmapUrl,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const pdfBasics = extractPdfBasics(pdfText, entry.prefecture, entry.areaName);
    const jmapBasics = extractJmapBasics(jmapHtml);

    const comparisons = {
      areaKm2: compareNumber(pdfBasics?.areaKm2 ?? null, jmapBasics.areaKm2, 0.11),
      population2020: compareNumber(pdfBasics?.population2020 ?? null, jmapBasics.population2020, 0),
      density2020: compareNumber(pdfBasics?.density2020 ?? null, jmapBasics.density2020, 3),
    };

    const counts = summarizeComparisons(comparisons);
    report.push({
      medicalAreaCode,
      prefecture: entry.prefecture,
      areaName: entry.areaName,
      pdfPath: entry.localPath,
      jmapUrl,
      status: counts.mismatch > 0 ? "mismatch" : counts.missing > 0 ? "partial" : "match",
      comparisons,
      counts,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalMedicalAreas: report.length,
    matchedAreas: report.filter((item) => item.status === "match").length,
    mismatchedAreas: report.filter((item) => item.status === "mismatch").length,
    partialAreas: report.filter((item) => item.status === "partial").length,
    errorAreas: report.filter((item) => item.status === "error").length,
  };

  const mismatches = report.filter((item) => item.status === "mismatch" || item.status === "error");

  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(MISMATCH_PATH, `${JSON.stringify(mismatches, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
