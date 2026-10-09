<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { qojIssueLabels, useQojSyncStore } from "../stores/qoj-sync";

const sync = useQojSyncStore();
const enabling = ref(false);

const sections = [
  { id: "overview", label: "两种同步方式" },
  { id: "manual", label: "手动导入" },
  { id: "userscript", label: "油猴脚本" },
  { id: "auto-sync", label: "自动同步" },
  { id: "troubleshooting", label: "常见问题" },
  { id: "privacy", label: "权限与隐私" },
];

// Codes users can act on; internal states (CANCELLED, BUSY) are self-explanatory in context.
const troubleshootingCodes = [
  "BRIDGE_MISSING", "AUTH_REQUIRED", "CHALLENGE_REQUIRED", "PERMISSION_REQUIRED",
  "RATE_LIMITED", "USER_NOT_FOUND", "PARSE_ERROR", "TIMEOUT", "NETWORK_ERROR",
  "STORAGE_ERROR", "LOCK_UNAVAILABLE",
];
const issueTitles: Record<string, string> = {
  BRIDGE_MISSING: "未连接脚本",
  AUTH_REQUIRED: "需要登录 QOJ",
  CHALLENGE_REQUIRED: "需要完成 QOJ 验证",
  PERMISSION_REQUIRED: "脚本版本过旧",
  RATE_LIMITED: "请求过于频繁",
  USER_NOT_FOUND: "用户不存在",
  PARSE_ERROR: "主页数据异常",
  TIMEOUT: "请求超时",
  NETWORK_ERROR: "网络错误",
  STORAGE_ERROR: "本地保存失败",
  LOCK_UNAVAILABLE: "浏览器不支持",
};
const troubleshooting = troubleshootingCodes.map((code) => ({
  code,
  title: issueTitles[code] ?? code,
  detail: qojIssueLabels[code] ?? "",
}));

const scriptStatus = computed(() => {
  if (!sync.modeLoaded) return { tone: "pending", text: "正在读取设置…" };
  if (sync.checking) return { tone: "pending", text: "正在检测脚本…" };
  if (!sync.connected) return { tone: "off", text: "未检测到脚本" };
  if (sync.updateRequired) return { tone: "warn", text: `脚本 ${sync.installedVersion} 版本过旧，需要更新` };
  if (sync.updateAvailable) return { tone: "warn", text: `脚本有更新：${sync.installedVersion} → ${sync.latestVersion}` };
  return { tone: "ok", text: `脚本已连接${sync.installedVersion ? `（${sync.installedVersion}）` : ""}` };
});

async function enableUserscript() {
  if (enabling.value) return;
  enabling.value = true;
  try { await sync.setUseUserscript(true); } finally { enabling.value = false; }
}

onMounted(() => void sync.check());
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body qoj-help">
        <header class="qoj-help__header">
          <p class="eyebrow">帮助</p>
          <h2>QOJ 做题记录同步</h2>
          <p class="muted">QOJ 没有公开 API，做题记录需要在你自己的浏览器里读取。数据只保存在当前浏览器，本站不需要登录。</p>
        </header>

        <nav class="qoj-help__toc" aria-label="目录">
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" @click.prevent="$router.replace({ hash: `#${section.id}` })">{{ section.label }}</a>
        </nav>

        <section id="overview" class="qoj-help__section">
          <h3>两种同步方式</h3>
          <div class="qoj-help__compare">
            <div class="qoj-help__option" :class="{ 'qoj-help__option--current': sync.modeLoaded && !sync.useUserscript }">
              <h4>手动导入 <span v-if="sync.modeLoaded && !sync.useUserscript" class="qoj-help__current">当前</span></h4>
              <p>复制一段脚本，在 QOJ 页面的控制台运行，把结果粘贴回来。无需安装任何东西。</p>
            </div>
            <div class="qoj-help__option" :class="{ 'qoj-help__option--current': sync.useUserscript }">
              <h4>油猴脚本 <span v-if="sync.useUserscript" class="qoj-help__current">当前</span></h4>
              <p>安装一次用户脚本后，在成员页点“同步 QOJ”即可，也可以开启定时自动同步。</p>
            </div>
          </div>
          <p class="muted tiny">切换方式不会清除已有的做题记录。两种方式都需要你已在 QOJ 登录。</p>
        </section>

        <section id="manual" class="qoj-help__section">
          <h3>手动导入</h3>
          <ol class="qoj-help__steps">
            <li>在 <RouterLink to="/members">成员页</RouterLink> 点击“同步 QOJ”（或成员详情里 QOJ 账号的“手动导入”），打开导入弹窗。</li>
            <li>点击“复制脚本”，再点“打开 QOJ”，确认已在 QOJ 登录。</li>
            <li>在 QOJ 页面按 <kbd>F12</kbd>（macOS 为 <kbd>⌥</kbd><kbd>⌘</kbd><kbd>I</kbd>）打开开发者工具，切到 Console，粘贴并回车运行。</li>
            <li>脚本会把结果复制到剪贴板；浏览器不允许时会改为下载 JSON 文件。</li>
            <li>回到本站弹窗，粘贴结果或选择 JSON 文件，点击“导入记录”。</li>
          </ol>
          <p class="muted tiny">控制台首次粘贴时，Chrome 可能要求先输入 <code>allow pasting</code>。导出的 JSON 只对生成脚本时的账号有效；增删账号后请重新复制脚本。</p>
        </section>

        <section id="userscript" class="qoj-help__section">
          <h3>油猴脚本</h3>
          <div class="qoj-help__status" :class="`qoj-help__status--${scriptStatus.tone}`" role="status">
            <span class="qoj-help__dot" aria-hidden="true"></span>
            <span>{{ scriptStatus.text }}</span>
            <button type="button" class="button button--ghost qoj-help__recheck" :disabled="sync.checking" @click="sync.check()">重新检测</button>
          </div>
          <ol class="qoj-help__steps">
            <li>
              安装浏览器扩展 <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">Tampermonkey ↗</a>，并允许它运行用户脚本（Chrome 需在扩展详情中开启“允许用户脚本”）。
            </li>
            <li>
              安装 QOJ 同步脚本，安装后刷新本站。
              <div class="actions">
                <a class="button" :href="sync.userscriptUrl" target="_blank" rel="noopener">{{ sync.updateAvailable || sync.updateRequired ? "更新同步脚本" : "安装同步脚本" }}</a>
              </div>
            </li>
            <li>
              启用“使用 QOJ 油猴脚本”。
              <div class="actions">
                <button v-if="!sync.useUserscript" type="button" class="button button--ghost" :disabled="!sync.modeLoaded || enabling" @click="enableUserscript">{{ enabling ? "启用中…" : "在此启用" }}</button>
                <span v-else class="muted tiny">已启用。可在 <RouterLink to="/manage">管理页</RouterLink> 关闭。</span>
              </div>
            </li>
            <li>在 QOJ 登录后，回到 <RouterLink to="/members">成员页</RouterLink> 点击“同步 QOJ”。添加 QOJ 成员时也会自动使用脚本。</li>
          </ol>
          <p class="muted tiny">脚本更新由本站检测并提示，需要你点击安装；更新后请刷新页面。脚本未连接时仍可用手动导入。</p>
        </section>

        <section id="auto-sync" class="qoj-help__section">
          <h3>自动同步</h3>
          <ul class="qoj-help__list">
            <li>在 <RouterLink to="/manage">管理页</RouterLink> 开启“自动同步”，会同时更新 CF 与 QOJ，并自动启用油猴脚本模式。</li>
            <li>只在本站页面可见时运行；30 分钟内成功同步过的账号不会重复请求。</li>
            <li>失败会逐步延后重试（最长 30 分钟）；需要登录、验证或数据异常时暂停，等你处理后手动重试。</li>
            <li>你手动触发的同步失败后不会被自动重试。</li>
            <li>同一浏览器的多个标签页会自动协调，不会重复请求。</li>
          </ul>
        </section>

        <section id="troubleshooting" class="qoj-help__section">
          <h3>常见问题</h3>
          <p class="muted tiny">同步失败时不会清空上次成功的记录。</p>
          <dl class="qoj-help__faq">
            <template v-for="item in troubleshooting" :key="item.code">
              <dt>{{ item.title }} <code>{{ item.code }}</code></dt>
              <dd>{{ item.detail }}</dd>
            </template>
          </dl>
        </section>

        <section id="privacy" class="qoj-help__section">
          <h3>权限与隐私</h3>
          <ul class="qoj-help__list">
            <li>脚本只读取 QOJ 用户主页上的通过／尝试题目，不提交代码，不修改任何 QOJ 数据。</li>
            <li>脚本只响应本站页面的请求，只访问固定的 QOJ 个人主页地址；不读取或导出 Cookie。</li>
            <li>请求使用你自己浏览器里的 QOJ 登录状态；本站没有服务器，记录只写入当前浏览器。</li>
            <li>不同浏览器之间不会同步，需要时请在管理页导出备份。</li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.qoj-help { display: grid; gap: 8px; }
.qoj-help__header { display: grid; gap: 6px; }
.qoj-help__header h2 { font-size: 1.6rem; }
.qoj-help__toc { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 12px 0 4px; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
.qoj-help__toc a { color: var(--brand-strong); padding: 4px 0; }
.qoj-help__toc a:hover { text-decoration: underline; text-underline-offset: 3px; }
.qoj-help__section { padding: 22px 0 6px; border-bottom: 1px solid var(--line); scroll-margin-top: 80px; }
.qoj-help__section:last-child { border-bottom: 0; }
.qoj-help__section h3 { margin-bottom: 12px; font-size: 1.15rem; }
.qoj-help__section p { margin: 8px 0; line-height: 1.7; }
.qoj-help__section a:not(.button) { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.qoj-help__compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.qoj-help__option { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.66); }
.qoj-help__option--current { border-color: rgba(15, 118, 110, 0.4); }
.qoj-help__option h4 { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
.qoj-help__option p { margin: 0; color: var(--ink-soft); font-size: 0.92rem; }
.qoj-help__current { padding: 1px 8px; border-radius: 999px; background: rgba(15, 118, 110, 0.12); color: var(--brand-strong); font-size: 0.75rem; font-weight: 700; }
.qoj-help__steps, .qoj-help__list { margin: 0; padding-left: 1.4em; display: grid; gap: 10px; line-height: 1.7; }
.qoj-help__steps .actions { margin-top: 8px; }
.qoj-help__status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 14px; border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.66); border: 1px solid var(--line); font-size: 0.92rem; }
.qoj-help__recheck { margin-left: auto; padding: 6px 12px; font-size: 0.85rem; }
.qoj-help__dot { width: 8px; height: 8px; border-radius: 50%; background: #aebcbe; }
.qoj-help__status--ok .qoj-help__dot { background: #259765; }
.qoj-help__status--warn .qoj-help__dot { background: #d68a24; }
.qoj-help__status--pending .qoj-help__dot { background: #b6c8c7; }
.qoj-help__faq { display: grid; grid-template-columns: minmax(150px, 220px) 1fr; gap: 10px 20px; margin: 12px 0 0; }
.qoj-help__faq dt { font-weight: 600; }
.qoj-help__faq dt code { display: block; margin-top: 2px; color: var(--ink-soft); font-size: 0.72rem; font-weight: 400; }
.qoj-help__faq dd { margin: 0; color: var(--ink-soft); line-height: 1.7; }
kbd, code { padding: 1px 5px; border: 1px solid var(--line); border-radius: 4px; background: rgba(255, 255, 255, 0.7); font-family: ui-monospace, monospace; font-size: 0.85em; }
.qoj-help__faq dt code { border: 0; padding: 0; background: none; }
@media (max-width: 640px) {
  .qoj-help__faq { grid-template-columns: 1fr; gap: 4px; }
  .qoj-help__faq dd { margin-bottom: 10px; }
}
</style>
