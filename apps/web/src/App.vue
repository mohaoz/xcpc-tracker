<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const navItems = [
  { to: "/contests", label: "Contests", activeWhen: (path: string) => path === "/contests" || path.startsWith("/contests/") && !path.startsWith("/contests/intake") },
  { to: "/members", label: "Members", activeWhen: (path: string) => path.startsWith("/members") },
  { to: "/manage", label: "Manage", activeWhen: (path: string) => path.startsWith("/manage") || path.startsWith("/contests/intake") || path === "/contests/new" },
];
</script>

<template>
  <div class="shell">
    <header class="shell__hero">
      <div class="shell__hero-bg"></div>
      <div class="shell__hero-inner">
        <div>
          <p class="eyebrow">Static XCPC Tracker</p>
          <h1>XCPC Tracker</h1>
          <p class="hero-copy">
            整理比赛目录、同步成员状态，并在本地直接判断哪些题还值得做。
          </p>
        </div>
        <nav class="shell__nav" aria-label="Primary">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-pill"
            :class="{ 'nav-pill--active': item.activeWhen(route.path) }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="shell__main">
      <RouterView />
    </main>
  </div>
</template>
