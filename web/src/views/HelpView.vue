<script setup lang="ts">
import { RouterLink } from "vue-router";

const sections = [
  { id: "about", label: "这是什么" },
  { id: "start", label: "快速开始" },
  { id: "teammates", label: "看队友写了啥" },
  { id: "vp", label: "找没 VP 过的场次" },
  { id: "practice", label: "自己补题" },
  { id: "results", label: "看看打得如何" },
  { id: "spoilers", label: "剧透" },
  { id: "data", label: "数据与同步" },
  { id: "sources", label: "数据来源" },
  { id: "faq", label: "常见问题" },
];

const xcpcRatingProblems = "https://hei-maom.github.io/xcpcrating/#/problems";
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body help-doc">
        <header class="help-doc__header">
          <p class="eyebrow">帮助</p>
          <h2>使用说明</h2>
          <p class="muted">XCPC Tracker 是一个 XCPC 做题情况追踪工具：围绕经审核的 ICPC / CCPC / 省赛目录，让整支队伍看到彼此在每场比赛、每道题上的进度。</p>
        </header>

        <nav class="help-doc__toc" aria-label="目录">
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" @click.prevent="$router.replace({ hash: `#${section.id}` })">{{ section.label }}</a>
        </nav>

        <section id="about" class="help-doc__section">
          <h3>这是什么</h3>
          <p>导入队员的 Codeforces / QOJ 做题记录后，可以用来：</p>
          <ul class="help-doc__list">
            <li><strong>看队友写了啥</strong>：每场比赛、每道题谁尝试过、谁通过了。</li>
            <li><strong>找没 VP 过的场次</strong>：列出所选成员都没碰过的比赛，挑下一场整场 VP。</li>
            <li><strong>自己补区域赛题</strong>：在目录里的比赛中补题。</li>
            <li><strong>看看打得如何</strong>：按过题数对照牌线，看队伍落在 Fe / Cu / Ag / Au 哪个区间。</li>
          </ul>
          <p class="muted tiny">目录覆盖区域赛、省赛、邀请赛、总决赛、网络赛、女生赛等 ICPC / CCPC 体系比赛，每场都有经审核的完整题单。</p>
        </section>

        <section id="start" class="help-doc__section">
          <h3>快速开始</h3>
          <ol class="help-doc__steps">
            <li>在 <RouterLink to="/members/new">添加成员</RouterLink> 填写名称，选择 Codeforces 或 QOJ 并填写账号。同一个人的第二个账号，在成员详情里点“添加账号”。</li>
            <li>Codeforces 记录会通过官方 API 直接同步；QOJ 需要在你的浏览器里导出，见 <RouterLink to="/help/qoj">QOJ 同步帮助</RouterLink>。</li>
            <li>回到 <RouterLink to="/contests">比赛</RouterLink>，用成员筛选选出这支队，就能看到每场比赛的覆盖情况。</li>
          </ol>
          <p class="muted tiny">每位队员都需要在自己的浏览器里添加全队账号：数据只保存在当前浏览器，本站没有账号系统，也不做云同步。</p>
        </section>

        <section id="teammates" class="help-doc__section">
          <h3>看队友写了啥</h3>
          <ul class="help-doc__list">
            <li><RouterLink to="/members">成员页</RouterLink> 显示每个人的通过 / 尝试数和上次同步时间；成员详情可以按账号同步、添加或删除账号。</li>
            <li>成员详情里的“查看 TA 的比赛”会打开只选中这名成员的比赛列表。</li>
            <li>比赛详情的热力图以成员为行、题目为列：绿色 ✓ 为通过，黄色 · 为尝试；每行末尾是该成员的通过 / 尝试数，底部“全队”一行是所选成员合并后的结果。</li>
          </ul>
        </section>

        <section id="vp" class="help-doc__section">
          <h3>找没 VP 过的场次</h3>
          <ul class="help-doc__list">
            <li><strong>未做</strong>：所选成员都没有尝试、也没有通过本场任何一道题。只要有人尝试过一道题（即使没通过），这场就不再算未做——有人看过题，它就不是一场干净的 VP 了。</li>
            <li><strong>成员筛选</strong>决定“队伍”是谁。比赛列表和比赛详情共用同一组选择，两边都能修改；选择会保存在网址的 <code>members</code> 参数里，分享或刷新链接都会保留。</li>
            <li>列表模式“全部 / 未做 / 已做”按所选成员筛选；比赛按年份和日期从新到旧排列。</li>
            <li>比赛详情右侧的“来源链接”里，Codeforces Gym / QOJ 卡片打开整场比赛，从那里开始 VP；RankLand / XCPCIO 卡片打开完整榜单。</li>
          </ul>
          <h4>搜索语法</h4>
          <ul class="help-doc__list">
            <li>可以搜标题、别名、标签（年份、地区、赛事类型等）、平台（<code>cf</code>、<code>qoj</code>）。</li>
            <li>空格分隔的多个条件要同时满足；<code>-</code> 表示排除，如 <code>-省赛</code>；<code>|</code> 表示“或”，如 <code>南京|沈阳</code>。</li>
            <li>奖牌区间：<code>fe</code> <code>cu</code> <code>ag</code> <code>au</code>（也可以写 铁 / 铜 / 银 / 金）；<code>?</code> 表示没有牌线。奖牌条件只对处于剧透状态的比赛生效。</li>
            <li>点击卡片上的标签或奖牌徽章，会把它加进搜索条件。</li>
          </ul>
        </section>

        <section id="practice" class="help-doc__section">
          <h3>自己补题</h3>
          <ul class="help-doc__list">
            <li>可以随时在目录里的比赛中补题。补过题的比赛会离开“未做”列表，这是预期行为：想保留 VP 场次的话，优先从已经有人碰过的比赛里挑题。</li>
            <li>想按难度或题型挑题，请用 <a :href="xcpcRatingProblems" target="_blank" rel="noreferrer">XCPC Rating 的题目页 ↗</a>；本站在剧透状态下显示题目标签和 Rating，不另做难度浏览。</li>
            <li>在其他 OJ 上写的题，可以在比赛详情点“进入标记模式”手动补录：点击格子依次切换 未做 → 尝试 → 通过，再点一次清除手动标记；从 CF / QOJ 同步来的通过记录不受影响。</li>
          </ul>
        </section>

        <section id="results" class="help-doc__section">
          <h3>看看打得如何</h3>
          <ul class="help-doc__list">
            <li>队伍成绩只按<strong>过题数</strong>对照牌线，不考虑罚时（本站没有罚时数据）。</li>
            <li>所选成员合计的通过数达到哪条线，就落在哪一档：Au / Ag / Cu；碰过本场但不到铜牌线（包括只有尝试、没有通过）为 Fe；完全没碰过，或这场没有牌线，不显示档位。</li>
            <li>比赛列表的徽章显示每场的区间；搜索 <code>au</code> 等奖牌条件，再配合“已做”模式和场数统计，就能看到各档分别有几场。</li>
            <li>比赛详情的牌线卡片显示当前档位、到下一档还差几题（NEXT +N probs），以及各档的过题数、名次和罚时。</li>
          </ul>
          <h4>牌线从哪来</h4>
          <ul class="help-doc__list">
            <li>优先使用官方公布或核验过的奖牌线。多个组别时取最高组别，邀请赛兼省赛取邀请赛组。</li>
            <li>没有奖牌配置时，可以按正式队伍的 10% / 20% / 30% 估算金银铜，卡片会注明是估算。估算可以在 <RouterLink to="/manage">管理</RouterLink> 里关闭；榜单不完整或组别不明时不估算。</li>
            <li>牌线只用于训练参考，不代表个人真实获奖。</li>
          </ul>
        </section>

        <section id="spoilers" class="help-doc__section">
          <h3>剧透</h3>
          <ul class="help-doc__list">
            <li>所选成员都没碰过的比赛默认<strong>非剧透</strong>，碰过之后默认剧透；切换成员会随之改变默认值，打开详情不会。</li>
            <li>非剧透会隐藏牌线、奖牌区间、题目标签和 Rating，奖牌搜索条件也不匹配这些比赛；做题覆盖和整场练习链接照常可用。</li>
            <li>比赛详情标题旁的开关可以逐场切换，手动设置优先且会保留；<RouterLink to="/manage">管理</RouterLink> 里的“全部剧透”可以批量设置。</li>
          </ul>
        </section>

        <section id="data" class="help-doc__section">
          <h3>数据与同步</h3>
          <ul class="help-doc__list">
            <li><strong>Codeforces</strong>：在浏览器里直接调用官方 API，只能读取公开数据；非公开比赛或私有 Gym 的记录可能缺失。</li>
            <li><strong>QOJ</strong>：默认手动导入，也可以安装油猴脚本自动同步，详见 <RouterLink to="/help/qoj">QOJ 同步帮助</RouterLink>。</li>
            <li><strong>自动同步</strong>：在 <RouterLink to="/manage">管理</RouterLink> 开启后，页面打开时会定期同步 CF 与 QOJ，30 分钟内同步过的账号不会重复请求。</li>
            <li>同步失败不会清空上次成功的记录。</li>
            <li><strong>备份</strong>：管理页可以导出成员、做题记录和剧透设置。导入时“合并”保留现有数据，“覆盖”会先移除现有成员和记录再恢复；取消“包含题目状态”时，覆盖后没有题目状态。不同浏览器之间不会自动同步，换设备时请用备份。</li>
          </ul>
        </section>

        <section id="sources" class="help-doc__section">
          <h3>数据来源</h3>
          <ul class="help-doc__list">
            <li>现场赛终榜来自 <a href="https://github.com/algoux/srk-collection" target="_blank" rel="noreferrer">algoUX / srk-collection ↗</a>（在 <a href="https://rl.algoux.cn/" target="_blank" rel="noreferrer">RankLand ↗</a> 浏览）和 XCPCIO Board；牌线由此审核得出。</li>
            <li>题目标签、Rating 和整场补题链接来自 <a href="https://github.com/Hei-MaoM/xcpcrating" target="_blank" rel="noreferrer">XCPC Rating ↗</a>（Hei-MaoM）。</li>
            <li>完整榜单请到 RankLand / XCPCIO Board 查看，个人选手积分请看 XCPC Rating。本站不根据榜单推断成员的做题状态。</li>
            <li>来源与许可说明见 <a href="https://github.com/mohaoz/xcpc-tracker/blob/main/catalog/README.md" target="_blank" rel="noreferrer">catalog/README ↗</a>。标签来自社区，可能有误。</li>
          </ul>
        </section>

        <section id="faq" class="help-doc__section">
          <h3>常见问题</h3>
          <dl class="help-doc__faq">
            <dt>为什么一场比赛不在“未做”里了？</dt>
            <dd>所选成员中有人尝试或通过过它的某道题。可以在比赛详情的热力图里看到是谁。</dd>
            <dt>为什么牌线、标签看不到？</dt>
            <dd>这场处于非剧透状态。在比赛详情标题旁打开剧透开关即可。</dd>
            <dt>为什么没有档位？</dt>
            <dd>所选成员还没碰过这场，或者这场没有可用的牌线。</dd>
            <dt>换了电脑，数据没了？</dt>
            <dd>数据只在原来的浏览器里。在原浏览器的管理页导出备份，再到新浏览器导入。</dd>
            <dt>某道题明明写过却显示未做？</dt>
            <dd>先在成员页重新同步；如果是在其他 OJ 写的，用比赛详情的标记模式手动补录。</dd>
          </dl>
        </section>
      </div>
    </section>
  </div>
</template>
