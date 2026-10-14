---
name: commit-message
description: 根据当前 Git 改动生成规范的提交信息（Conventional Commits），并可按用户确认后提交。当用户说"帮我写 commit""提交这些改动""生成提交信息"时使用。
license: MIT
version: 1.0.0
---

# 生成提交信息

## 步骤

1. 用 `git_status` 查看当前分支与改动文件。
2. 用 `git_diff` 查看具体改动内容；若用户说"已暂存的改动"，用 `git_diff` 并设置 `staged: true`。
3. 阅读改动，归纳出**一个**主要目的与若干次要改动。
4. 生成提交信息，格式遵循 Conventional Commits：

```
<type>(<scope>): <简短描述，不超过 72 字符>

<正文：说明为什么这样改，每行不超过 72 字符>

<footer：如有破坏性变更写 BREAKING CHANGE: ...>
```

`type` 取值：`feat` 新功能 / `fix` 修 bug / `refactor` 重构 / `docs` 文档 / `test` 测试 / `chore` 杂项 / `perf` 性能 / `style` 格式。

5. 把生成的提交信息用代码块展示给用户，**先不要提交**，询问是否执行。
6. 用户确认后，用 `run_command` 执行提交。注意：提交信息的引号在 PowerShell 中需转义，建议写成临时文件再 `git commit -F`：

```powershell
Set-Content -Path .git/COMMIT_MSG_TMP -Value "<提交信息>" -Encoding utf8
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

## 规则

- 绝不使用 `git commit --amend` 或改写已推送的历史，除非用户明确要求。
- 绝不使用 `--no-verify`。
- 改动内容包含密钥、密码、`.env` 等敏感文件时，先提醒用户再继续。
- 描述用祈使句，说明"做了什么"，不要写"我修改了…"。
