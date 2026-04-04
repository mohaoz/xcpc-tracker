import { createRouter, createWebHistory } from "vue-router";

import AddMemberView from "./views/AddMemberView.vue";
import ContestDetailView from "./views/ContestDetailView.vue";
import ContestIntakeView from "./views/ContestIntakeView.vue";
import ContestListView from "./views/ContestListView.vue";
import MemberDetailView from "./views/MemberDetailView.vue";
import MemberListView from "./views/MemberListView.vue";

export const router = createRouter({
  history: createWebHistory(),
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
  ],
});
