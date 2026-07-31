#!/usr/bin/env node
/**
 * 受众维度反查题材榜（反向索引）
 *
 * 输入：
 *   - 原项目目录的 data/captured/*.json（21 个榜单）
 *   - 原项目目录的 data/audience-data.json（449 部剧的真实受众画像）
 *
 * 输出：
 *   - data/audience-theme-index.json
 *     - byAgeGroup: 青年/中年/老年 各自爱看的题材 Top 10（含份额+代表剧目）
 *     - byCity: 北京/上海/苏州/广州/深圳/成都/重庆/杭州/西安/东莞 等城市各自爱看的题材 Top 10
 *
 * 加权方法：
 *   一部剧对 (题材 × 年龄段) 的贡献 = 剧的总热度 × 受众在该年龄段的占比
 *   一部剧对 (题材 × 城市) 的贡献 = 剧的总热度 × 受众在该城市的占比
 *
 * 用法：
 *   node audience-theme-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 原项目数据目录
const SOURCE_DIR = '/Users/juzi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a6322fb00cfa9ee0272e86f';
const CAPTURED_DIR = path.join(SOURCE_DIR, 'data/captured');
const AUDIENCE_FILE = path.resolve(__dirname, 'data/audience-data.json');
const OUT_FILE = path.resolve(__dirname, 'data/audience-theme-index.json');

const TOP_N_PER_DIM = 10;
const MIN_THEME_HEAT = 0;

const PLAYLET_RANK_FILES = [
  'hot-rank.json', 'hongguo-rank.json', 'huolong-rank.json',
  'native-play-count.json', 'kuaishou-native-play-count.json',
  'wechat-rank.json', 'pdd-rank.json', 'kuaishou-rank-1.json',
  'kuaishou-rank-2.json', 'tencent-rank-1.json', 'iqiyi-rank.json',
  'tencent-rank-2.json', 'youku-rank.json', 'brand-rank.json',
  'publisher-rank.json',
  'ai-rank.json', 'motion-comic-0.json', 'motion-comic-1.json',
  'motion-comic-2.json', 'motion-comic-3.json', 'comics-rank.json',
];

function readJson(p) { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function extractRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ['content', 'rows', 'data', 'list', 'items']) { if (Array.isArray(data[k])) return data[k]; }
  return [];
}
function safeParse(val) { if (typeof val === 'string') { try { return JSON.parse(val); } catch { return null; } } return val; }

function extractThemes(row) {
  const themes = new Set();
  if (Array.isArray(row.playletTags)) {
    for (const t of row.playletTags) { if (typeof t === 'string' && t.trim()) themes.add(t.trim()); }
  }
  if (themes.size === 0) {
    const ct = safeParse(row.contentTypes);
    if (Array.isArray(ct)) { for (const t of ct) { if (typeof t === 'string' && t.trim()) themes.add(t.trim()); } }
  }
  if (themes.size === 0) {
    if (typeof row.theme === 'string' && row.theme.trim()) themes.add(row.theme.trim());
    if (typeof row.dramaTheme === 'string' && row.dramaTheme.trim()) {
      for (const t of row.dramaTheme.split(/[、,，]/)) { if (t.trim()) themes.add(t.trim()); }
    }
  }
  return [...themes];
}

function parsePlayCount(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/([\d.]+)\s*亿/); if (m) return Math.round(Number(m[1]) * 1e8);
  const m2 = str.match(/([\d.]+)\s*w/i); if (m2) return Math.round(Number(m2[1]) * 1e4);
  const m3 = str.match(/([\d.]+)\s*万/); if (m3) return Math.round(Number(m3[1]) * 1e4);
  const n = Number(str.replace(/[^\d.]/g, '')); return isNaN(n) ? null : n;
}

function getPlayletId(row) { return row.playletId ?? row.playlet_id ?? row.originalId ?? null; }
function getPlayletName(row) { return row.playletName ?? row.dramaName ?? row.name ?? null; }

function extractPlatformData(row, sourceFile) {
  const platforms = {};
  if (sourceFile === 'native-play-count.json') { const pc = parsePlayCount(row.playCount); if (pc != null) platforms.douyin = { value: pc, field: 'playCount', source: sourceFile }; }
  if (sourceFile === 'kuaishou-native-play-count.json') { const pc = parsePlayCount(row.playCount); if (pc != null) platforms.kuaishou = { value: pc, field: 'playCount', source: sourceFile }; }
  if (typeof row.totalConsumeNum === 'number' && row.totalConsumeNum > 0) {
    if (sourceFile === 'hongguo-rank.json') platforms.hongguo = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile };
    else if (sourceFile === 'hot-rank.json' && !platforms.hongguo) platforms.hongguo = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile };
  }
  if (sourceFile === 'wechat-rank.json') { const hv = typeof row.hotValue === 'number' ? row.hotValue : (typeof row.hotDegree === 'number' ? row.hotDegree : null); if (hv != null) platforms.wechat = { value: hv, field: 'hotValue', source: sourceFile }; }
  if (sourceFile === 'iqiyi-rank.json' && typeof row.hotValue === 'number') platforms.iqiyi = { value: row.hotValue, field: 'hotValue', source: sourceFile };
  if (sourceFile === 'youku-rank.json') {
    if (typeof row.hotValue === 'number' && row.hotValue > 0) platforms.youku = { value: row.hotValue, field: 'hotValue', source: sourceFile };
    else if (typeof row.tag === 'string' && row.tag.trim()) { const tagVal = { '爆剧': 100, '热剧': 60, '好剧': 30 }[row.tag.trim()] || 10; platforms.youku = { value: tagVal, field: 'tag', source: sourceFile }; }
  }
  if ((sourceFile === 'kuaishou-rank-1.json' || sourceFile === 'kuaishou-rank-2.json') && typeof row.totalConsumeNum === 'number') { if (!platforms.kuaishou) platforms.kuaishou = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile }; }
  if (sourceFile === 'tencent-rank-1.json' || sourceFile === 'tencent-rank-2.json') {
    if (typeof row.hotValue === 'number' && row.hotValue > 0) platforms.tencent = { value: row.hotValue, field: 'hotValue', source: sourceFile };
    else if (typeof row.totalConsumeNum === 'number' && row.totalConsumeNum > 0) platforms.tencent = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile };
  }
  if (sourceFile === 'huolong-rank.json' && typeof row.totalConsumeNum === 'number' && row.totalConsumeNum > 0) { if (!platforms.hongguo) platforms.hongguo = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile }; }
  if (sourceFile === 'pdd-rank.json' && typeof row.totalConsumeNum === 'number' && row.totalConsumeNum > 0) platforms.pdd = { value: row.totalConsumeNum, field: 'totalConsumeNum', source: sourceFile };
  return platforms;
}

// 年龄段归一化：原始 5 档 → 青年(18-30)/中年(31-50)/老年(51+)
function normalizeAgeDist(ageDistro) {
  if (!ageDistro || typeof ageDistro !== 'object') return null;
  let young = 0, middle = 0, old = 0;
  for (const [age, pct] of Object.entries(ageDistro)) {
    if (age === '18-23' || age === '24-30') young += pct;
    else if (age === '31-40' || age === '41-50') middle += pct;
    else if (age === '51+') old += pct;
  }
  return { young, middle, old };
}

// ── 主流程 ──
function main() {
  console.log('=== 受众维度反查题材榜（反向索引） ===');
  console.log(`数据源: ${SOURCE_DIR}`);
  console.log(`输出: ${OUT_FILE}\n`);

  const audienceData = readJson(AUDIENCE_FILE) || {};
  console.log(`受众画像数据: ${Object.keys(audienceData).length} 条`);

  // 第一步：聚合所有榜单数据，得到每部剧的题材+热度
  const playletsMap = new Map();
  let scannedFiles = 0;
  let scannedRows = 0;

  for (const file of PLAYLET_RANK_FILES) {
    const filePath = path.join(CAPTURED_DIR, file);
    const data = readJson(filePath);
    const rows = extractRows(data);
    if (rows.length === 0) continue;
    scannedFiles++;
    scannedRows += rows.length;

    for (const row of rows) {
      const id = getPlayletId(row);
      const name = getPlayletName(row);
      if (!id && !name) continue;

      const key = id ? String(id) : `name:${name}`;
      const themes = extractThemes(row);
      const platforms = extractPlatformData(row, file);

      if (!playletsMap.has(key)) {
        playletsMap.set(key, {
          playletId: id, name,
          themes: new Set(),
          platforms: {},
          appearances: 0,
        });
      }
      const p = playletsMap.get(key);
      for (const t of themes) p.themes.add(t);
      for (const [plat, pd] of Object.entries(platforms)) {
        if (!p.platforms[plat] || pd.value > p.platforms[plat].value) p.platforms[plat] = { ...pd };
      }
      p.appearances++;
    }
  }

  console.log(`扫描 ${scannedFiles} 个榜单文件，${scannedRows} 行`);
  console.log(`去重后剧目: ${playletsMap.size} 部`);

  // 第二步：构建反向索引矩阵
  // ageGroupThemeHeat[ageGroup][theme] = heat
  const ageGroupThemeHeat = { young: {}, middle: {}, old: {} };
  const cityThemeHeat = {};
  const ageGroupTotal = { young: 0, middle: 0, old: 0 };
  const cityTotal = {};
  const ageGroupTopPlaylets = {};  // key: `${ageGroup}|${theme}`
  const cityTopPlaylets = {};     // key: `${city}|${theme}`
  let analyzedPlaylets = 0;
  const dimPlayletCount = { young: 0, middle: 0, old: 0 };

  for (const p of playletsMap.values()) {
    if (!p.playletId || p.themes.size === 0) continue;
    const audience = audienceData[String(p.playletId)];
    if (!audience || typeof audience !== 'object') continue;
    if (!audience.ageDistro && !audience.cityDistro) continue;

    // 计算剧的总热度（各平台 value 之和）
    let playletHeat = 0;
    for (const pd of Object.values(p.platforms)) playletHeat += pd.value;
    if (playletHeat <= 0) continue;

    analyzedPlaylets++;
    const themes = [...p.themes];
    const ageNorm = normalizeAgeDist(audience.ageDistro);

    // 年龄段贡献
    if (ageNorm) {
      const contribution = { young: playletHeat * ageNorm.young, middle: playletHeat * ageNorm.middle, old: playletHeat * ageNorm.old };
      for (const ag of ['young', 'middle', 'old']) {
        if (contribution[ag] <= 0) continue;
        if (!dimPlayletCount[ag]) dimPlayletCount[ag] = 0;
        dimPlayletCount[ag]++;
        for (const t of themes) {
          ageGroupThemeHeat[ag][t] = (ageGroupThemeHeat[ag][t] || 0) + contribution[ag];
          ageGroupTotal[ag] += contribution[ag];
          const k = `${ag}|${t}`;
          if (!ageGroupTopPlaylets[k]) ageGroupTopPlaylets[k] = [];
          ageGroupTopPlaylets[k].push({ name: p.name, playletId: p.playletId, heat: contribution[ag] });
        }
      }
    }

    // 城市贡献
    if (audience.cityDistro) {
      for (const [city, pct] of Object.entries(audience.cityDistro)) {
        if (pct <= 0) continue;
        const cityH = playletHeat * pct;
        if (!cityThemeHeat[city]) { cityThemeHeat[city] = {}; cityTotal[city] = 0; }
        for (const t of themes) {
          cityThemeHeat[city][t] = (cityThemeHeat[city][t] || 0) + cityH;
          cityTotal[city] += cityH;
          const ck = `${city}|${t}`;
          if (!cityTopPlaylets[ck]) cityTopPlaylets[ck] = [];
          cityTopPlaylets[ck].push({ name: p.name, playletId: p.playletId, heat: cityH });
        }
        if (!dimPlayletCount[city]) dimPlayletCount[city] = 0;
        dimPlayletCount[city]++;
      }
    }
  }

  console.log(`有受众画像+热度的剧: ${analyzedPlaylets} 部`);

  // 第三步：格式化输出
  const formatAgeGroup = (ag) => {
    const total = ageGroupTotal[ag];
    if (total <= 0) return [];
    return Object.entries(ageGroupThemeHeat[ag])
      .filter(([_, h]) => h >= MIN_THEME_HEAT)
      .map(([theme, heat]) => {
        const key = `${ag}|${theme}`;
        return {
          theme,
          heat: Math.round(heat),
          share: Number((heat / total * 100).toFixed(2)),
          topPlaylets: (ageGroupTopPlaylets[key] || [])
            .sort((a, b) => b.heat - a.heat)
            .slice(0, 3)
            .map(p => ({ name: p.name, playletId: p.playletId, heat: Math.round(p.heat) })),
        };
      })
      .sort((a, b) => b.heat - a.heat)
      .slice(0, TOP_N_PER_DIM);
  };

  const formatCity = (city) => {
    const total = cityTotal[city];
    if (total <= 0) return [];
    return Object.entries(cityThemeHeat[city])
      .filter(([_, h]) => h >= MIN_THEME_HEAT)
      .map(([theme, heat]) => {
        const key = `${city}|${theme}`;
        return {
          theme,
          heat: Math.round(heat),
          share: Number((heat / total * 100).toFixed(2)),
          topPlaylets: (cityTopPlaylets[key] || [])
            .sort((a, b) => b.heat - a.heat)
            .slice(0, 3)
            .map(p => ({ name: p.name, playletId: p.playletId, heat: Math.round(p.heat) })),
        };
      })
      .sort((a, b) => b.heat - a.heat)
      .slice(0, TOP_N_PER_DIM);
  };

  const byAgeGroup = {
    young: { label: '青年 (18-30岁)', totalHeat: Math.round(ageGroupTotal.young), playletCount: dimPlayletCount.young, themes: formatAgeGroup('young') },
    middle: { label: '中年 (31-50岁)', totalHeat: Math.round(ageGroupTotal.middle), playletCount: dimPlayletCount.middle, themes: formatAgeGroup('middle') },
    old: { label: '老年 (51岁以上)', totalHeat: Math.round(ageGroupTotal.old), playletCount: dimPlayletCount.old, themes: formatAgeGroup('old') },
  };

  const byCity = {};
  for (const city of Object.keys(cityThemeHeat).sort((a, b) => cityTotal[b] - cityTotal[a])) {
    byCity[city] = {
      totalHeat: Math.round(cityTotal[city]),
      playletCount: dimPlayletCount[city],
      themes: formatCity(city),
    };
  }

  const generatedAt = new Date();
  const output = {
    export: {
      name: '受众维度反查题材榜',
      generatedAt: generatedAt.toISOString(),
      generatedAtMs: generatedAt.getTime(),
      source: `DataEye 剧目榜单聚合（${scannedFiles} 个榜单）+ audienceAnalysis 真实受众画像（${analyzedPlaylets} 部剧参与反查）`,
      methodology: '按受众维度反向索引题材。每部剧对 (题材 × 受众维度) 的贡献 = 剧的总热度 × 受众在该维度的占比。份额=该题材贡献/该维度总贡献。',
      fieldSchema: {
        byAgeGroup: '按年龄段反查的题材偏好',
        'byAgeGroup.young/middle/old': '青年(18-30)/中年(31-50)/老年(51+) 三个年龄段',
        'byAgeGroup.*.themes': '该年龄段下题材排名 Top10',
        'byAgeGroup.*.themes[].heat': '题材在该年龄段的累计热度贡献',
        'byAgeGroup.*.themes[].share': '题材在该年龄段的市场份额(%)',
        'byAgeGroup.*.themes[].topPlaylets': '该题材在该年龄段的代表剧目 Top3',
        byCity: '按城市反查的题材偏好',
        'byCity.<城市名>': '每个主要城市的题材排名 Top10',
      },
      filters: { topNPerDim: TOP_N_PER_DIM, minThemeHeat: MIN_THEME_HEAT },
      stats: {
        scannedFiles, scannedRows,
        uniquePlaylets: playletsMap.size,
        analyzedPlaylets,
        ageGroups: 3,
        cities: Object.keys(cityThemeHeat).length,
        cityList: Object.keys(cityThemeHeat).sort((a, b) => cityTotal[b] - cityTotal[a]),
      },
    },
    byAgeGroup,
    byCity,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  // 控制台预览
  console.log('\n=== 按年龄段反查 ===');
  for (const [ag, info] of Object.entries(byAgeGroup)) {
    console.log(`\n[${info.label}] 总热度=${info.totalHeat.toLocaleString()}  参与剧目=${info.playletCount}`);
    info.themes.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.theme}  热度=${t.heat.toLocaleString()}  份额=${t.share}%`);
      if (t.topPlaylets[0]) console.log(`     代表: ${t.topPlaylets[0].name}`);
    });
  }

  console.log('\n=== 按城市反查（Top 5 城市）===');
  Object.entries(byCity).slice(0, 5).forEach(([city, info]) => {
    console.log(`\n[${city}] 总热度=${info.totalHeat.toLocaleString()}  参与剧目=${info.playletCount}`);
    info.themes.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.theme}  热度=${t.heat.toLocaleString()}  份额=${t.share}%`);
      if (t.topPlaylets[0]) console.log(`     代表: ${t.topPlaylets[0].name}`);
    });
  });

  // 北京/上海/苏州 专项展示
  console.log('\n=== 重点城市专项 ===');
  for (const city of ['北京', '上海', '苏州', '广州', '深圳', '成都', '重庆', '杭州']) {
    const info = byCity[city];
    if (!info) { console.log(`\n[${city}] 无数据`); continue; }
    console.log(`\n[${city}] 总热度=${info.totalHeat.toLocaleString()}  参与剧目=${info.playletCount}`);
    info.themes.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.theme}  热度=${t.heat.toLocaleString()}  份额=${t.share}%`);
    });
  }

  const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`\n✅ 输出: ${OUT_FILE} (${sizeKb} KB)`);
}

main();
