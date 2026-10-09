<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { LocalMemberPerson } from "../lib/local-model";
import { useContestListStore } from "../stores/contest-list";

defineProps<{ members: LocalMemberPerson[]; label?: string }>();
const selection = useContestListStore();
const allSelected = computed(() => selection.followAllMembers && selection.knownMemberIds.length > 0);
</script>

<template>
  <div class="field">
    <span class="field-label">{{ label ?? "成员筛选" }}</span>
    <div class="member-filter-picker" role="group" :aria-label="label ?? '成员筛选'">
      <template v-if="members.length">
        <button
          type="button"
          class="member-filter-chip member-filter-chip--action"
          :class="{ 'member-filter-chip--action-active': allSelected, 'member-filter-chip--action-empty': !allSelected }"
          :aria-pressed="allSelected"
          @click="selection.toggleAllMembers()"
        >
          全选
        </button>
        <button
          v-for="member in members"
          :key="member.memberId"
          type="button"
          class="member-filter-chip"
          :class="{ 'member-filter-chip--selected': selection.selectedMemberIds.includes(member.memberId) }"
          :aria-pressed="selection.selectedMemberIds.includes(member.memberId)"
          @click="selection.toggleMember(member.memberId)"
        >
          {{ member.displayName }}
        </button>
      </template>
      <RouterLink v-else to="/members/new" class="member-filter-chip member-filter-chip--hint">去导入成员</RouterLink>
    </div>
    <p v-if="members.length && !selection.selectedMemberIds.length" class="muted tiny member-picker__empty" role="status">
      未选择成员：所有比赛都会显示为未做，也不显示档位。
    </p>
  </div>
</template>
