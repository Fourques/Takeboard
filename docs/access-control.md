# 账号与权限

TakeBoard 0.x 的身份系统面向个人创作者和可信制作团队：身份验证、会话和项目授权全部由服务端执行，前端隐藏按钮只改善体验，不承担安全判断。

## 首次启用与升级

`TAKEBOARD_AUTH_MODE=required` 是正式运行的默认值。首次访问会要求创建一位管理员；如果数据目录中已经有旧版项目，初始化事务会把这些项目授予该管理员 `Owner` 权限，项目文件不会搬迁或改写。

实例级身份数据默认位于项目根目录内的 `.system/auth.db`，包含账号、会话摘要、项目成员关系、登录失败记录和安全审计。项目导出包不包含账号或成员信息，导入者自动成为导入副本的 Owner。

## 权限模型

| 范围 | 角色 | 能力 |
| --- | --- | --- |
| 实例 | Admin | 管理账号、启动 ComfyUI、导入/导出/绑定/归档全局工作流，并可恢复实例内项目 |
| 实例 | Member | 创建和导入自己的项目，只查看被授予权限的项目 |
| 项目 | Owner | 编辑、生成、导出、删除项目和管理成员 |
| 项目 | Editor | 编辑画布、素材、镜头和执行生成；不能删除项目或管理成员 |
| 项目 | Viewer | 只读查看项目、素材和运行结果 |

实例管理员拥有故障恢复所需的全局项目访问和回收站恢复能力，但这种 `ADMIN ACCESS` 不会伪装成项目成员关系；项目列表会分别返回实际成员角色和访问来源。项目导出只允许 Owner 或实例管理员执行，Editor 不会因能够编辑而自动获得完整数据副本。至少保留一位可用实例管理员和一位项目 Owner；服务端会拒绝破坏这两个不变量的操作。

Viewer 的只读不是单纯隐藏按钮。画布、资产库、节点检查器、连线菜单和操作历史会共同进入只读状态；服务端仍会独立拒绝创建、修改、生成、导出、删除和回收站操作。Editor 可以在首页重命名项目并完成制作，但不能导出、删除或管理成员。

项目 Owner 删除的项目会进入回收区，并可由该 Owner 或实例 Admin 恢复；其他成员查询回收区时只会得到自己有 Owner 权限的条目，不会看到无权项目的名称。

同一项目在多个设备打开时，页面会通过 revision 条件请求同步其他设备的保存。正在输入时不会突然替换草稿，而是在顶部提示新版本；旧 revision 的写入会在服务端锁内被拒绝，页面载入最新版本后要求用户重新确认操作。

## 密码与会话

- 密码长度为 12–256 个字符，支持空格和 Unicode，不要求机械的字符组合；推荐 15 个字符以上的长口令。
- 密码使用带独立随机盐的 scrypt 保存，参数为 `N=2^15, r=8, p=3`，属于 OWASP 推荐的等价最低配置之一。
- 浏览器只持有 256-bit 随机会话令牌；数据库只保存 SHA-256 摘要。会话最长 7 天，空闲 24 小时失效。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`；HTTPS 部署必须设置 `TAKEBOARD_SECURE_COOKIES=1`。
- 修改密码需要再次输入当前密码，并自动撤销其他设备；管理员停用账号会撤销其所有会话。
- 15 分钟内连续失败会触发登录限速。服务不会在错误信息中透露邮箱是否存在。
- 管理员通过最长 7 天有效的一次性链接邀请成员；令牌只在创建时显示，数据库只保存摘要，接受或撤销后不能重放。
- 每个账号可以生成 10 个高熵离线恢复码。恢复码只显示一次、一次性消费；轮换会立即作废旧码，成功恢复会撤销全部已登录设备。

## 备份与恢复

管理员可以在“备份与恢复”创建 `.takeboard-instance.tgz`。服务会锁定项目写入、拒绝仍有生成任务的项目，为每个项目建立可独立验签的项目包，并通过 SQLite 一致性快照保存身份数据库；外层清单再次记录大小和 SHA-256，默认保留最近 5 份。

设置 `TAKEBOARD_BACKUP_DESTINATION` 后，服务还会按计划将完整实例快照原子复制到数据目录之外，核对源/目标 SHA-256，并按每日/每周/每月窗口清理自身创建的旧恢复点。首次外部副本及之后每个演练周期会在备份卷上做一次真实隔离恢复：身份库必须通过 `quick_check`，全部项目必须能打开且数量一致。自动副本失败、恢复演练失败和人工操作都会进入安全活动；运行诊断不会把目标绝对路径写进可下载报告。

在线恢复会先在隔离目录校验外层清单、身份数据库 `quick_check` 和每个项目包，只导入当前缺失的项目，不覆盖当前账号与同 ID 项目。完整灾难恢复需要先停止服务：

```bash
npm run easy:stop
npm run easy:restore -- /path/to/backup.takeboard-instance.tgz --confirm
npm run easy
```

离线恢复会替换身份数据库和备份中同 ID 的项目，但把恢复前数据保留在 `.system/offline-restore-rollbacks/<id>/`。恢复完成后会撤销备份中的全部旧会话和登录失败记录，所有设备必须重新登录，避免备份时的旧 Cookie 重新获得访问权。实例备份包含密码摘要和私有素材，应加密保存并与恢复码分开存放。不要手工编辑 SQLite 表。

## 公网部署检查

1. 使用 HTTPS 反向代理，并让 TakeBoard/ComfyUI 上游仅在受保护网络中监听。
2. 同时配置 `TAKEBOARD_AUTH_MODE=required`、`TAKEBOARD_ALLOW_NON_LOOPBACK=1`、精确的 `TAKEBOARD_ALLOWED_HOSTS`、`TAKEBOARD_ALLOWED_ORIGINS` 和 `TAKEBOARD_SECURE_COOKIES=1`。
3. 不要公开 ComfyUI `8188`；第三方自定义节点等同于主机上的任意 Python 代码。
4. 定期备份身份数据库和项目目录，并在升级前验证恢复流程。
5. 对非可信公众或合规场景，等待或补充 MFA、SSO、邮件恢复、组织租户、配额和集中式安全监控。

设计基线参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)。
