# 账号与权限

TakeBoard 0.1.x 的身份系统面向个人创作者和可信制作团队：身份验证、会话和项目授权全部由服务端执行，前端隐藏按钮只改善体验，不承担安全判断。

## 首次启用与升级

`TAKEBOARD_AUTH_MODE=required` 是正式运行的默认值。首次访问会要求创建一位管理员；如果数据目录中已经有旧版项目，初始化事务会把这些项目授予该管理员 `Owner` 权限，项目文件不会搬迁或改写。

实例级身份数据默认位于项目根目录内的 `.system/auth.db`，包含账号、会话摘要、项目成员关系、登录失败记录和安全审计。项目导出包不包含账号或成员信息，导入者自动成为导入副本的 Owner。

## 权限模型

| 范围 | 角色 | 能力 |
| --- | --- | --- |
| 实例 | Admin | 管理账号、启动 ComfyUI、导入/绑定/归档全局工作流，并可恢复实例内项目 |
| 实例 | Member | 创建和导入自己的项目，只查看被授予权限的项目 |
| 项目 | Owner | 编辑、生成、导出、删除/恢复项目和管理成员 |
| 项目 | Editor | 编辑画布、素材、镜头和执行生成；不能删除项目或管理成员 |
| 项目 | Viewer | 只读查看项目、素材和运行结果 |

实例管理员拥有故障恢复所需的项目管理能力。至少保留一位可用实例管理员和一位项目 Owner；服务端会拒绝破坏这两个不变量的操作。

## 密码与会话

- 密码长度为 12–256 个字符，支持空格和 Unicode，不要求机械的字符组合；推荐 15 个字符以上的长口令。
- 密码使用带独立随机盐的 scrypt 保存，参数为 `N=2^15, r=8, p=3`，属于 OWASP 推荐的等价最低配置之一。
- 浏览器只持有 256-bit 随机会话令牌；数据库只保存 SHA-256 摘要。会话最长 7 天，空闲 24 小时失效。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`；HTTPS 部署必须设置 `TAKEBOARD_SECURE_COOKIES=1`。
- 修改密码需要再次输入当前密码，并自动撤销其他设备；管理员停用账号会撤销其所有会话。
- 15 分钟内连续失败会触发登录限速。服务不会在错误信息中透露邮箱是否存在。

## 备份与恢复

整机备份必须同时覆盖项目目录和 `.system/auth.db`。只恢复项目包时，项目会成为导入者拥有的新本地副本。若丢失所有管理员密码，目前没有邮件找回流程；请从受保护的完整备份恢复身份数据库。不要手工编辑 SQLite 表。

## 公网部署检查

1. 使用 HTTPS 反向代理，并让 TakeBoard/ComfyUI 上游仅在受保护网络中监听。
2. 同时配置 `TAKEBOARD_AUTH_MODE=required`、`TAKEBOARD_ALLOW_NON_LOOPBACK=1`、精确的 `TAKEBOARD_ALLOWED_HOSTS`、`TAKEBOARD_ALLOWED_ORIGINS` 和 `TAKEBOARD_SECURE_COOKIES=1`。
3. 不要公开 ComfyUI `8188`；第三方自定义节点等同于主机上的任意 Python 代码。
4. 定期备份身份数据库和项目目录，并在升级前验证恢复流程。
5. 对非可信公众或合规场景，等待或补充 MFA、SSO、邮件恢复、组织租户、配额和集中式安全监控。

设计基线参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)。
