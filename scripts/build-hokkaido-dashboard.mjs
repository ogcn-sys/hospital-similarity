import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "data/hsa/index.json");
const OUTPUT_DIR = path.join(ROOT, "dashboard");
const HOSPITAL_SIMILARITY_OUTPUT_JSON = path.join(OUTPUT_DIR, "hospital-similarity-data.json");

const TARGET_PREFECTURE = "北海道";
const FOCUS_AREA = "上川中部";
const FOCUS_HOSPITAL = "厚生連 旭川厚生病院";
const TEXT_CACHE = new Map();
const DPC_SECTION_TITLE = "DPC対象病院における平均在院日数（DPC患者数の多い順）①";
const HOSPITAL_SIMILARITY_FEATURES = [
  { key: "totalBeds", label: "総病床数", weight: 0.05, type: "count" },
  { key: "highAcuityBeds", label: "高度急性期病床", weight: 0.04, type: "count" },
  { key: "acuteBeds", label: "急性期病床", weight: 0.05, type: "count" },
  { key: "recoveryBeds", label: "回復期病床", weight: 0.05, type: "count" },
  { key: "chronicBeds", label: "慢性期病床", weight: 0.05, type: "count" },
  { key: "highAcuityBedShare", label: "高度急性期比率", weight: 0.03, type: "percent" },
  { key: "acuteBedShare", label: "急性期比率", weight: 0.04, type: "percent" },
  { key: "recoveryBedShare", label: "回復期比率", weight: 0.04, type: "percent" },
  { key: "chronicBedShare", label: "慢性期比率", weight: 0.04, type: "percent" },
  { key: "doctors", label: "医師数", weight: 0.08, type: "count1" },
  { key: "nurses", label: "看護職員数", weight: 0.08, type: "count1" },
  { key: "nursingAssistants", label: "看護補助者数", weight: 0.04, type: "count1" },
  { key: "rehabilitationStaff", label: "PT・OT・ST数", weight: 0.05, type: "count1" },
  { key: "doctorPer100Beds", label: "100床あたり医師数", weight: 0.05, type: "count1" },
  { key: "nursePer100Beds", label: "100床あたり看護職員数", weight: 0.05, type: "count1" },
  { key: "rehabilitationStaffPer100Beds", label: "100床あたりPT・OT・ST数", weight: 0.04, type: "count1" },
  { key: "ambulanceAcceptances", label: "救急車受入件数", weight: 0.1, type: "count" },
  { key: "ambulanceAdmissions", label: "救急搬送入院件数", weight: 0.08, type: "count" },
  { key: "dpcBeds", label: "DPC病床数", weight: 0.06, type: "count" },
  { key: "dpcBedRatio", label: "DPC病床割合", weight: 0.04, type: "percent" },
  { key: "dpcCases", label: "DPC症例数", weight: 0.09, type: "count" },
  { key: "averageLengthOfStay", label: "平均在院日数", weight: 0.03, type: "days" },
  { key: "caseMixAdjustedLengthOfStay", label: "疾患補正後在院日数", weight: 0.03, type: "days" },
  { key: "fullTimeDoctorRatio", label: "常勤医比率", weight: 0.03, type: "percent" },
  { key: "afterHoursPatients", label: "夜間時間外受診患者数", weight: 0.03, type: "count1" },
  { key: "holidayPatients", label: "休日受診患者数", weight: 0.03, type: "count1" },
  { key: "regionalSupportHospitalScore", label: "地域医療支援病院", weight: 0.02, type: "binary" },
  { key: "emergencyCenterScore", label: "救命救急センター", weight: 0.02, type: "binary" },
  { key: "disasterBaseHospitalScore", label: "災害拠点病院", weight: 0.02, type: "binary" },
  { key: "perinatalCareScore", label: "周産期機能", weight: 0.02, type: "binary" },
  { key: "cancerCareScore", label: "がん診療機能", weight: 0.02, type: "binary" },
  { key: "strokeCenterScore", label: "脳卒中対応機能", weight: 0.02, type: "binary" },
  { key: "homeCareScore", label: "在宅医療機能", weight: 0.02, type: "binary" },
];
const MIN_SIMILARITY_FEATURE_COUNT = 8;
const EMERGENCY_SIMILARITY_KEYS = new Set([
  "ambulanceAcceptances",
  "ambulanceAdmissions",
  "afterHoursPatients",
  "holidayPatients",
]);
const HOSPITAL_TABLE_END_MARKERS = [/^※地図内/u, /^出典：/u, /医療機関の指定状況/u];
const INVALID_HOSPITAL_ROW_TEXT = /(?:©|NIHONKEIEI|Co\.,Ltd|医療圏|病床機能別|DPC|患者数|出典|総計|\(年\)|\(千件\)|年次|年度)/u;
const MUNICIPALITY_SUFFIX = /(?:市|区|町|村)$/u;
const HOSPITAL_NAME_CHAR = /[A-Za-zＡ-Ｚａ-ｚぁ-んァ-ヶ一-龠々]/u;
const STAFF_TABLE_END_MARKERS = [/^出典：/u, /病床機能別の病床数の推移/u];
const DESIGNATION_TABLE_END_MARKERS = [/^出典：/u, /^2\//u];

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeRegExp(value) {
  return value.replace(ESCAPE_REGEX, "\\$&");
}

function normalizeHospitalName(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[ 　]/g, "")
    .replaceAll("ヶ", "ケ")
    .replaceAll("﨑", "崎")
    .replaceAll("濱", "浜")
    .replaceAll("德", "徳");
}

function lineIncludesHospital(line, hospitalName) {
  return normalizeHospitalName(line).includes(normalizeHospitalName(hospitalName));
}

function parseNumber(token) {
  if (token == null) {
    return null;
  }
  const normalized = String(token).replaceAll(",", "").replaceAll("%", "").trim();
  if (!normalized || normalized === "None" || normalized === "-") {
    return null;
  }
  const negative = normalized.startsWith("▲");
  const signed = negative ? `-${normalized.slice(1)}` : normalized.startsWith("+") ? normalized.slice(1) : normalized;
  const value = Number.parseFloat(signed);
  return Number.isFinite(value) ? value : null;
}

function ratioPercent(numerator, denominator) {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function per100Beds(value, totalBeds) {
  if (value == null || totalBeds == null || totalBeds === 0) {
    return null;
  }
  return (value / totalBeds) * 100;
}

function boolScore(value) {
  return value == null ? null : value ? 1 : 0;
}

function extractText(pdfPath) {
  if (TEXT_CACHE.has(pdfPath)) {
    return TEXT_CACHE.get(pdfPath);
  }
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  TEXT_CACHE.set(pdfPath, text);
  return text;
}

function sectionBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) {
    return "";
  }
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  return text.slice(start, end === -1 ? undefined : end);
}

function lastSectionBetween(text, startMarker, endMarker) {
  const start = text.lastIndexOf(startMarker);
  if (start === -1) {
    return "";
  }
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  return text.slice(start, end === -1 ? undefined : end);
}

function findLine(text, pattern) {
  const lines = text.split("\n");
  return lines.find((line) => pattern.test(line)) ?? "";
}

function findLines(text, pattern) {
  return text.split("\n").filter((line) => pattern.test(line));
}

function searchAfter(text, pattern, fromIndex) {
  const slice = text.slice(fromIndex);
  const match = slice.match(pattern);
  return match ? fromIndex + match.index : -1;
}

function tokensFromLine(line) {
  return line.match(/[▲+－-]?[0-9][0-9,]*(?:\.[0-9]+)?%?/g) ?? [];
}

function approximatelyEqual(left, right, tolerance = 0.2) {
  return left != null && right != null && Math.abs(left - right) <= tolerance;
}

function extractPopulationSummary(text, areaName) {
  const section = sectionBetween(text, "北海道│二次医療圏の概況", "北海道│二次医療圏における人口変化率の推計");
  const line = findLine(section, new RegExp(`^\\s*${escapeRegExp(areaName)}\\s+`));
  const values = tokensFromLine(line);
  return {
    population2020: parseNumber(values[0]),
    areaKm2: parseNumber(values[1]),
    populationDensity: parseNumber(values[2]),
    livableLandRatio: parseNumber(values[3]),
  };
}

function extractAreaInpatientLos(text, areaName) {
  const section = sectionBetween(text, "北海道│都道府県内の医療圏の入院患者数と平均在院日数", "医療機関別職員数");
  const line = findLine(section, new RegExp(`^\\s*${escapeRegExp(areaName)}\\s+`));
  const values = tokensFromLine(line);
  return {
    inpatient2023: parseNumber(values[3]),
    averageLengthOfStay2023: parseNumber(values[8]),
  };
}

function extractDpcFlow(text, areaName) {
  const section = sectionBetween(text, "北海道│二次医療圏別の流出入状況（DPC症例数）", "患者流出入状況の年度推移");
  const regex = new RegExp(`${escapeRegExp(areaName)}\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)`, "m");
  const match = section.match(regex);
  return {
    dpcLocationCasesK: parseNumber(match?.[1]),
    dpcResidentCasesK: parseNumber(match?.[2]),
    dpcCompletionRate: parseNumber(match?.[3]),
  };
}

function extractSpecialties(text) {
  const section = sectionBetween(text, `${FOCUS_AREA}医療圏│診療科別医師数`, `${FOCUS_AREA}医療圏│病床数及び診療実績の推移（一般病床）`);
  const lookup = (label) => {
    const match = section.match(new RegExp(`${escapeRegExp(label)}\\s+([0-9]+(?:\\.[0-9]+)?)`, "m"));
    return parseNumber(match?.[1]);
  };
  return {
    respiratoryPhysiciansPer100k65: lookup("呼吸器内科"),
    infectiousDiseasePhysiciansPer100k65: lookup("感染症内科"),
    intensiveCarePhysiciansPer100k65: lookup("集中治療科"),
  };
}

function extractBedDiffs(text) {
  const areaName = text.includes(`${FOCUS_AREA}区域│病床機能別の病床数の推移と必要病床数`)
    ? FOCUS_AREA
    : text.match(/([^\s]+)区域│病床機能別の病床数の推移と必要病床数/u)?.[1];
  const section = sectionBetween(
    text,
    `${areaName}区域│病床機能別の病床数の推移と必要病床数`,
    `${areaName}医療圏│病床機能別・医療機関別の許可病床数`,
  );
  const parseRow = (label) => {
    const patterns = {
      高度急性期: new RegExp(`^\\s*${escapeRegExp(label)}\\s+([0-9,]+)\\s+([0-9,]+)\\s+([+▲－-]?[0-9,]+)`, "m"),
      急性期: new RegExp(`^\\s*${escapeRegExp(label)}\\s+([0-9,]+)\\s+([0-9,]+)\\s+([+▲－-]?[0-9,]+)`, "m"),
      回復期: new RegExp(`${escapeRegExp(label)}\\s+([0-9,]+)\\s+([0-9,]+)\\s+([+▲－-]?[0-9,]+)`, "m"),
      慢性期: new RegExp(`^\\s*${escapeRegExp(label)}\\s+([0-9,]+)\\s+([0-9,]+)\\s+([+▲－-]?[0-9,]+)`, "m"),
      合計: new RegExp(`^\\s*${escapeRegExp(label)}\\s+([0-9,]+)\\s+([0-9,]+)\\s+([+▲－-]?[0-9,]+)`, "m"),
    };
    const match = section.match(patterns[label] ?? patterns.合計);
    return {
      current: parseNumber(match?.[1]),
      needed: parseNumber(match?.[2]),
      diff: parseNumber(match?.[3]),
    };
  };
  return {
    highAcuityBeds: parseRow("高度急性期"),
    acuteBeds: parseRow("急性期"),
    recoveryBeds: parseRow("回復期"),
    chronicBeds: parseRow("慢性期"),
    totalBeds: parseRow("合計"),
  };
}

function extractIcdSeries(text, areaName, sectionTitle, nextTitle, label) {
  const section = sectionBetween(text, `${areaName}医療圏│${sectionTitle}`, `${areaName}医療圏│${nextTitle}`);
  const line = findLine(section, new RegExp(`^\\s*${escapeRegExp(label)}\\s+`));
  const values = tokensFromLine(line).map(parseNumber);
  return {
    y2020: values[0],
    y2025: values[1],
    y2030: values[2],
    y2035: values[3],
    y2040: values[4],
    y2045: values[5],
    y2050: values[6],
  };
}

function buildHospitalProfile(focusPdfPath) {
  const text = extractText(focusPdfPath);
  const emergencyProfileSection = lastSectionBetween(text, "上川中部医療圏│救急車受入を行う病院の概要①", "病院別の救急車受入件数および夜間・時間外・休日の患者延べ数");
  const emergencyCountsSection = lastSectionBetween(text, "病院別の救急車受入件数および夜間・時間外・休日の患者延べ数", "上川中部区域と類似区域における救急医療の提供状況");
  const dpcLosSection = sectionBetween(text, "北海道│DPC対象病院における平均在院日数（DPC患者数の多い順）①", "上川中部医療圏│MDC別退院患者数および医療機関シェア");
  const bedsSection = sectionBetween(text, "上川中部医療圏│医療機関別の許可病床数", "医療機関の指定状況①");
  const designation = parseHospitalDesignation(text, FOCUS_HOSPITAL);

  const emergencyProfileMatch = emergencyProfileSection.match(
    new RegExp(`${escapeRegExp(FOCUS_HOSPITAL)}\\s+旭川市\\s+公的医療機関\\s+二次救急\\s+([0-9.]+)\\s+([0-9]+)\\s+([0-9.]+)%\\s+([0-9.]+)\\s+([0-9]+)\\s+([0-9]+)\\s+([0-9]+)`, "m"),
  );
  const dpcLosMatch = dpcLosSection.match(
    new RegExp(`${escapeRegExp(FOCUS_HOSPITAL)}\\s+上川中部\\s+標準\\s+急性期1\\s+([0-9]+)\\s+([0-9]+)%\\s+([0-9,]+)\\s+([0-9.]+)\\s+([0-9.]+)`, "m"),
  );
  const emergencyCountLines = emergencyCountsSection.split("\n");
  const emergencyStartIndex = emergencyCountLines.findIndex((line) => line.includes(FOCUS_HOSPITAL));
  const emergencyJoined = [emergencyCountLines[emergencyStartIndex] ?? "", emergencyCountLines[emergencyStartIndex + 1] ?? ""].join(" ");
  const emergencyJoinedValues = tokensFromLine(emergencyJoined);
  const focusBedLine = findLine(bedsSection, new RegExp(`${escapeRegExp(FOCUS_HOSPITAL)}\\s+旭川市`));
  const focusBedValues = tokensFromLine(focusBedLine).map(parseNumber).filter((value) => value != null);
  const focusBedSummary =
    focusBedValues.length >= 5
      ? {
          highAcuityBeds: focusBedValues[1],
          acuteBeds: focusBedValues[2],
          recoveryBeds: 0,
          chronicBeds: focusBedValues[3],
          pausedBeds: 0,
          totalBeds: focusBedValues[4],
        }
      : {
          highAcuityBeds: null,
          acuteBeds: null,
          recoveryBeds: null,
          chronicBeds: null,
          pausedBeds: null,
          totalBeds: null,
        };

  return {
    name: FOCUS_HOSPITAL,
    assumptions: {
      note: "病院指標は上川中部医療圏PDF内の個別病院表から抽出。",
    },
    bedSummary: focusBedSummary,
    designations: {
      dpc: Boolean(designation.dpcHospitalGroup),
      regionalSupportHospital: designation.hasRegionalSupport ?? false,
      emergencyCenter: designation.hasEmergencyCenter ?? false,
      disasterBaseHospital: designation.hasDisasterBaseHospital ?? false,
      perinatalCare: designation.hasPerinatalRole ?? false,
      cancerCare: designation.hasCancerRole ?? false,
      strokeCenter: designation.hasStrokeRole ?? false,
      homeCare: designation.hasHomeCareRole ?? false,
    },
    emergencyProfile: {
      doctors: parseNumber(emergencyProfileMatch?.[1]),
      fullTimeDoctors: parseNumber(emergencyProfileMatch?.[2]),
      fullTimeDoctorRatio: parseNumber(emergencyProfileMatch?.[3]),
      nurses: parseNumber(emergencyProfileMatch?.[4]),
      ct: parseNumber(emergencyProfileMatch?.[5]),
      mri: parseNumber(emergencyProfileMatch?.[6]),
      otherEquipment: parseNumber(emergencyProfileMatch?.[7]),
    },
    emergencyCounts: {
      ambulanceAcceptances: parseNumber(emergencyJoinedValues[0]),
      cumulativeShare: parseNumber(emergencyJoinedValues[1]),
      afterHoursPatients: parseNumber(emergencyJoinedValues[2]),
      holidayPatients: parseNumber(emergencyJoinedValues[5]),
      ambulanceAdmissions: parseNumber(emergencyJoinedValues[3]),
      referenceDoctors: parseNumber(emergencyJoinedValues[4]),
    },
    dpcPerformance: {
      dpcBeds: parseNumber(dpcLosMatch?.[1]),
      dpcBedRatio: parseNumber(dpcLosMatch?.[2]),
      dpcCases: parseNumber(dpcLosMatch?.[3]),
      averageLengthOfStay: parseNumber(dpcLosMatch?.[4]),
      caseMixAdjustedLengthOfStay: parseNumber(dpcLosMatch?.[5]),
    },
  };
}

function extractPrefectureDpcHospitalRows(text, prefectureName) {
  const section = sectionBetween(text, `${prefectureName}│${DPC_SECTION_TITLE}`, "MDC別退院患者数および医療機関シェア");
  const lines = section.split("\n");
  const rows = [];
  const rowPattern =
    /^\s*(\d+)\s+(.+?)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(\S+)\s+([0-9]+)\s+([0-9]+)%\s+([0-9,]+)\s+([0-9.]+)\s+([0-9.]+)\s*$/u;

  for (const line of lines) {
    const match = line.match(rowPattern);
    if (!match) {
      continue;
    }
    rows.push({
      rank: parseNumber(match[1]),
      hospitalName: match[2].trim(),
      areaName: match[3],
      dpcHospitalGroup: match[4],
      dpcBaseFee: match[5],
      dpcBeds: parseNumber(match[6]),
      dpcBedRatio: parseNumber(match[7]),
      dpcCases: parseNumber(match[8]),
      averageLengthOfStay: parseNumber(match[9]),
      caseMixAdjustedLengthOfStay: parseNumber(match[10]),
    });
  }

  return rows;
}

function splitBedTableLine(line) {
  const matchIndexes = [...line.matchAll(/\s{2,}\d{1,4}\s+[^\d\s]/gu)].map((match) => match.index);
  const splitIndex = matchIndexes[0];
  return splitIndex != null ? [line.slice(0, splitIndex), line.slice(splitIndex)] : [line];
}

function labelCenter(line, label, occurrence = 0) {
  let searchFrom = 0;
  let found = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    found = line.indexOf(label, searchFrom);
    if (found === -1) {
      return null;
    }
    searchFrom = found + label.length;
  }
  return found + (label.length / 2);
}

function buildColumnRanges(columnCenters) {
  const ordered = Object.entries(columnCenters)
    .filter(([, center]) => center != null)
    .sort((left, right) => left[1] - right[1]);

  return ordered.map(([key, center], index) => {
    const previousCenter = ordered[index - 1]?.[1] ?? 0;
    const nextCenter = ordered[index + 1]?.[1] ?? Number.POSITIVE_INFINITY;
    return {
      key,
      center,
      start: index === 0 ? 0 : Math.floor((previousCenter + center) / 2),
      end: nextCenter === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.ceil((center + nextCenter) / 2),
    };
  });
}

function assignTextColumns(valueMatches, ranges) {
  const assigned = {};
  for (const match of valueMatches) {
    const position = (match.index ?? 0) + (match[0]?.length ?? 0) / 2;
    const range = ranges.find((candidate) => position >= candidate.start && position < candidate.end);
    if (!range) {
      continue;
    }
    assigned[range.key] = match[0];
  }
  return assigned;
}

function detectBedTableHeaderSplitIndex(headerLine) {
  const firstNameIndex = headerLine.indexOf("医療機関名");
  if (firstNameIndex === -1) {
    return null;
  }
  const secondNameIndex = headerLine.indexOf("医療機関名", firstNameIndex + "医療機関名".length);
  if (secondNameIndex === -1) {
    return null;
  }
  const noIndex = headerLine.lastIndexOf("No", secondNameIndex);
  return noIndex === -1 ? secondNameIndex : noIndex;
}

function buildBedTableLayouts(previousLine, headerLine, nextLine) {
  const splitIndex = detectBedTableHeaderSplitIndex(headerLine);
  const splitLine = (line) => (splitIndex == null ? [line] : [line.slice(0, splitIndex), line.slice(splitIndex)]);
  const headerFragments = splitLine(headerLine);
  const previousFragments = splitLine(previousLine);
  const nextFragments = splitLine(nextLine);

  return headerFragments.map((fragment, index) => {
    const top = previousFragments[index] ?? "";
    const bottom = nextFragments[index] ?? "";
    return {
      splitIndex,
      ranges: buildColumnRanges({
        highAcuityBeds: labelCenter(top, "高度") ?? labelCenter(bottom, "急性期"),
        acuteBeds: labelCenter(fragment, "急性期"),
        recoveryBeds: labelCenter(fragment, "回復期"),
        chronicBeds: labelCenter(fragment, "慢性期"),
        suspendedBeds: labelCenter(top, "休棟・") ?? labelCenter(bottom, "無回答"),
        totalBeds: labelCenter(fragment, "総計"),
      }),
    };
  });
}

function buildDesignationTableLayout(previousLine, headerLine, nextLine) {
  return {
    ranges: buildColumnRanges({
      dpcHospitalGroup: labelCenter(headerLine, "DPC"),
      regionalSupportHospital: labelCenter(previousLine, "地域医療") ?? labelCenter(nextLine, "支援病院"),
      emergencyCenter: labelCenter(previousLine, "救命救急") ?? labelCenter(nextLine, "センター"),
      disasterBaseHospital: labelCenter(previousLine, "災害拠点") ?? labelCenter(nextLine, "病院"),
      perinatalCare: labelCenter(headerLine, "周産期"),
      cancerCare: labelCenter(headerLine, "がん診療"),
      strokeCenter: labelCenter(headerLine, "脳卒中"),
      homeCare: labelCenter(headerLine, "在宅医療"),
    }),
  };
}

function assignBedColumns(valueMatches, ranges) {
  const assigned = {};
  for (const match of valueMatches) {
    const token = match[0];
    const position = (match.index ?? 0) + token.length / 2;
    const range = ranges.find((candidate) => position >= candidate.start && position < candidate.end);
    if (!range) {
      continue;
    }
    assigned[range.key] = parseNumber(token);
  }
  return assigned;
}

function isLikelyMunicipalityName(value) {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized) && MUNICIPALITY_SUFFIX.test(normalized) && !/[0-9()％%©]/u.test(normalized) && !INVALID_HOSPITAL_ROW_TEXT.test(normalized);
}

function isLikelyHospitalName(value) {
  const normalized = String(value ?? "").trim();
  return (
    Boolean(normalized) &&
    HOSPITAL_NAME_CHAR.test(normalized) &&
    !/^(?:No\.?|医療機関名|市町村名|市区町村名|高度急性期|急性期|回復期|慢性期|休棟・?無回答)$/u.test(normalized) &&
    !/^[0-9０-９\s.,]+$/u.test(normalized) &&
    !INVALID_HOSPITAL_ROW_TEXT.test(normalized)
  );
}

function extractAreaHospitalBedRows(text, prefectureName, areaName) {
  const rowsByKey = new Map();
  let inBedTableScope = false;
  let tableLayouts = [];
  const lines = text.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.includes("医療機関別の許可病床数")) {
      inBedTableScope = true;
      tableLayouts = [];
      continue;
    }
    if (!inBedTableScope) {
      continue;
    }
    if (HOSPITAL_TABLE_END_MARKERS.some((pattern) => pattern.test(line))) {
      inBedTableScope = false;
      tableLayouts = [];
      continue;
    }
    if (line.includes("医療機関名") && /(市町村名|市区町村)/u.test(line)) {
      tableLayouts = buildBedTableLayouts(lines[lineIndex - 1] ?? "", line, lines[lineIndex + 1] ?? "");
      continue;
    }
    if (!tableLayouts.length) {
      continue;
    }

    const splitIndex = tableLayouts[0]?.splitIndex ?? null;
    const fragments =
      splitIndex == null
        ? [line]
        : [line.slice(0, splitIndex), line.slice(splitIndex)];
    while (fragments.length < tableLayouts.length) {
      fragments.push("");
    }

    for (const [fragmentIndex, fragment] of fragments.entries()) {
      const match = fragment.match(/^\s*(\d+)\s+(.+?)\s+(\S+(?:市|区|町|村))(.*)$/u);
      if (!match) {
        continue;
      }

      const hospitalName = match[2].trim();
      const city = match[3].trim();
      const tail = match[4] ?? "";
      const tailStart = fragment.length - tail.length;
      const valueMatches = [...tail.matchAll(/[0-9][0-9,]*/g)].map((valueMatch) => ({ ...valueMatch, index: (valueMatch.index ?? 0) + tailStart }));
      const assigned = assignBedColumns(valueMatches, tableLayouts[fragmentIndex]?.ranges ?? []);
      const values = Object.values(assigned).filter((value) => value != null);
      const totalBeds = assigned.totalBeds ?? values.at(-1) ?? null;
      if (
        !isLikelyHospitalName(hospitalName) ||
        !isLikelyMunicipalityName(city) ||
        hospitalName === "総計" ||
        city === "総計" ||
        totalBeds == null
      ) {
        continue;
      }

      const key = `${prefectureName}::${areaName}::${hospitalName}`;
      const row = {
        rank: parseNumber(match[1]),
        hospitalName,
        prefecture: prefectureName,
        areaName,
        city,
        totalBeds,
        highAcuityBeds: assigned.highAcuityBeds ?? null,
        acuteBeds: assigned.acuteBeds ?? null,
        recoveryBeds: assigned.recoveryBeds ?? null,
        chronicBeds: assigned.chronicBeds ?? null,
        suspendedBeds: assigned.suspendedBeds ?? null,
        bedValueCount: values.length,
      };
      const previous = rowsByKey.get(key);
      if (!previous || row.bedValueCount > previous.bedValueCount || row.totalBeds > previous.totalBeds) {
        rowsByKey.set(key, row);
      }
    }
  }

  return [...rowsByKey.values()];
}

function parseHospitalBedSummary(text, hospitalName) {
  const line =
    text
      .split("\n")
      .filter((candidate) => lineIncludesHospital(candidate, hospitalName))
      .filter(
        (candidate) =>
          !candidate.includes("%") &&
          !candidate.includes(".") &&
          !/(二次救急|三次救急|DPC対象病院|退院患者数|シェア|手術|ポジショニングマップ)/u.test(candidate),
      )
      .map((candidate) => ({
        line: candidate,
        values: tokensFromLine(candidate).map(parseNumber).filter((value) => value != null),
      }))
      .filter((candidate) => candidate.values.length >= 2 && (candidate.values.at(-1) ?? 0) >= 50)
      .sort((left, right) => (right.values.length - left.values.length) || (left.line.length - right.line.length))[0]?.line ?? "";
  const tokens = tokensFromLine(line).map(parseNumber).filter((value) => value != null);
  return {
    line,
    totalBeds: tokens.length ? tokens[tokens.length - 1] : null,
  };
}

function parseHospitalDesignation(text, hospitalName) {
  let inDesignationScope = false;
  let layout = null;
  const candidate =
    text
      .split("\n")
      .flatMap((line, lineIndex, lines) => {
        if (line.includes("医療機関の指定状況")) {
          inDesignationScope = true;
          layout = null;
          return [];
        }
        if (!inDesignationScope) {
          return [];
        }
        if (DESIGNATION_TABLE_END_MARKERS.some((pattern) => pattern.test(line))) {
          inDesignationScope = false;
          layout = null;
          return [];
        }
        if (line.includes("医療機関略称") && line.includes("病床数")) {
          layout = buildDesignationTableLayout(lines[lineIndex - 1] ?? "", line, lines[lineIndex + 1] ?? "");
          return [];
        }
        if (!layout) {
          return [];
        }
        if (!lineIncludesHospital(line, hospitalName)) {
          return [];
        }
        const rowMatch = line.match(/^\s*(\d+)\s+(.+?)\s+([0-9,]+)(.*)$/u);
        if (!rowMatch || !lineIncludesHospital(rowMatch[2], hospitalName)) {
          return [];
        }
        const tailStart = line.length - (rowMatch[4] ?? "").length;
        const textMatches = [...(rowMatch[4] ?? "").matchAll(/\S+/gu)].map((match) => ({ ...match, index: (match.index ?? 0) + tailStart }));
        const columns = assignTextColumns(textMatches, layout.ranges);
        return [{
          line,
          totalBeds: parseNumber(rowMatch[3]),
          dpcHospitalGroup: columns.dpcHospitalGroup ?? null,
          emergencyCenter: columns.emergencyCenter ?? null,
          disasterBaseHospital: columns.disasterBaseHospital ?? null,
          perinatalCare: columns.perinatalCare ?? null,
          cancerCare: columns.cancerCare ?? null,
          strokeCenter: columns.strokeCenter ?? null,
          homeCare: columns.homeCare ?? null,
          regionalSupportHospital: columns.regionalSupportHospital ?? null,
        }];
      })
      .sort((left, right) => left.line.length - right.line.length)[0] ?? {};
  const line = candidate.line ?? "";
  return {
    line,
    totalBeds: candidate.totalBeds ?? null,
    dpcHospitalGroup: candidate.dpcHospitalGroup ?? null,
    hasRegionalSupport: candidate.regionalSupportHospital === "〇",
    hasEmergencyCenter: candidate.emergencyCenter != null,
    hasDisasterBaseHospital: candidate.disasterBaseHospital != null,
    hasPerinatalRole: candidate.perinatalCare != null,
    hasCancerRole: candidate.cancerCare != null,
    hasStrokeRole: candidate.strokeCenter != null,
    hasHomeCareRole: candidate.homeCare != null,
  };
}

function extractAreaHospitalDesignationSeedRows(text, prefectureName, areaName) {
  const rowsByKey = new Map();
  let inDesignationScope = false;

  for (const line of text.split("\n")) {
    if (line.includes("医療機関の指定状況")) {
      inDesignationScope = true;
      continue;
    }
    if (!inDesignationScope) {
      continue;
    }
    if (DESIGNATION_TABLE_END_MARKERS.some((pattern) => pattern.test(line))) {
      inDesignationScope = false;
      continue;
    }
    const match = line.match(/^\s*(\d+)\s+(.+?)\s+([0-9,]+)\s*(.*)$/u);
    if (!match) {
      continue;
    }
    const hospitalName = match[2].trim();
    if (!isLikelyHospitalName(hospitalName)) {
      continue;
    }
    const row = {
      rank: parseNumber(match[1]),
      hospitalName,
      prefecture: prefectureName,
      areaName,
      totalBeds: parseNumber(match[3]),
    };
    rowsByKey.set(`${prefectureName}::${areaName}::${hospitalName}`, row);
  }

  return [...rowsByKey.values()];
}

function parseHospitalStaffingProfile(text, hospitalName) {
  let inStaffScope = false;
  const candidate =
    text
      .split("\n")
      .flatMap((line) => {
        if (line.includes("医療機関別職員数")) {
          inStaffScope = true;
          return [];
        }
        if (!inStaffScope) {
          return [];
        }
        if (STAFF_TABLE_END_MARKERS.some((pattern) => pattern.test(line))) {
          inStaffScope = false;
          return [];
        }
        if (!lineIncludesHospital(line, hospitalName) || line.includes("%")) {
          return [];
        }
        const rowMatch = line.match(/^\s*(\d+)\s+(.+?)\s+([0-9][0-9,.\s]+)\s*$/u);
        if (!rowMatch || !lineIncludesHospital(rowMatch[2], hospitalName)) {
          return [];
        }
        const values = tokensFromLine(rowMatch[3]).map(parseNumber).filter((value) => value != null);
        if (values.length < 7) {
          return [];
        }
        return [{
          line,
          doctors: values[0] ?? null,
          fullTimeDoctors: values[1] ?? null,
          nurses: values[2] ?? null,
          nursingAssistants: values[3] ?? null,
          rehabilitationStaff: values[4] ?? null,
          pharmacists: values[5] ?? null,
          allStaff: values[6] ?? null,
          fullTimeDoctorRatio: ratioPercent(values[1] ?? null, values[0] ?? null),
        }];
      })
      .sort((left, right) => (right.allStaff ?? 0) - (left.allStaff ?? 0) || left.line.length - right.line.length)[0];

  return candidate ?? {};
}

function parseHospitalEmergencyProfile(text, hospitalName) {
  const match = text
    .split("\n")
    .filter((line) => lineIncludesHospital(line, hospitalName) && /(三次救急|二次救急)/u.test(line))
    .map((line) =>
      line.match(
        /(\S+)\s+(\S+)\s+(三次救急|二次救急)\s+([0-9.]+)\s+([0-9]+)\s+([0-9.]+)%\s+([0-9.]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)/u,
      ),
    )
    .find(Boolean);
  if (!match) {
    return {};
  }
  return {
    city: match[1],
    ownerType: match[2],
    emergencyType: match[3],
    doctors: parseNumber(match[4]),
    fullTimeDoctors: parseNumber(match[5]),
    fullTimeDoctorRatio: parseNumber(match[6]),
    nurses: parseNumber(match[7]),
    ct: parseNumber(match[8]),
    mri: parseNumber(match[9]),
    otherEquipment: parseNumber(match[10]),
  };
}

function parseHospitalEmergencyCounts(text, hospitalName, expectedDoctors = null) {
  const lines = text.split("\n");
  const headingIndexes = lines
    .map((line, index) => (line.includes("病院別の救急車受入件数および夜間・時間外・休日の患者延べ数") ? index : -1))
    .filter((index) => index !== -1);
  const contentHeadingIndexes = headingIndexes.length > 1 ? headingIndexes.slice(1) : headingIndexes;
  if (!contentHeadingIndexes.length) {
    return {};
  }

  let sectionLines = [];
  let lineIndex = -1;
  for (let index = 0; index < contentHeadingIndexes.length; index += 1) {
    const start = contentHeadingIndexes[index];
    const nextHeading = contentHeadingIndexes[index + 1] ?? lines.length;
    const compareStart = lines.findIndex((line, lineIndex2) => lineIndex2 > start && line.includes("類似区域における救急医療の提供状況"));
    const end = compareStart !== -1 && compareStart < nextHeading ? compareStart : nextHeading;
    const candidateLines = lines.slice(start, end);
    const candidateIndex = candidateLines
      .map((line, candidateLineIndex) => ({
        candidateLineIndex,
        line,
        values: tokensFromLine(line).map(parseNumber).filter((value) => value != null),
      }))
      .filter((item) => lineIncludesHospital(item.line, hospitalName) && item.values.length >= 3)
      .sort((left, right) => {
        const leftScore = (expectedDoctors != null && approximatelyEqual(left.values.at(-1), expectedDoctors) ? 2 : 0) + (left.values.length >= 4 ? 1 : 0);
        const rightScore = (expectedDoctors != null && approximatelyEqual(right.values.at(-1), expectedDoctors) ? 2 : 0) + (right.values.length >= 4 ? 1 : 0);
        return rightScore - leftScore || right.values.length - left.values.length;
      })[0]?.candidateLineIndex;
    if (candidateIndex != null) {
      sectionLines = candidateLines;
      lineIndex = candidateIndex;
      break;
    }
  }

  if (lineIndex === -1) {
    return {};
  }

  const currentValues = tokensFromLine(sectionLines[lineIndex] ?? "").map(parseNumber).filter((value) => value != null);
  const previousValues = tokensFromLine(sectionLines[lineIndex - 1] ?? "").map(parseNumber).filter((value) => value != null);
  const nextValues = tokensFromLine(sectionLines[lineIndex + 1] ?? "").map(parseNumber).filter((value) => value != null);
  const referenceDoctors = currentValues[currentValues.length - 1] ?? null;
  const valuesBeforeDoctors = currentValues.slice(2, Math.max(currentValues.length - 1, 2));

  let afterHoursPatients = null;
  let ambulanceAdmissions = null;
  let holidayPatients = null;

  if (valuesBeforeDoctors.length >= 2) {
    [afterHoursPatients, ambulanceAdmissions] = valuesBeforeDoctors;
    holidayPatients = nextValues[0] ?? null;
  } else if (valuesBeforeDoctors.length === 1) {
    ambulanceAdmissions = valuesBeforeDoctors[0];
    afterHoursPatients = previousValues.length === 1 ? previousValues[0] : null;
    holidayPatients = nextValues[0] ?? null;
  }

  return {
    ambulanceAcceptances: currentValues[0] ?? null,
    cumulativeShare: currentValues[1] ?? null,
    afterHoursPatients,
    ambulanceAdmissions,
    referenceDoctors,
    holidayPatients,
  };
}

function decorateHospitalProfile(profile) {
  const totalBeds = profile.totalBeds ?? profile.bedSummary?.totalBeds ?? null;
  const highAcuityBeds = profile.bedSummary?.highAcuityBeds ?? null;
  const acuteBeds = profile.bedSummary?.acuteBeds ?? null;
  const recoveryBeds = profile.bedSummary?.recoveryBeds ?? null;
  const chronicBeds = profile.bedSummary?.chronicBeds ?? null;
  const suspendedBeds = profile.bedSummary?.suspendedBeds ?? null;

  return {
    ...profile,
    totalBeds,
    highAcuityBeds,
    acuteBeds,
    recoveryBeds,
    chronicBeds,
    suspendedBeds,
    highAcuityBedShare: ratioPercent(highAcuityBeds, totalBeds),
    acuteBedShare: ratioPercent(acuteBeds, totalBeds),
    recoveryBedShare: ratioPercent(recoveryBeds, totalBeds),
    chronicBedShare: ratioPercent(chronicBeds, totalBeds),
    suspendedBedShare: ratioPercent(suspendedBeds, totalBeds),
    doctorPer100Beds: per100Beds(profile.doctors, totalBeds),
    nursePer100Beds: per100Beds(profile.nurses, totalBeds),
    rehabilitationStaffPer100Beds: per100Beds(profile.rehabilitationStaff, totalBeds),
    regionalSupportHospitalScore: boolScore(profile.designations?.regionalSupportHospital ?? false),
    emergencyCenterScore: boolScore(profile.designations?.emergencyCenter ?? false),
    disasterBaseHospitalScore: boolScore(profile.designations?.disasterBaseHospital ?? false),
    perinatalCareScore: boolScore(profile.designations?.perinatalCare ?? false),
    cancerCareScore: boolScore(profile.designations?.cancerCare ?? false),
    strokeCenterScore: boolScore(profile.designations?.strokeCenter ?? false),
    homeCareScore: boolScore(profile.designations?.homeCare ?? false),
  };
}

function buildHospitalProfileFromRow(row, areaEntry) {
  const text = extractText(areaEntry.localPath);
  const bedSummary = parseHospitalBedSummary(text, row.hospitalName);
  const designation = parseHospitalDesignation(text, row.hospitalName);
  const emergencyProfile = parseHospitalEmergencyProfile(text, row.hospitalName);
  const staffingProfile = parseHospitalStaffingProfile(text, row.hospitalName);
  const emergencyCounts = parseHospitalEmergencyCounts(text, row.hospitalName, staffingProfile.doctors ?? emergencyProfile.doctors ?? null);

  return {
    name: row.hospitalName,
    prefecture: row.prefecture,
    areaName: row.areaName,
    areaPdfPath: areaEntry.localPath,
    dpcHospitalGroup: row.dpcHospitalGroup ?? designation.dpcHospitalGroup ?? null,
    dpcBaseFee: row.dpcBaseFee,
    totalBeds: bedSummary.totalBeds ?? designation.totalBeds ?? null,
    bedSummary: {
      totalBeds: bedSummary.totalBeds ?? designation.totalBeds ?? null,
    },
    designations: {
      regionalSupportHospital: designation.hasRegionalSupport ?? false,
      emergencyCenter: designation.hasEmergencyCenter ?? false,
      disasterBaseHospital: designation.hasDisasterBaseHospital ?? false,
      perinatalCare: designation.hasPerinatalRole ?? false,
      cancerCare: designation.hasCancerRole ?? false,
      strokeCenter: designation.hasStrokeRole ?? false,
      homeCare: designation.hasHomeCareRole ?? false,
    },
    ownerType: emergencyProfile.ownerType ?? null,
    emergencyType: emergencyProfile.emergencyType ?? null,
    city: emergencyProfile.city ?? null,
    emergencyProfile,
    emergencyCounts,
    dpcPerformance: {
      dpcBeds: row.dpcBeds,
      dpcBedRatio: row.dpcBedRatio,
      dpcCases: row.dpcCases,
      averageLengthOfStay: row.averageLengthOfStay,
      caseMixAdjustedLengthOfStay: row.caseMixAdjustedLengthOfStay,
    },
    doctors: staffingProfile.doctors ?? emergencyProfile.doctors ?? null,
    nurses: staffingProfile.nurses ?? emergencyProfile.nurses ?? null,
    nursingAssistants: staffingProfile.nursingAssistants ?? null,
    rehabilitationStaff: staffingProfile.rehabilitationStaff ?? null,
    pharmacists: staffingProfile.pharmacists ?? null,
    allStaff: staffingProfile.allStaff ?? null,
    fullTimeDoctors: staffingProfile.fullTimeDoctors ?? emergencyProfile.fullTimeDoctors ?? null,
    fullTimeDoctorRatio: staffingProfile.fullTimeDoctorRatio ?? emergencyProfile.fullTimeDoctorRatio ?? null,
    ambulanceAcceptances: emergencyCounts.ambulanceAcceptances ?? null,
    afterHoursPatients: emergencyCounts.afterHoursPatients ?? null,
    holidayPatients: emergencyCounts.holidayPatients ?? null,
    ambulanceAdmissions: emergencyCounts.ambulanceAdmissions ?? null,
    dpcBeds: row.dpcBeds,
    dpcBedRatio: row.dpcBedRatio,
    dpcCases: row.dpcCases,
    averageLengthOfStay: row.averageLengthOfStay,
    caseMixAdjustedLengthOfStay: row.caseMixAdjustedLengthOfStay,
  };
}

function buildHospitalProfileFromBedRow(row, areaEntry) {
  const text = extractText(areaEntry.localPath);
  const designation = parseHospitalDesignation(text, row.hospitalName);
  const emergencyProfile = parseHospitalEmergencyProfile(text, row.hospitalName);
  const staffingProfile = parseHospitalStaffingProfile(text, row.hospitalName);
  const emergencyCounts = parseHospitalEmergencyCounts(text, row.hospitalName, staffingProfile.doctors ?? emergencyProfile.doctors ?? null);

  return {
    name: row.hospitalName,
    prefecture: row.prefecture,
    areaName: row.areaName,
    areaPdfPath: areaEntry.localPath,
    dpcHospitalGroup: designation.dpcHospitalGroup ?? null,
    dpcBaseFee: null,
    totalBeds: row.totalBeds ?? null,
    bedSummary: {
      totalBeds: row.totalBeds ?? null,
      highAcuityBeds: row.highAcuityBeds ?? null,
      acuteBeds: row.acuteBeds ?? null,
      recoveryBeds: row.recoveryBeds ?? null,
      chronicBeds: row.chronicBeds ?? null,
      suspendedBeds: row.suspendedBeds ?? null,
    },
    designations: {
      regionalSupportHospital: designation.hasRegionalSupport ?? false,
      emergencyCenter: designation.hasEmergencyCenter ?? false,
      disasterBaseHospital: designation.hasDisasterBaseHospital ?? false,
      perinatalCare: designation.hasPerinatalRole ?? false,
      cancerCare: designation.hasCancerRole ?? false,
      strokeCenter: designation.hasStrokeRole ?? false,
      homeCare: designation.hasHomeCareRole ?? false,
    },
    ownerType: emergencyProfile.ownerType ?? null,
    emergencyType: emergencyProfile.emergencyType ?? null,
    city: row.city ?? emergencyProfile.city ?? null,
    emergencyProfile: {
      ...emergencyProfile,
      city: row.city ?? emergencyProfile.city ?? null,
    },
    emergencyCounts,
    dpcPerformance: {
      dpcBeds: null,
      dpcBedRatio: null,
      dpcCases: null,
      averageLengthOfStay: null,
      caseMixAdjustedLengthOfStay: null,
    },
    doctors: staffingProfile.doctors ?? emergencyProfile.doctors ?? null,
    nurses: staffingProfile.nurses ?? emergencyProfile.nurses ?? null,
    nursingAssistants: staffingProfile.nursingAssistants ?? null,
    rehabilitationStaff: staffingProfile.rehabilitationStaff ?? null,
    pharmacists: staffingProfile.pharmacists ?? null,
    allStaff: staffingProfile.allStaff ?? null,
    fullTimeDoctors: staffingProfile.fullTimeDoctors ?? emergencyProfile.fullTimeDoctors ?? null,
    fullTimeDoctorRatio: staffingProfile.fullTimeDoctorRatio ?? emergencyProfile.fullTimeDoctorRatio ?? null,
    ambulanceAcceptances: emergencyCounts.ambulanceAcceptances ?? null,
    afterHoursPatients: emergencyCounts.afterHoursPatients ?? null,
    holidayPatients: emergencyCounts.holidayPatients ?? null,
    ambulanceAdmissions: emergencyCounts.ambulanceAdmissions ?? null,
    dpcBeds: null,
    dpcBedRatio: null,
    dpcCases: null,
    averageLengthOfStay: null,
    caseMixAdjustedLengthOfStay: null,
  };
}

function mergeHospitalProfiles(baseProfile, overlayProfile) {
  return {
    ...baseProfile,
    ...overlayProfile,
    bedSummary: {
      ...baseProfile.bedSummary,
      ...overlayProfile.bedSummary,
    },
    designations: {
      ...baseProfile.designations,
      ...overlayProfile.designations,
    },
    emergencyProfile: {
      ...baseProfile.emergencyProfile,
      ...overlayProfile.emergencyProfile,
    },
    emergencyCounts: {
      ...baseProfile.emergencyCounts,
      ...overlayProfile.emergencyCounts,
    },
    dpcPerformance: {
      ...baseProfile.dpcPerformance,
      ...overlayProfile.dpcPerformance,
    },
    totalBeds: baseProfile.totalBeds ?? overlayProfile.totalBeds,
    ownerType: overlayProfile.ownerType ?? baseProfile.ownerType,
    emergencyType: overlayProfile.emergencyType ?? baseProfile.emergencyType,
    city: overlayProfile.city ?? baseProfile.city,
    doctors: overlayProfile.doctors ?? baseProfile.doctors,
    nurses: overlayProfile.nurses ?? baseProfile.nurses,
    nursingAssistants: overlayProfile.nursingAssistants ?? baseProfile.nursingAssistants,
    rehabilitationStaff: overlayProfile.rehabilitationStaff ?? baseProfile.rehabilitationStaff,
    pharmacists: overlayProfile.pharmacists ?? baseProfile.pharmacists,
    allStaff: overlayProfile.allStaff ?? baseProfile.allStaff,
    fullTimeDoctors: overlayProfile.fullTimeDoctors ?? baseProfile.fullTimeDoctors,
    fullTimeDoctorRatio: overlayProfile.fullTimeDoctorRatio ?? baseProfile.fullTimeDoctorRatio,
    ambulanceAcceptances: overlayProfile.ambulanceAcceptances ?? baseProfile.ambulanceAcceptances,
    afterHoursPatients: overlayProfile.afterHoursPatients ?? baseProfile.afterHoursPatients,
    holidayPatients: overlayProfile.holidayPatients ?? baseProfile.holidayPatients,
    ambulanceAdmissions: overlayProfile.ambulanceAdmissions ?? baseProfile.ambulanceAdmissions,
    dpcBeds: overlayProfile.dpcBeds ?? baseProfile.dpcBeds,
    dpcBedRatio: overlayProfile.dpcBedRatio ?? baseProfile.dpcBedRatio,
    dpcCases: overlayProfile.dpcCases ?? baseProfile.dpcCases,
    averageLengthOfStay: overlayProfile.averageLengthOfStay ?? baseProfile.averageLengthOfStay,
    caseMixAdjustedLengthOfStay: overlayProfile.caseMixAdjustedLengthOfStay ?? baseProfile.caseMixAdjustedLengthOfStay,
  };
}

function computeHospitalSimilarity(baseHospital, candidateHospital) {
  const comparable = HOSPITAL_SIMILARITY_FEATURES.map((feature) => {
    const baseValue = baseHospital[feature.key];
    const candidateValue = candidateHospital[feature.key];
    if (baseValue == null || candidateValue == null) {
      return null;
    }
    const gap =
      feature.type === "binary"
        ? baseValue === candidateValue ? 0 : 1
        : Math.abs(baseValue - candidateValue) / Math.max(Math.abs(baseValue), Math.abs(candidateValue), 1);
    return {
      key: feature.key,
      label: feature.label,
      weight: feature.weight,
      type: feature.type ?? "count",
      baseValue,
      candidateValue,
      gap,
      difference: candidateValue - baseValue,
    };
  }).filter(Boolean);

  const totalWeight = comparable.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0 || comparable.length < 5) {
    return null;
  }

  let weightedGap = comparable.reduce((sum, item) => sum + item.gap * item.weight, 0) / totalWeight;
  if (baseHospital.emergencyType && candidateHospital.emergencyType && baseHospital.emergencyType === candidateHospital.emergencyType) {
    weightedGap -= 0.03;
  }
  if (baseHospital.dpcHospitalGroup && candidateHospital.dpcHospitalGroup && baseHospital.dpcHospitalGroup === candidateHospital.dpcHospitalGroup) {
    weightedGap -= 0.02;
  }
  if (baseHospital.ownerType && candidateHospital.ownerType && baseHospital.ownerType === candidateHospital.ownerType) {
    weightedGap -= 0.02;
  }

  const similarityScore = Math.max(0, Math.min(100, (1 - weightedGap) * 100));
  const sortedComparable = [...comparable].sort((left, right) => left.gap - right.gap);

  return {
    hospitalName: candidateHospital.name,
    areaName: candidateHospital.areaName,
    similarityScore: formatOneDecimal(similarityScore),
    comparableFeatureCount: comparable.length,
    comparableEmergencyFeatureCount: comparable.filter((item) => EMERGENCY_SIMILARITY_KEYS.has(item.key)).length,
    profile: candidateHospital,
    similarElements: sortedComparable.slice(0, 4),
    differentElements: sortedComparable.slice(-4).reverse(),
  };
}

function buildSimilarHospitals(baseHospital, hospitalProfiles) {
  return hospitalProfiles
    .filter((profile) => profile.name !== baseHospital.name)
    .map((profile) => computeHospitalSimilarity(baseHospital, profile))
    .filter(Boolean)
    .filter((item) => item.comparableFeatureCount >= MIN_SIMILARITY_FEATURE_COUNT)
    .sort(
      (left, right) =>
        right.similarityScore - left.similarityScore ||
        right.comparableFeatureCount - left.comparableFeatureCount ||
        right.comparableEmergencyFeatureCount - left.comparableEmergencyFeatureCount,
    )
    .slice(0, 4);
}

function buildHospitalProfileId(profile) {
  return encodeURIComponent([profile.prefecture ?? "", profile.areaName ?? "", profile.name ?? ""].join("::"));
}

function buildHospitalSelectorLabel(profile) {
  return [profile.name, profile.prefecture, profile.areaName ? `${profile.areaName}医療圏` : null, profile.city]
    .filter(Boolean)
    .join(" / ");
}

function serializeHospitalProfile(profile) {
  const featureAvailabilityCount = HOSPITAL_SIMILARITY_FEATURES.filter((feature) => profile[feature.key] != null).length;
  const emergencyFeatureAvailabilityCount = HOSPITAL_SIMILARITY_FEATURES.filter(
    (feature) => EMERGENCY_SIMILARITY_KEYS.has(feature.key) && profile[feature.key] != null,
  ).length;

  return {
    id: buildHospitalProfileId(profile),
    selectorLabel: buildHospitalSelectorLabel(profile),
    featureAvailabilityCount,
    emergencyFeatureAvailabilityCount,
    ...profile,
  };
}

function main() {
  const index = readJson(INDEX_PATH);
  const focusPdfPath =
    index.find((entry) => entry.prefecture === TARGET_PREFECTURE && entry.areaName === FOCUS_AREA)?.localPath ?? "";
  if (!focusPdfPath) {
    throw new Error(`${TARGET_PREFECTURE} ${FOCUS_AREA} のPDFパスを特定できませんでした。`);
  }
  const focusHospital = buildHospitalProfile(focusPdfPath);
  const representativeEntries = [...new Map(index.map((entry) => [entry.prefecture, entry])).values()];
  const dpcHospitalRows = representativeEntries.flatMap((entry) =>
    extractPrefectureDpcHospitalRows(extractText(entry.localPath), entry.prefecture).map((row) => ({
      ...row,
      prefecture: entry.prefecture,
    })),
  );
  const areaEntryMap = new Map(index.map((entry) => [`${entry.prefecture}::${entry.areaName}`, entry]));
  const allHospitalBedRows = index.flatMap((entry) => extractAreaHospitalBedRows(extractText(entry.localPath), entry.prefecture, entry.areaName));
  const allHospitalDesignationSeedRows = index.flatMap((entry) =>
    extractAreaHospitalDesignationSeedRows(extractText(entry.localPath), entry.prefecture, entry.areaName),
  );
  const hospitalProfileMap = new Map();

  for (const row of allHospitalBedRows) {
    const areaEntry = areaEntryMap.get(`${row.prefecture}::${row.areaName}`);
    if (!areaEntry) {
      continue;
    }
    const profile = buildHospitalProfileFromBedRow(row, areaEntry);
    hospitalProfileMap.set(buildHospitalProfileId(profile), profile);
  }

  for (const row of allHospitalDesignationSeedRows) {
    const areaEntry = areaEntryMap.get(`${row.prefecture}::${row.areaName}`);
    if (!areaEntry) {
      continue;
    }
    const profile = buildHospitalProfileFromBedRow(row, areaEntry);
    const profileId = buildHospitalProfileId(profile);
    if (!hospitalProfileMap.has(profileId)) {
      hospitalProfileMap.set(profileId, profile);
    }
  }

  for (const row of dpcHospitalRows) {
    const areaEntry = areaEntryMap.get(`${row.prefecture}::${row.areaName}`);
    if (!areaEntry) {
      continue;
    }
    const profile = buildHospitalProfileFromRow(row, areaEntry);
    const profileId = buildHospitalProfileId(profile);
    const existing = hospitalProfileMap.get(profileId);
    hospitalProfileMap.set(profileId, existing ? mergeHospitalProfiles(existing, profile) : profile);
  }

  const hospitalProfiles = [...hospitalProfileMap.values()].map(decorateHospitalProfile);
  const focusHospitalComparable = hospitalProfiles.find((profile) => profile.name === FOCUS_HOSPITAL);
  const mergedFocusHospital = decorateHospitalProfile({
    ...focusHospitalComparable,
    ...focusHospital,
    bedSummary: {
      ...focusHospitalComparable?.bedSummary,
      ...focusHospital.bedSummary,
    },
    designations: {
      ...focusHospitalComparable?.designations,
      ...focusHospital.designations,
    },
    emergencyProfile: {
      ...focusHospitalComparable?.emergencyProfile,
      ...focusHospital.emergencyProfile,
    },
    emergencyCounts: {
      ...focusHospitalComparable?.emergencyCounts,
      ...focusHospital.emergencyCounts,
    },
    dpcPerformance: {
      ...focusHospitalComparable?.dpcPerformance,
      ...focusHospital.dpcPerformance,
    },
    totalBeds: focusHospital.bedSummary.totalBeds ?? focusHospitalComparable?.totalBeds ?? null,
    doctors: focusHospital.emergencyProfile.doctors ?? focusHospitalComparable?.doctors ?? null,
    nurses: focusHospital.emergencyProfile.nurses ?? focusHospitalComparable?.nurses ?? null,
    fullTimeDoctorRatio: focusHospital.emergencyProfile.fullTimeDoctorRatio ?? focusHospitalComparable?.fullTimeDoctorRatio ?? null,
    ambulanceAcceptances: focusHospital.emergencyCounts.ambulanceAcceptances ?? focusHospitalComparable?.ambulanceAcceptances ?? null,
    afterHoursPatients: focusHospital.emergencyCounts.afterHoursPatients ?? focusHospitalComparable?.afterHoursPatients ?? null,
    holidayPatients: focusHospital.emergencyCounts.holidayPatients ?? focusHospitalComparable?.holidayPatients ?? null,
    ambulanceAdmissions: focusHospital.emergencyCounts.ambulanceAdmissions ?? focusHospitalComparable?.ambulanceAdmissions ?? null,
    nursingAssistants: focusHospitalComparable?.nursingAssistants ?? null,
    rehabilitationStaff: focusHospitalComparable?.rehabilitationStaff ?? null,
    pharmacists: focusHospitalComparable?.pharmacists ?? null,
    allStaff: focusHospitalComparable?.allStaff ?? null,
    fullTimeDoctors: focusHospitalComparable?.fullTimeDoctors ?? null,
    dpcBeds: focusHospital.dpcPerformance.dpcBeds ?? focusHospitalComparable?.dpcBeds ?? null,
    dpcBedRatio: focusHospital.dpcPerformance.dpcBedRatio ?? focusHospitalComparable?.dpcBedRatio ?? null,
    dpcCases: focusHospital.dpcPerformance.dpcCases ?? focusHospitalComparable?.dpcCases ?? null,
    averageLengthOfStay: focusHospital.dpcPerformance.averageLengthOfStay ?? focusHospitalComparable?.averageLengthOfStay ?? null,
    caseMixAdjustedLengthOfStay:
      focusHospital.dpcPerformance.caseMixAdjustedLengthOfStay ?? focusHospitalComparable?.caseMixAdjustedLengthOfStay ?? null,
  });

  const generatedAt = new Date().toISOString();
  const source = {
    prefecture: TARGET_PREFECTURE,
    pdfCount: index.filter((entry) => entry.prefecture === TARGET_PREFECTURE).length,
    nationalPdfCount: index.length,
    note: "旭川厚生病院を基準に、全国病院類似度ダッシュボード用の比較データを生成。",
  };

  const serializedHospitalProfileMap = new Map();
  hospitalProfiles.forEach((profile) => {
    serializedHospitalProfileMap.set(buildHospitalProfileId(profile), profile);
  });
  serializedHospitalProfileMap.set(buildHospitalProfileId(mergedFocusHospital), mergedFocusHospital);

  const serializedHospitalProfiles = [...serializedHospitalProfileMap.values()]
    .map((profile) => serializeHospitalProfile(profile))
    .sort((left, right) => {
      return (
        left.prefecture.localeCompare(right.prefecture, "ja") ||
        left.areaName.localeCompare(right.areaName, "ja") ||
        left.name.localeCompare(right.name, "ja")
      );
    });

  const hospitalSimilarityOutput = {
    generatedAt,
    source,
    focusHospitalId: buildHospitalProfileId(mergedFocusHospital),
    minSimilarityFeatureCount: MIN_SIMILARITY_FEATURE_COUNT,
    similarityFeatures: HOSPITAL_SIMILARITY_FEATURES,
    hospitals: serializedHospitalProfiles,
  };

  ensureDir(OUTPUT_DIR);
  writeJson(HOSPITAL_SIMILARITY_OUTPUT_JSON, hospitalSimilarityOutput);
  console.log(`生成完了: ${path.relative(ROOT, HOSPITAL_SIMILARITY_OUTPUT_JSON)}`);
}

main();
