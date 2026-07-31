#!/usr/bin/env node
/**
 * 批量抓取 audienceAnalysis 接口数据
 * 输入: 原项目目录 data/playlets-export.json (获取 playletId 列表)
 * 输出: 当前工作目录 data/audience-data.json
 *
 * 优化：并发 8 个请求，失败重试 1 次，跳过已成功的条目
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = '/Users/juzi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a6322fb00cfa9ee0272e86f';
const TOKEN_FILE = path.join(SOURCE_DIR, 'data/.token.json');
const PLAYLETS_FILE = path.join(SOURCE_DIR, 'data/playlets-export.json');
const OLD_AUDIENCE_FILE = path.join(SOURCE_DIR, 'data/audience-data.json');
const OUT_FILE = path.resolve(__dirname, 'data/audience-data.json');

const CONCURRENCY = 2;
const API_BASE = 'https://playlet-applet.dataeye.com/playlet/audienceAnalysis';
const LOGIN_USER_ID = '657757';
const REQUEST_DELAY_MS = 150;

function readJson(p) { if (!fs.existsSync(p)) return {}; return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); }

async function fetchOne(playletId, headers, attempt = 1) {
  const url = `${API_BASE}?playletId=${playletId}`;
  // 用 curl 抓取（Node fetch 被服务器风控，curl 可正常；不指定 UA 让 curl 用默认）
  const cmd = `curl -s --max-time 10 -H "authentication: ${headers.authentication}" -H "S: ${headers.S}" -H "loginUserId: ${headers.loginUserId}" "${url}"`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (!stdout) return { ok: false, noData: true };
    const j = JSON.parse(stdout);
    if (j.statusCode === 200 && j.content && typeof j.content === 'object' && j.content.ageDistro) {
      return { ok: true, data: j.content };
    }
    if (Math.random() < 0.01) {
      console.log(`  [DEBUG] pid=${playletId} statusCode=${j.statusCode} content=${JSON.stringify(j.content).slice(0, 100)}`);
    }
    return { ok: false, noData: true };
  } catch (e) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 800));
      return fetchOne(playletId, headers, attempt + 1);
    }
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('=== 批量抓取 audienceAnalysis 数据 ===');
  const token = readJson(TOKEN_FILE);
  if (!token.authentication) { console.error('❌ 无 token'); process.exit(1); }
  const headers = {
    'authentication': token.authentication,
    'S': token.S,
    'loginUserId': LOGIN_USER_ID,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x1800280028) NetType/WIFI Language/zh_CN',
  };
  console.log(`Token 有效至: ${token.exp_text || 'unknown'}\n`);

  // 加载剧目列表：从 captured 榜单文件中提取所有 playletId
  const CAPTURED_DIR = path.join(SOURCE_DIR, 'data/captured');
  const RANK_FILES = [
    'hot-rank.json', 'hongguo-rank.json', 'huolong-rank.json',
    'native-play-count.json', 'kuaishou-native-play-count.json',
    'wechat-rank.json', 'pdd-rank.json', 'kuaishou-rank-1.json',
    'kuaishou-rank-2.json', 'tencent-rank-1.json', 'iqiyi-rank.json',
    'tencent-rank-2.json', 'youku-rank.json', 'brand-rank.json',
    'publisher-rank.json', 'ai-rank.json', 'motion-comic-0.json',
    'motion-comic-1.json', 'motion-comic-2.json', 'motion-comic-3.json', 'comics-rank.json',
  ];
  const idSet = new Set();
  for (const f of RANK_FILES) {
    const fp = path.join(CAPTURED_DIR, f);
    if (!fs.existsSync(fp)) continue;
    const data = JSON.parse(fs.readFileSync(fp, 'utf8') || '{}');
    const rows = Array.isArray(data) ? data : (data.content || data.rows || data.data || data.list || data.items || []);
    for (const r of rows) {
      const id = r.playletId ?? r.playlet_id ?? r.originalId;
      if (id != null) idSet.add(Number(id));
    }
  }
  const playletList = [...idSet].sort((a, b) => a - b);
  console.log(`剧目总数: ${playletList.length}`);

  // 加载旧数据（优先当前目录，其次原目录）
  const localData = fs.existsSync(OUT_FILE) ? readJson(OUT_FILE) : {};
  const oldData = Object.assign({}, readJson(OLD_AUDIENCE_FILE), localData);
  const out = {};
  let skipCount = 0;
  let needFetch = [];
  for (const id of playletList) {
    const old = oldData[String(id)];
    if (old && typeof old === 'object' && old.ageDistro) {
      out[String(id)] = old;
      skipCount++;
    } else {
      needFetch.push(id);
    }
  }
  console.log(`已成功(跳过): ${skipCount}`);
  console.log(`需要抓取: ${needFetch.length}`);

  // 并发抓取
  let ok = 0, fail = 0, noData = 0;
  let idx = 0;
  const startTime = Date.now();

  async function worker(workerId) {
    while (idx < needFetch.length) {
      const myIdx = idx++;
      const id = needFetch[myIdx];
      const r = await fetchOne(id, headers);
      if (r.ok) {
        out[String(id)] = r.data;
        ok++;
      } else if (r.noData) {
        noData++;
      } else {
        fail++;
      }
      if ((ok + fail + noData) % 20 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((ok + fail + noData) / elapsed).toFixed(2);
        console.log(`  进度 ${ok + fail + noData}/${needFetch.length}  ✅${ok}  ❌${fail}  无数据${noData}  ${rate}/s`);
      }
      // 请求间延迟，避免触发风控
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  // 保存
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== 完成 (${elapsed}s) ===`);
  console.log(`  成功: ${ok + skipCount}`);
  console.log(`  无数据: ${noData}`);
  console.log(`  失败: ${fail}`);
  console.log(`  总条目: ${Object.keys(out).length}`);
  console.log(`  输出: ${OUT_FILE}`);
}

main();
