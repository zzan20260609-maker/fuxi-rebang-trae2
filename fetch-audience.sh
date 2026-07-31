#!/bin/bash
# 批量抓取 audienceAnalysis 数据（shell 版本，绕过 Node fetch 风控）
# 输入: 原项目目录 data/.token.json
# 输出: 当前目录 data/audience-data.json
set -e

SOURCE_DIR="/Users/juzi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a6322fb00cfa9ee0272e86f"
CAPTURED_DIR="$SOURCE_DIR/data/captured"
TOKEN_FILE="$SOURCE_DIR/data/.token.json"
OUT_DIR="$(pwd)/data"
OUT_FILE="$OUT_DIR/audience-data.json"
RAW_DIR="$OUT_DIR/audience-raw"

mkdir -p "$OUT_DIR" "$RAW_DIR"

# 读取 token
AUTH=$(node -e "console.log(require('$TOKEN_FILE').authentication)")
S=$(node -e "console.log(require('$TOKEN_FILE').S)")
echo "Token长度: ${#AUTH}"

# 提取所有 playletId
node -e "
const fs=require('fs');
const path=require('path');
const dir='$CAPTURED_DIR';
const files=['hot-rank.json','hongguo-rank.json','huolong-rank.json','native-play-count.json','kuaishou-native-play-count.json','wechat-rank.json','pdd-rank.json','kuaishou-rank-1.json','kuaishou-rank-2.json','tencent-rank-1.json','iqiyi-rank.json','tencent-rank-2.json','youku-rank.json','brand-rank.json','publisher-rank.json','ai-rank.json','motion-comic-0.json','motion-comic-1.json','motion-comic-2.json','motion-comic-3.json','comics-rank.json'];
const idSet=new Set();
for(const f of files){
  const fp=path.join(dir,f);
  if(!fs.existsSync(fp)) continue;
  const data=JSON.parse(fs.readFileSync(fp,'utf8')||'{}');
  const rows=Array.isArray(data)?data:(data.content||data.rows||data.data||data.list||data.items||[]);
  for(const r of rows){
    const id=r.playletId??r.playlet_id??r.originalId;
    if(id!=null) idSet.add(Number(id));
  }
}
const ids=[...idSet].sort((a,b)=>a-b);
fs.writeFileSync('$RAW_DIR/all-ids.json',JSON.stringify(ids,null,2));
console.log('Total IDs:',ids.length);
"

# 加载已成功的数据（如果有的话）
node -e "
const fs=require('fs');
const outFile='$OUT_FILE';
const oldFile='$SOURCE_DIR/data/audience-data.json';
const out={};
if(fs.existsSync(oldFile)){
  const old=JSON.parse(fs.readFileSync(oldFile,'utf8')||'{}');
  for(const [k,v] of Object.entries(old)){
    if(v&&typeof v==='object'&&v.ageDistro) out[k]=v;
  }
}
fs.writeFileSync(outFile,JSON.stringify(out,null,2));
console.log('Pre-loaded:',Object.keys(out).length);
"

IDS_FILE="$RAW_DIR/all-ids.json"
TOTAL=$(node -e "console.log(require('$IDS_FILE').length)")
echo "需要抓取: $TOTAL 部剧"
echo ""

# 批量 curl
OK=0
NODATA=0
FAIL=0
I=0
START=$(date +%s)

while read -r PID; do
  I=$((I+1))
  # 已存在则跳过
  HAS=$(node -e "
    const o=require('$OUT_FILE');
    const v=o['$PID'];
    if(v&&typeof v==='object'&&v.ageDistro){console.log('skip');}else{console.log('fetch');}
  ")
  if [ "$HAS" = "skip" ]; then
    OK=$((OK+1))
    continue
  fi

  # curl 抓取
  RESP=$(curl -s --max-time 10 \
    -H "authentication: $AUTH" \
    -H "S: $S" \
    -H "loginUserId: 657757" \
    "https://playlet-applet.dataeye.com/playlet/audienceAnalysis?playletId=$PID" 2>/dev/null || echo "FETCH_ERROR")

  # 用 Node 解析并合并到输出文件
  RESULT=$(node -e "
    const fs=require('fs');
    const out=JSON.parse(fs.readFileSync('$OUT_FILE','utf8')||'{}');
    try{
      const j=JSON.parse(process.argv[1]);
      if(j.statusCode===200&&j.content&&typeof j.content==='object'&&j.content.ageDistro){
        out['$PID']=j.content;
        fs.writeFileSync('$OUT_FILE',JSON.stringify(out,null,2));
        console.log('ok');
      }else{
        console.log('nodata:'+j.statusCode);
      }
    }catch(e){console.log('fail:'+e.message);}
  " "$RESP")

  case "$RESULT" in
    ok) OK=$((OK+1));;
    nodata:*) NODATA=$((NODATA+1));;
    *) FAIL=$((FAIL+1));;
  esac

  # 进度日志
  if [ $((I % 20)) -eq 0 ]; then
    NOW=$(date +%s)
    ELAPSED=$((NOW-START))
    RATE=$(echo "scale=2;$I/$ELAPSED" | bc 2>/dev/null || echo "?")
    echo "  进度 $I/$TOTAL  ✅$OK  无数据$NODATA  ❌$FAIL  ${RATE}/s"
  fi

  # 请求间延迟
  sleep 0.2
done < <(node -e "const ids=require('$IDS_FILE');for(const id of ids)console.log(id);")

echo ""
echo "=== 完成 ==="
echo "成功: $OK"
echo "无数据: $NODATA"
echo "失败: $FAIL"
echo "输出: $OUT_FILE"

# 显示数据量
node -e "
const o=require('$OUT_FILE');
const real=Object.values(o).filter(v=>v&&typeof v==='object'&&v.ageDistro).length;
console.log('真实有受众画像数据:',real,'/',Object.keys(o).length);
"
