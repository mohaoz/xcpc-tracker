function has(re, s) {
  return re.test(s);
}

const WARM_UP = /warmup|热身|warm/iu;
const CCPC = /ccpc|国大|China Collegiate Programming Contest/iu;
const PROVINCIAL = /省赛|省大|市赛|市大/iu;
const PROVINCIAL_SUFFIX =
  /provincial collegiate|province programming|provincial contest|provincial programming|collegiate programming/iu;
const ICPC = /icpc|international collegiate programming contest/iu;
const EC =
  /asia east|asia-east|hong kong|macau|shanghai|beijing|mudanjiang|xian|xi'an|wuhan|guangzhou|changchun|shenyang|qingdao|nanning|ürümqi|nanjing|jiaozuo|xuzhou|hubei|jiangsu|sichuan|zhejiang|shandong|jiangxi|xinjiang|hunan|hubei|shaanxi|shanxi|jilin|heilongjiang|multi-provincial|guangdong|liaoning|chengdu|yinchuan|kunming|china-final|ec-final|jinan|hangzhou|hefei|hebei|asia ec/iu;
const ONLINE = /online/iu;
const CAMP = /camp|petrozavodsk|workshops/iu;
const APPENDIX = /Stage 15: Hangzhou/;

function _match(title) {
  const text = String(title || "");

  if (!text.trim()) return false;

  if (has(APPENDIX, text)) return true;

  if (has(WARM_UP, text) || has(CAMP, text)) return false;

  if (has(CCPC, text) && has(ONLINE, text)) return true;
  if (has(ICPC, text) && has(EC, text) && has(ONLINE, text)) return true;

  if (has(CCPC, text)) return true;
  if (has(PROVINCIAL, text)) return true;
  if (has(PROVINCIAL_SUFFIX, text) && has(EC, text)) return true;
  if (has(ICPC, text) && has(EC, text)) return true;

  return false;
}

function match(title) {
  return _match(title);
}

function groupKey(item) {
  try {
    const u = new URL(item.url);
    return u.origin + u.pathname;
  } catch {
    return item.url;
  }
}

module.exports = {
  match,
  groupKey,
};
