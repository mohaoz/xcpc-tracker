import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";

import AddMemberView from "./views/AddMemberView.vue";
import ContestDetailView from "./views/ContestDetailView.vue";
import ContestIntakeView from "./views/ContestIntakeView.vue";
import ContestListView from "./views/ContestListView.vue";
import MemberDetailView from "./views/MemberDetailView.vue";
import MemberListView from "./views/MemberListView.vue";
import HelpView from "./views/HelpView.vue";
import QojHelpView from "./views/QojHelpView.vue";

export const router = createRouter({
  history: import.meta.env.MODE === "github-pages"
    ? createWebHashHistory(import.meta.env.BASE_URL)
    : createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      redirect: "/contests",
    },
    {
      path: "/contests",
      name: "contests",
      component: ContestListView,
    },
    {
      path: "/manage",
      name: "manage",
      component: ContestIntakeView,
    },
    {
      path: "/contests/intake",
      redirect: "/manage",
    },
    {
      path: "/contests/:contestId",
      name: "contest-detail",
      component: ContestDetailView,
      props: true,
    },
    {
      path: "/members",
      name: "members",
      component: MemberListView,
    },
    {
      path: "/members/:memberId",
      name: "member-detail",
      component: MemberDetailView,
      props: true,
    },
    {
      path: "/members/new",
      name: "member-add",
      component: AddMemberView,
    },
    {
      path: "/help",
      name: "help",
      component: HelpView,
    },
    {
      path: "/help/qoj",
      name: "qoj-help",
      component: QojHelpView,
    },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 80 };
    return { top: 0 };
  },
});
