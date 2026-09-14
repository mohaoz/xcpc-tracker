# Codeforces fixture 位置

本目录是旧 provider 布局的保留入口，目前没有 API／HTML／PDF fixture，不代表项目支持比赛运行时同步或题面抓取。

当前构建期题单输入在 [fixtures/imports/codeforces](../../imports/codeforces/)，成员状态导入的确定性用例见 [validate-vp-state.mjs](../../../scripts/validate-vp-state.mjs)。新增用例放到实际消费它的验证目录，保留原始响应、预期映射、尝试／通过区别和失败保留旧状态的证据；无需创建未被测试使用的占位目录。
