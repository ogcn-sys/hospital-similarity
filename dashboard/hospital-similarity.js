const data = await fetch("./hospital-similarity-data.json", { cache: "no-store" }).then((response) => response.json());

const hospitals = data.hospitals;
const similarityFeatures = data.similarityFeatures;
const minSimilarityFeatureCount = data.minSimilarityFeatureCount;

const sourceLabelNode = document.querySelector("#source-label");
const generatedAtNode = document.querySelector("#generated-at");
const hospitalCountNode = document.querySelector("#hospital-count");
const searchInput = document.querySelector("#hospital-search");
const hospitalOptions = document.querySelector("#hospital-options");
const hospitalForm = document.querySelector("#hospital-form");
const prefectureFilter = document.querySelector("#prefecture-filter");
const areaFilter = document.querySelector("#area-filter");
const cityFilter = document.querySelector("#city-filter");
const dpcFilter = document.querySelector("#dpc-filter");
const hospitalList = document.querySelector("#hospital-list");
const selectorStatus = document.querySelector("#selector-status");
const selectedHospitalNode = document.querySelector("#selected-hospital");
const comparisonSummaryNode = document.querySelector("#comparison-summary");
const similarityTop10Node = document.querySelector("#similarity-top10");

const hospitalMap = new Map(hospitals.map((hospital) => [hospital.id, hospital]));
const labelToIdMap = new Map(hospitals.map((hospital) => [hospital.selectorLabel, hospital.id]));

const extraFieldDefinitions = [
  { key: "fullTimeDoctors", label: "常勤医数", type: "count1" },
  { key: "pharmacists", label: "薬剤師数", type: "count1" },
  { key: "allStaff", label: "全職員数", type: "count1" },
  { key: "suspendedBeds", label: "休棟・無回答病床", type: "count" },
  { key: "suspendedBedShare", label: "休棟・無回答比率", type: "percent" },
  { key: "prefecture", label: "都道府県", type: "text" },
  { key: "areaName", label: "二次医療圏", type: "text" },
  { key: "city", label: "市区町村", type: "text" },
  { key: "emergencyType", label: "救急区分", type: "text" },
  { key: "ownerType", label: "設置主体", type: "text" },
  { key: "dpcHospitalGroup", label: "DPC病院群", type: "text" },
  { key: "dpcBaseFee", label: "DPC基礎係数", type: "count1" },
  { key: "dpcPerformance", label: "DPC機能評価係数", type: "count1" },
];

const fieldDefinitions = new Map([...similarityFeatures, ...extraFieldDefinitions].map((field) => [field.key, field]));

const categoryKeyMap = {
  scale: new Set([
    "totalBeds",
    "highAcuityBeds",
    "acuteBeds",
    "recoveryBeds",
    "chronicBeds",
    "suspendedBeds",
    "highAcuityBedShare",
    "acuteBedShare",
    "recoveryBedShare",
    "chronicBedShare",
    "suspendedBedShare",
    "ambulanceAcceptances",
    "ambulanceAdmissions",
    "afterHoursPatients",
    "holidayPatients",
    "dpcBeds",
    "dpcBedRatio",
    "dpcCases",
    "averageLengthOfStay",
    "caseMixAdjustedLengthOfStay",
  ]),
  function: new Set([
    "regionalSupportHospitalScore",
    "emergencyCenterScore",
    "disasterBaseHospitalScore",
    "perinatalCareScore",
    "cancerCareScore",
    "strokeCenterScore",
    "homeCareScore",
  ]),
  staff: new Set([
    "allStaff",
    "doctors",
    "fullTimeDoctors",
    "fullTimeDoctorRatio",
    "doctorPer100Beds",
    "nurses",
    "nursePer100Beds",
    "rehabilitationStaff",
    "rehabilitationStaffPer100Beds",
    "nursingAssistants",
    "pharmacists",
  ]),
};

const categoryPriority = {
  scale: 0.5,
  function: 0.3,
  staff: 0.2,
};

const sectionDefinitions = [
  {
    key: "beds",
    label: "病床構成",
    rows: [
      { key: "totalBeds", emphasis: true },
      { key: "highAcuityBeds", secondaryKey: "highAcuityBedShare", level: 1 },
      { key: "acuteBeds", secondaryKey: "acuteBedShare", level: 1 },
      { key: "recoveryBeds", secondaryKey: "recoveryBedShare", level: 1 },
      { key: "chronicBeds", secondaryKey: "chronicBedShare", level: 1 },
      { key: "suspendedBeds", secondaryKey: "suspendedBedShare", level: 1 },
    ],
  },
  {
    key: "staff",
    label: "職員構成",
    rows: [
      { key: "allStaff", emphasis: true },
      { key: "doctors", secondaryKey: "doctorPer100Beds", level: 1 },
      { key: "fullTimeDoctors", secondaryKey: "fullTimeDoctorRatio", level: 1 },
      { key: "nurses", secondaryKey: "nursePer100Beds", level: 1 },
      { key: "rehabilitationStaff", secondaryKey: "rehabilitationStaffPer100Beds", level: 1 },
      { key: "nursingAssistants", level: 1 },
      { key: "pharmacists", level: 1 },
    ],
  },
  {
    key: "urgent",
    label: "救急・DPC",
    rows: [
      { key: "ambulanceAcceptances" },
      { key: "ambulanceAdmissions" },
      { key: "afterHoursPatients" },
      { key: "holidayPatients" },
      { key: "dpcBeds", secondaryKey: "dpcBedRatio" },
      { key: "dpcCases" },
      { key: "averageLengthOfStay" },
      { key: "caseMixAdjustedLengthOfStay" },
      { key: "dpcBaseFee" },
      { key: "dpcPerformance" },
    ],
  },
  {
    key: "functions",
    label: "病院機能",
    binary: true,
    rows: [
      { key: "regionalSupportHospitalScore" },
      { key: "emergencyCenterScore" },
      { key: "disasterBaseHospitalScore" },
      { key: "perinatalCareScore" },
      { key: "cancerCareScore" },
      { key: "strokeCenterScore" },
      { key: "homeCareScore" },
    ],
  },
  {
    key: "meta",
    label: "病院属性",
    rows: [
      { key: "prefecture" },
      { key: "areaName" },
      { key: "city" },
      { key: "emergencyType" },
      { key: "ownerType" },
      { key: "dpcHospitalGroup" },
    ],
  },
];

const visibleComparisonSectionKeys = ["beds", "staff", "functions"];
const visibleComparisonRowKeys = new Set([
  "totalBeds",
  "highAcuityBeds",
  "acuteBeds",
  "recoveryBeds",
  "chronicBeds",
  "doctors",
  "fullTimeDoctors",
  "nurses",
  "rehabilitationStaff",
  "nursingAssistants",
  "pharmacists",
  "allStaff",
  "regionalSupportHospitalScore",
  "emergencyCenterScore",
  "disasterBaseHospitalScore",
  "perinatalCareScore",
  "cancerCareScore",
  "strokeCenterScore",
  "homeCareScore",
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ 　]/g, "");
}

function fmtNumber(value, digits = 0) {
  if (value == null || value === "") {
    return "—";
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "—";
  }
  return numericValue.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtPct(value, digits = 1) {
  return value == null ? "—" : `${fmtNumber(value, digits)}%`;
}

function fmtDate(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function getFieldDefinition(key) {
  return fieldDefinitions.get(key) ?? { key, label: key, type: "text" };
}

function getFieldLabel(key) {
  const field = getFieldDefinition(key);
  if (key === "areaName") {
    return "二次医療圏";
  }
  return field.label;
}

function formatFieldValue(key, value) {
  const field = getFieldDefinition(key);
  if (value == null || value === "") {
    return "—";
  }
  if (field.type === "binary") {
    return value ? "あり" : "なし";
  }
  if (field.type === "count" || field.type === "count1" || field.type === "percent" || field.type === "days") {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return "—";
    }
  }
  if (field.type === "percent") {
    return fmtPct(value);
  }
  if (field.type === "days") {
    return `${fmtNumber(value, 1)} 日`;
  }
  if (field.type === "count1") {
    return fmtNumber(value, 1);
  }
  if (field.type === "count") {
    return fmtNumber(value);
  }
  if (key === "areaName") {
    return `${value}医療圏`;
  }
  return String(value);
}

function formatSecondaryValue(key, value) {
  if (value == null || value === "") {
    return "—";
  }
  if (key === "fullTimeDoctorRatio") {
    return `比率 ${fmtPct(value)}`;
  }
  if (key.includes("Per100Beds")) {
    return `100床あたり ${fmtNumber(value, 1)}`;
  }
  return formatFieldValue(key, value);
}

function looksLikeCity(value) {
  if (!value) {
    return false;
  }
  if (/(救急|設置主体|医療法人|社団|財団|病院群|不明)/.test(value)) {
    return false;
  }
  return /[市区町村郡]$/.test(value);
}

function getCategoryForKey(key) {
  if (categoryKeyMap.scale.has(key)) {
    return "scale";
  }
  if (categoryKeyMap.function.has(key)) {
    return "function";
  }
  if (categoryKeyMap.staff.has(key)) {
    return "staff";
  }
  return "scale";
}

function computeGap(field, baseValue, candidateValue) {
  if (field.type === "binary") {
    return baseValue === candidateValue ? 0 : 1;
  }
  if (typeof baseValue === "string" || typeof candidateValue === "string") {
    return baseValue === candidateValue ? 0 : 1;
  }
  return Math.abs(baseValue - candidateValue) / Math.max(Math.abs(baseValue), Math.abs(candidateValue), 1);
}

function buildComparableItems(baseHospital, candidateHospital) {
  return similarityFeatures
    .map((field) => {
      const baseValue = baseHospital[field.key];
      const candidateValue = candidateHospital[field.key];
      if (baseValue == null || candidateValue == null) {
        return null;
      }

      return {
        ...field,
        category: getCategoryForKey(field.key),
        baseValue,
        candidateValue,
        gap: computeGap(field, baseValue, candidateValue),
      };
    })
    .filter(Boolean);
}

function computeHospitalSimilarity(baseHospital, candidateHospital) {
  const comparableItems = buildComparableItems(baseHospital, candidateHospital);
  if (comparableItems.length < 5) {
    return null;
  }

  const availableCategories = Object.keys(categoryPriority).filter((category) =>
    comparableItems.some((item) => item.category === category),
  );
  if (!availableCategories.length) {
    return null;
  }

  const normalizedPriorities = Object.fromEntries(
    availableCategories.map((category) => [
      category,
      categoryPriority[category] / availableCategories.reduce((sum, key) => sum + categoryPriority[key], 0),
    ]),
  );

  let weightedGap = availableCategories.reduce((sum, category) => {
    const items = comparableItems.filter((item) => item.category === category);
    const totalWeight = items.reduce((weightSum, item) => weightSum + item.weight, 0);
    const categoryGap = items.reduce((gapSum, item) => gapSum + item.gap * item.weight, 0) / totalWeight;
    return sum + categoryGap * normalizedPriorities[category];
  }, 0);

  if (baseHospital.prefecture && candidateHospital.prefecture && baseHospital.prefecture === candidateHospital.prefecture) {
    weightedGap -= 0.05;
  }
  if (baseHospital.areaName && candidateHospital.areaName && baseHospital.areaName === candidateHospital.areaName) {
    weightedGap -= 0.03;
  }
  if (baseHospital.emergencyType && candidateHospital.emergencyType && baseHospital.emergencyType === candidateHospital.emergencyType) {
    weightedGap -= 0.02;
  }
  if (baseHospital.ownerType && candidateHospital.ownerType && baseHospital.ownerType === candidateHospital.ownerType) {
    weightedGap -= 0.015;
  }

  const similarityScore = Math.max(0, Math.min(100, (1 - weightedGap) * 100));
  const prioritizedItems = comparableItems.map((item) => ({
    ...item,
    importance: normalizedPriorities[item.category] * item.weight,
  }));

  return {
    hospitalId: candidateHospital.id,
    hospitalName: candidateHospital.name,
    similarityScore: Number(similarityScore.toFixed(1)),
    comparableFeatureCount: comparableItems.length,
    profile: candidateHospital,
    similarElements: [...prioritizedItems]
      .sort((left, right) => left.gap - right.gap || right.importance - left.importance)
      .slice(0, 4),
    differentElements: [...prioritizedItems]
      .sort((left, right) => right.gap - left.gap || right.importance - left.importance)
      .slice(0, 4),
  };
}

function buildTopMatches(baseHospital) {
  return hospitals
    .filter((hospital) => hospital.id !== baseHospital.id)
    .map((hospital) => computeHospitalSimilarity(baseHospital, hospital))
    .filter(Boolean)
    .filter((item) => item.comparableFeatureCount >= minSimilarityFeatureCount)
    .sort((left, right) => right.similarityScore - left.similarityScore || right.comparableFeatureCount - left.comparableFeatureCount)
    .slice(0, 10);
}

function buildIdentityMeta(hospital) {
  const city = looksLikeCity(hospital.city) ? hospital.city : null;
  return [hospital.prefecture, hospital.areaName ? `${hospital.areaName}医療圏` : null, city].filter(Boolean).join(" / ");
}

function binaryBadge(value) {
  return `<span class="binary-pill ${value ? "is-yes" : "is-no"}">${value ? "あり" : "なし"}</span>`;
}

function buildTemperatureClass(gap) {
  if (gap == null) {
    return "";
  }
  if (gap <= 0.12) {
    return "temperature-warm";
  }
  if (gap >= 0.35) {
    return "temperature-cool";
  }
  return "";
}

function renderSelectedRow(row, hospital, isBinarySection = false) {
  const primaryValue = hospital[row.key];
  const secondaryValue = row.secondaryKey ? hospital[row.secondaryKey] : null;
  const rowClass = row.level ? ` level-${row.level}` : "";
  const label = row.label ?? getFieldLabel(row.key);

  if (isBinarySection) {
    return `
      <div class="tree-row${rowClass}">
        <div class="tree-label">${label}</div>
        <div class="tree-value">${binaryBadge(Boolean(primaryValue))}</div>
      </div>
    `;
  }

  return `
    <div class="tree-row${rowClass}${row.emphasis ? " is-emphasis" : ""}">
      <div class="tree-label">${label}</div>
      <div class="tree-value">
        <strong class="tree-main-value">${formatFieldValue(row.key, primaryValue)}</strong>
        ${row.secondaryKey ? `<span class="tree-sub-value">${formatSecondaryValue(row.secondaryKey, secondaryValue)}</span>` : ""}
      </div>
    </div>
  `;
}

function renderSelectedSection(section, hospital) {
  return `
    <section class="detail-card">
      <h3 class="detail-card-title">${section.label}</h3>
      <div class="tree-list${section.binary ? " is-binary-list" : ""}">
        ${section.rows.map((row) => renderSelectedRow(row, hospital, section.binary)).join("")}
      </div>
    </section>
  `;
}

function renderSelectedHospital(baseHospital) {
  selectedHospitalNode.innerHTML = `
    <div class="hospital-identity">
      <div>
        <strong class="hospital-name">${baseHospital.name}</strong>
        <div class="hospital-subline">${buildIdentityMeta(baseHospital)}</div>
      </div>
      <div class="identity-pills">
        ${[
          baseHospital.emergencyType,
          baseHospital.ownerType,
          baseHospital.dpcHospitalGroup,
        ]
          .filter(Boolean)
          .map((item) => `<span class="pill">${item}</span>`)
          .join("")}
      </div>
    </div>
    <div class="detail-section-grid">
      ${sectionDefinitions.map((section) => renderSelectedSection(section, baseHospital)).join("")}
    </div>
  `;
}

function renderCompareRow(row, candidate, baseHospital, isBinarySection = false) {
  const field = getFieldDefinition(row.key);
  const primaryCandidate = candidate[row.key];
  const primaryBase = baseHospital[row.key];
  const gap = primaryCandidate == null || primaryBase == null ? null : computeGap(field, primaryBase, primaryCandidate);
  const tempClass = buildTemperatureClass(gap);
  const label = row.label ?? getFieldLabel(row.key);

  if (isBinarySection) {
    return `
      <div class="compare-row ${tempClass}">
        <div class="compare-label">${label}</div>
        <div class="compare-cell compare-cell-candidate">${binaryBadge(Boolean(primaryCandidate))}</div>
        <div class="compare-cell compare-cell-base">${binaryBadge(Boolean(primaryBase))}</div>
      </div>
    `;
  }

  const candidateSecondary = row.secondaryKey ? candidate[row.secondaryKey] : null;
  const baseSecondary = row.secondaryKey ? baseHospital[row.secondaryKey] : null;

  return `
    <div class="compare-row ${tempClass}">
      <div class="compare-label">${label}</div>
      <div class="compare-cell compare-cell-candidate">
        <strong class="compare-main">${formatFieldValue(row.key, primaryCandidate)}</strong>
        ${row.secondaryKey ? `<span class="compare-sub">${formatSecondaryValue(row.secondaryKey, candidateSecondary)}</span>` : ""}
      </div>
      <div class="compare-cell compare-cell-base">
        <strong class="compare-main">${formatFieldValue(row.key, primaryBase)}</strong>
        ${row.secondaryKey ? `<span class="compare-sub">${formatSecondaryValue(row.secondaryKey, baseSecondary)}</span>` : ""}
      </div>
    </div>
  `;
}

function renderComparisonSection(section, candidate, baseHospital, rows) {
  return `
    <section class="compare-section${section.binary ? " is-binary-section" : ""}">
      <div class="compare-section-head">
        <h4>${section.label}</h4>
        <div class="compare-section-columns">
          <span>表示病院</span>
          <span>比較元</span>
        </div>
      </div>
      <div class="compare-table">
        ${rows.map((row) => renderCompareRow(row, candidate, baseHospital, section.binary)).join("")}
      </div>
    </section>
  `;
}

function featureDiffLabel(feature) {
  return `
    <div class="compare-inline-values">
      <span class="compare-inline-name">表示病院</span>
      <strong>${formatFieldValue(feature.key, feature.candidateValue)}</strong>
      <span class="compare-inline-name">比較元</span>
      <strong>${formatFieldValue(feature.key, feature.baseValue)}</strong>
    </div>
  `;
}

function renderSimilarityCard(baseHospital, item, index) {
  const majorSections = sectionDefinitions
    .filter((section) => visibleComparisonSectionKeys.includes(section.key))
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => visibleComparisonRowKeys.has(row.key)),
    }));

  const detailSections = sectionDefinitions;

  return `
    <article class="comparison-card">
      <div class="comparison-top">
        <div class="comparison-identity">
          <strong class="comparison-rank">TOP${index + 1} ${item.hospitalName}</strong>
          <div class="comparison-area">${buildIdentityMeta(item.profile)}</div>
          <div class="comparison-note">
            ${[item.profile.emergencyType, item.profile.ownerType, item.profile.dpcHospitalGroup]
              .filter((value) => value && !String(value).includes("不明"))
              .join(" / ")}
          </div>
        </div>
        <div class="comparison-score">
          <span class="meta-kicker">類似度</span>
          <strong>${fmtNumber(item.similarityScore, 1)}</strong>
        </div>
      </div>

      <div class="compare-section-grid">
        ${majorSections.map((section) => renderComparisonSection(section, item.profile, baseHospital, section.rows)).join("")}
      </div>

      <div class="feature-columns">
        <section>
          <div class="comparison-section-title">近似している要素</div>
          <div class="feature-list">
            ${item.similarElements
              .map(
                (feature) => `
                  <div class="feature-item temperature-warm">
                    <div>
                      <strong>${feature.label}</strong>
                    </div>
                    ${featureDiffLabel(feature)}
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
        <section>
          <div class="comparison-section-title">差異が大きい要素</div>
          <div class="feature-list">
            ${item.differentElements
              .map(
                (feature) => `
                  <div class="feature-item temperature-cool">
                    <div>
                      <strong>${feature.label}</strong>
                    </div>
                    ${featureDiffLabel(feature)}
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
      </div>

      <details class="comparison-details">
        <summary>登録している全データを表示</summary>
        <div class="compare-section-grid compare-section-grid-detail">
          ${detailSections.map((section) => renderComparisonSection(section, item.profile, baseHospital, section.rows)).join("")}
        </div>
      </details>
    </article>
  `;
}

function renderSimilarityCards(baseHospital, matches) {
  if (!matches.length) {
    similarityTop10Node.innerHTML = `<div class="comparison-empty">比較条件を満たす類似病院を抽出できませんでした。</div>`;
    return;
  }

  similarityTop10Node.innerHTML = matches.map((item, index) => renderSimilarityCard(baseHospital, item, index)).join("");
}

function buildSummaryRows(baseHospital, matches) {
  const topThree = matches.slice(0, 3);
  const functionKeys = [
    "regionalSupportHospitalScore",
    "emergencyCenterScore",
    "disasterBaseHospitalScore",
    "perinatalCareScore",
    "cancerCareScore",
    "strokeCenterScore",
    "homeCareScore",
  ];
  const functionSummary = (hospital) => {
    const labels = functionKeys
      .filter((key) => Boolean(hospital[key]))
      .map((key) => getFieldLabel(key));
    return labels.length ? labels.join(" / ") : "—";
  };
  const dpcStatus = (hospital) => (Number(hospital.dpcBeds) > 0 || hospital.dpcHospitalGroup ? "あり" : "なし");

  return [
    {
      label: "都道府県 / 二次医療圏",
      getValue: (hospital) => [hospital.prefecture, hospital.areaName ? `${hospital.areaName}医療圏` : null].filter(Boolean).join(" / ") || "—",
    },
    {
      label: "総病床数",
      getValue: (hospital) => formatFieldValue("totalBeds", hospital.totalBeds),
      getRawValue: (hospital) => hospital.totalBeds,
      getClass: (baseValue, candidateValue) =>
        baseValue == null || candidateValue == null
          ? ""
          : buildTemperatureClass(computeGap(getFieldDefinition("totalBeds"), baseValue, candidateValue)),
    },
    {
      label: "病院機能",
      getValue: functionSummary,
    },
    {
      label: "総職員数",
      getValue: (hospital) => formatFieldValue("allStaff", hospital.allStaff),
      getRawValue: (hospital) => hospital.allStaff,
      getClass: (baseValue, candidateValue) =>
        baseValue == null || candidateValue == null
          ? ""
          : buildTemperatureClass(computeGap(getFieldDefinition("allStaff"), baseValue, candidateValue)),
    },
    {
      label: "DPC有無",
      getValue: dpcStatus,
      getRawValue: dpcStatus,
      getClass: (baseValue, candidateValue) => (baseValue === candidateValue ? "temperature-warm" : "temperature-cool"),
    },
  ];
}

function renderSummaryTable(baseHospital, matches) {
  const topThree = matches.slice(0, 3);
  if (!topThree.length) {
    comparisonSummaryNode.innerHTML = `<div class="comparison-empty">比較対象がまだありません。</div>`;
    return;
  }

  const summaryRows = buildSummaryRows(baseHospital, matches);
  if (!summaryRows.length) {
    comparisonSummaryNode.innerHTML = `<div class="comparison-empty">近似要素の集計に使えるデータがありません。</div>`;
    return;
  }

  comparisonSummaryNode.innerHTML = `
    <div class="table-shell">
      <table class="summary-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>${baseHospital.name}</th>
            ${topThree.map((match) => `<th>${match.hospitalName}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${summaryRows
            .map((row) => {
              const cells = topThree
                .map((match) => {
                  const candidateRawValue = row.getRawValue ? row.getRawValue(match.profile) : null;
                  const baseRawValue = row.getRawValue ? row.getRawValue(baseHospital) : null;
                  const className = row.getClass ? row.getClass(baseRawValue, candidateRawValue) : "";
                  return `<td class="${className}">${row.getValue(match.profile)}</td>`;
                })
                .join("");
              return `
                <tr>
                  <th>${row.label}</th>
                  <td>${row.getValue(baseHospital)}</td>
                  ${cells}
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function updateQuery(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("hospital", id);
  window.history.replaceState({}, "", url);
}

function renderHospital(id) {
  const baseHospital = hospitalMap.get(id) ?? hospitalMap.get(data.focusHospitalId);
  const matches = buildTopMatches(baseHospital);

  searchInput.value = baseHospital.selectorLabel;
  selectorStatus.textContent = `選択: ${baseHospital.selectorLabel}`;
  updateHospitalListSelection(baseHospital.id);

  renderSelectedHospital(baseHospital);
  renderSummaryTable(baseHospital, matches);
  renderSimilarityCards(baseHospital, matches);
  updateQuery(baseHospital.id);
}

function renderEmptyState() {
  selectorStatus.textContent = "病院名の一部検索、または所在地フィルターから病院を選択してください。";
  selectedHospitalNode.innerHTML = `<div class="comparison-empty">病院を選ぶと、登録済みの全データを表示します。</div>`;
  comparisonSummaryNode.innerHTML = `<div class="comparison-empty">比較元を選ぶと、上位3病院との近似要素サマリーを表示します。</div>`;
  similarityTop10Node.innerHTML = `<div class="comparison-empty">まだ病院が選択されていません。</div>`;
}

function populateSelect(selectNode, values, placeholder) {
  const currentValue = selectNode.value;
  selectNode.innerHTML = [`<option value="">${placeholder}</option>`, ...values.map((value) => `<option value="${value}">${value}</option>`)].join("");
  if (values.includes(currentValue)) {
    selectNode.value = currentValue;
  }
}

function buildFilterOptions() {
  const prefectures = [...new Set(hospitals.map((hospital) => hospital.prefecture).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  populateSelect(prefectureFilter, prefectures, "すべての都道府県");
  refreshDependentFilters();
}

function refreshDependentFilters() {
  const filteredByPrefecture = hospitals.filter((hospital) => !prefectureFilter.value || hospital.prefecture === prefectureFilter.value);
  const areas = [...new Set(filteredByPrefecture.map((hospital) => hospital.areaName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  populateSelect(areaFilter, areas, "すべての医療圏");
  if (areaFilter.value && !areas.includes(areaFilter.value)) {
    areaFilter.value = "";
  }

  const filteredByArea = filteredByPrefecture.filter((hospital) => !areaFilter.value || hospital.areaName === areaFilter.value);
  const cities = [...new Set(filteredByArea.map((hospital) => hospital.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  populateSelect(cityFilter, cities, "すべての市区町村");
  if (cityFilter.value && !cities.includes(cityFilter.value)) {
    cityFilter.value = "";
  }
}

function hasDpc(hospital) {
  return Number(hospital.dpcBeds) > 0 || Boolean(hospital.dpcHospitalGroup);
}

function getFilteredHospitals() {
  const query = normalizeText(searchInput.value);
  return hospitals.filter((hospital) => {
    if (prefectureFilter.value && hospital.prefecture !== prefectureFilter.value) {
      return false;
    }
    if (areaFilter.value && hospital.areaName !== areaFilter.value) {
      return false;
    }
    if (cityFilter.value && hospital.city !== cityFilter.value) {
      return false;
    }
    if (dpcFilter.value === "yes" && !hasDpc(hospital)) {
      return false;
    }
    if (dpcFilter.value === "no" && hasDpc(hospital)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      hospital.selectorLabel,
      hospital.name,
      hospital.prefecture,
      hospital.areaName,
      hospital.city,
    ]
      .filter(Boolean)
      .some((value) => normalizeText(value).includes(query));
  });
}

function updateHospitalOptions(filteredHospitals) {
  hospitalOptions.innerHTML = filteredHospitals
    .slice(0, 200)
    .map((hospital) => `<option value="${hospital.selectorLabel}"></option>`)
    .join("");
}

function updateHospitalListSelection(id) {
  [...hospitalList.options].forEach((option) => {
    option.selected = option.value === id;
  });
}

function updateHospitalList() {
  const filteredHospitals = getFilteredHospitals();
  if (filteredHospitals.length > 100) {
    hospitalList.disabled = true;
    hospitalList.innerHTML = `<option value="">絞り込み結果が100件以上です</option>`;
  } else {
    hospitalList.disabled = false;
    hospitalList.innerHTML = filteredHospitals
      .sort((left, right) => left.selectorLabel.localeCompare(right.selectorLabel, "ja"))
      .map((hospital) => `<option value="${hospital.id}">${hospital.selectorLabel}</option>`)
      .join("");
  }
  updateHospitalOptions(filteredHospitals);

  const dpcLabel = dpcFilter.value === "yes" ? "DPCあり" : dpcFilter.value === "no" ? "DPCなし" : "";
  const filterLabels = [prefectureFilter.value, areaFilter.value, cityFilter.value, dpcLabel].filter(Boolean).join(" / ");
  selectorStatus.textContent = filterLabels
    ? `絞り込み結果: ${fmtNumber(filteredHospitals.length)} 件（${filterLabels}）`
    : `絞り込み結果: ${fmtNumber(filteredHospitals.length)} 件`;
}

function resolveHospitalId(query) {
  const exactId = labelToIdMap.get(query);
  if (exactId) {
    return exactId;
  }

  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return hospitalList.value || null;
  }

  const filteredHospitals = getFilteredHospitals();
  const partialMatch = filteredHospitals.find((hospital) =>
    [hospital.selectorLabel, hospital.name, hospital.prefecture, hospital.areaName, hospital.city]
      .filter(Boolean)
      .some((value) => normalizeText(value).includes(normalizedQuery)),
  );
  return partialMatch?.id ?? null;
}

function initializeMeta() {
  sourceLabelNode.textContent = "株式会社 日本経営 医療需給総覧 Ver 1.0";
  hospitalCountNode.textContent = `${fmtNumber(hospitals.length)} 病院`;
  generatedAtNode.textContent = fmtDate(data.generatedAt);
}

function bindEvents() {
  searchInput.addEventListener("input", () => {
    updateHospitalList();
  });

  [prefectureFilter, areaFilter, cityFilter].forEach((node, index) => {
    node.addEventListener("change", () => {
      if (index < 2) {
        refreshDependentFilters();
      }
      updateHospitalList();
    });
  });

  dpcFilter.addEventListener("change", () => {
    updateHospitalList();
  });

  hospitalList.addEventListener("change", () => {
    const id = hospitalList.value;
    const hospital = hospitalMap.get(id);
    if (!hospital) {
      return;
    }
    searchInput.value = hospital.selectorLabel;
    renderHospital(id);
  });

  hospitalList.addEventListener("dblclick", () => {
    if (hospitalList.value) {
      renderHospital(hospitalList.value);
    }
  });

  hospitalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const resolvedId = resolveHospitalId(searchInput.value);
    if (!resolvedId) {
      selectorStatus.textContent = "一致する病院が見つかりませんでした。部分一致検索または絞り込みリストから選択してください。";
      return;
    }
    renderHospital(resolvedId);
  });
}

function initialize() {
  initializeMeta();
  buildFilterOptions();
  updateHospitalList();
  bindEvents();

  const initialId = (() => {
    const params = new URL(window.location.href).searchParams;
    const queryId = params.get("hospital");
    if (!queryId) {
      return null;
    }
    if (hospitalMap.has(queryId)) {
      return queryId;
    }
    return resolveHospitalId(queryId);
  })();

  if (initialId) {
    renderHospital(initialId);
    return;
  }

  renderEmptyState();
}

initialize();
