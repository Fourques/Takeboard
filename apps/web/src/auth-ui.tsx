import type {
  Account,
  AccountSession,
  AuthAuditEntry,
  InstanceRole,
  ProjectMember,
  ProjectRole,
} from "@takeboard/contracts";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authApi, setApiCsrfToken } from "./api";

type CenterContext = {
  projectKey?: string | undefined;
  projectTitle?: string | undefined;
  projectRole?: ProjectRole | undefined;
};
type AuthContextValue = {
  user: Account | null;
  enabled: boolean;
  openAccount: (context?: CenterContext) => void;
  refreshUser: (user: Account) => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  enabled: false,
  openAccount: () => undefined,
  refreshUser: () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

function AuthMark() {
  return (
    <div className="auth-brand">
      <span className="brand-mark">T</span>
      <div>
        <strong>TakeBoard</strong>
        <span>PRIVATE FILMMAKING WORKSPACE</span>
      </div>
    </div>
  );
}

function AuthScreen({
  configured,
  onAuthenticated,
}: {
  configured: boolean;
  onAuthenticated: (user: Account, csrfToken: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!configured && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = configured
        ? await authApi.login(email, password)
        : await authApi.bootstrap({ name, email, password });
      onAuthenticated(result.user, result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法登录 TakeBoard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-atmosphere" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <AuthMark />
        <div className="auth-card-copy">
          <span className="auth-eyebrow">{configured ? "WELCOME BACK" : "FIRST RUN"}</span>
          <h1 id="auth-title">{configured ? "回到你的创作空间" : "建立你的私人工作室"}</h1>
          <p>
            {configured
              ? "项目、素材与生成任务会按照你的权限安全呈现。"
              : "创建首位管理员。现有本地项目将自动归属于这个账号，文件位置保持不变。"}
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {!configured ? (
            <label>
              <span>你的名字</span>
              <input
                autoComplete="name"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：Duan"
                required
                value={name}
              />
            </label>
          ) : null}
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>{configured ? "密码" : "管理员密码"}</span>
            <input
              autoComplete={configured ? "current-password" : "new-password"}
              maxLength={256}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={configured ? "输入密码" : "至少 12 个字符，推荐使用长口令"}
              required
              type="password"
              value={password}
            />
          </label>
          {!configured ? (
            <label>
              <span>再次输入密码</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={12}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                type="password"
                value={confirmation}
              />
            </label>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "正在验证…" : configured ? "进入 TakeBoard" : "创建工作室"}
          </button>
        </form>
        <footer>
          <span>
            <i /> 服务端会话
          </span>
          <span>HttpOnly · SameSite</span>
        </footer>
      </section>
    </main>
  );
}

function ChangePassword({
  user,
  onChanged,
}: {
  user: Account;
  onChanged: (user: Account) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) return setError("两次输入的新密码不一致");
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      const next = { ...user, mustChangePassword: false };
      onChanged(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法修改密码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label>
        <span>当前密码</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        <span>新密码</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <label>
        <span>确认新密码</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <small>修改后会自动退出其他设备，当前设备继续保持登录。</small>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="auth-success" role="status">
          密码已更新，其他会话已撤销。
        </p>
      ) : null}
      <button className="auth-primary" disabled={busy} type="submit">
        {busy ? "正在更新…" : "更新密码"}
      </button>
    </form>
  );
}

function SessionsPanel() {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void authApi
      .sessions()
      .then((result) => setSessions(result.sessions))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取会话"));
  }, []);
  return (
    <div className="account-list">
      {error ? <p className="auth-error">{error}</p> : null}
      {sessions.map((session) => (
        <article key={session.id}>
          <div>
            <strong>
              {session.current
                ? "当前设备"
                : session.userAgent?.includes("Mac")
                  ? "Mac 浏览器"
                  : "其他设备"}
            </strong>
            <span>{new Date(session.lastSeenAt).toLocaleString("zh-CN")} 最近活动</span>
            <small>{session.ipAddress ?? "本地连接"}</small>
          </div>
          <button
            type="button"
            onClick={() =>
              void authApi.revokeSession(session.id).then((result) => {
                if (result.current) window.dispatchEvent(new Event("takeboard:auth-required"));
                else setSessions((current) => current.filter((item) => item.id !== session.id));
              })
            }
          >
            退出
          </button>
        </article>
      ))}
    </div>
  );
}

function TeamPanel({ currentUser }: { currentUser: Account }) {
  const [users, setUsers] = useState<Account[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    email: string;
    password: string;
    instanceRole: InstanceRole;
  }>({ name: "", email: "", password: "", instanceRole: "member" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => authApi.users().then((result) => setUsers(result.users)), []);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取团队"));
  }, [load]);
  return (
    <div className="team-panel">
      <div className="account-list">
        {users.map((user) => (
          <article key={user.id} className={user.status === "disabled" ? "muted" : ""}>
            <span className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>
                {user.name}
                {user.id === currentUser.id ? " · 你" : ""}
              </strong>
              <span>{user.email}</span>
              <small>
                {user.instanceRole === "admin" ? "管理员" : "团队成员"} ·{" "}
                {user.status === "active" ? "可登录" : "已停用"}
              </small>
            </div>
            {user.id !== currentUser.id ? (
              <button
                type="button"
                onClick={() =>
                  void authApi
                    .updateUser(user.id, {
                      status: user.status === "active" ? "disabled" : "active",
                    })
                    .then(load)
                    .catch((cause) => setError(cause instanceof Error ? cause.message : "更新失败"))
                }
              >
                {user.status === "active" ? "停用" : "启用"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {creating ? (
        <form
          className="account-form compact"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void authApi
              .createUser(draft)
              .then(() => {
                setCreating(false);
                setDraft({ name: "", email: "", password: "", instanceRole: "member" });
                return load();
              })
              .catch((cause) => setError(cause instanceof Error ? cause.message : "创建失败"));
          }}
        >
          <label>
            <span>姓名</span>
            <input
              required
              value={draft.name}
              onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
            />
          </label>
          <label>
            <span>邮箱</span>
            <input
              type="email"
              required
              value={draft.email}
              onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))}
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              type="password"
              minLength={12}
              required
              value={draft.password}
              onChange={(event) =>
                setDraft((value) => ({ ...value, password: event.target.value }))
              }
            />
          </label>
          <label>
            <span>实例角色</span>
            <select
              value={draft.instanceRole}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  instanceRole: event.target.value as InstanceRole,
                }))
              }
            >
              <option value="member">团队成员</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <small>成员首次登录后必须更换初始密码。请通过可信渠道单独传递。</small>
          <div className="account-form-actions">
            <button type="button" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="auth-primary" type="submit">
              创建成员
            </button>
          </div>
        </form>
      ) : (
        <button className="account-secondary" type="button" onClick={() => setCreating(true)}>
          ＋ 添加团队成员
        </button>
      )}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ProjectAccessPanel({
  projectKey,
  currentUser,
}: {
  projectKey: string;
  currentUser: Account;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [directory, setDirectory] = useState<Account[]>([]);
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      authApi.projectMembers(projectKey).then((result) => {
        setMembers(result.members);
        setDirectory(result.directory);
      }),
    [projectKey],
  );
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "无法读取项目成员"),
    );
  }, [load]);
  const available = directory.filter(
    (user) => !members.some((member) => member.user.id === user.id),
  );
  return (
    <div className="team-panel">
      <div className="role-legend">
        <span>
          <b>Owner</b> 管理与删除
        </span>
        <span>
          <b>Editor</b> 创作与生成
        </span>
        <span>
          <b>Viewer</b> 只读查看
        </span>
      </div>
      <div className="account-list">
        {members.map((member) => (
          <article key={member.user.id}>
            <span className="account-avatar">{member.user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>
                {member.user.name}
                {member.user.id === currentUser.id ? " · 你" : ""}
              </strong>
              <span>{member.user.email}</span>
            </div>
            <select
              aria-label={`设置 ${member.user.name} 的项目角色`}
              value={member.role}
              onChange={(event) =>
                void authApi
                  .setProjectMember(projectKey, member.user.id, event.target.value as ProjectRole)
                  .then((result) => setMembers(result.members))
                  .catch((cause) => setError(cause instanceof Error ? cause.message : "更新失败"))
              }
            >
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            {member.user.id !== currentUser.id ? (
              <button
                type="button"
                onClick={() =>
                  void authApi
                    .removeProjectMember(projectKey, member.user.id)
                    .then((result) => setMembers(result.members))
                    .catch((cause) => setError(cause instanceof Error ? cause.message : "移除失败"))
                }
              >
                移除
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {available.length ? (
        <div className="member-add-row">
          <select value={candidate} onChange={(event) => setCandidate(event.target.value)}>
            <option value="">选择团队成员…</option>
            {available.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.email}
              </option>
            ))}
          </select>
          <button
            className="account-secondary"
            disabled={!candidate}
            type="button"
            onClick={() =>
              void authApi
                .setProjectMember(projectKey, candidate, "editor")
                .then((result) => {
                  setMembers(result.members);
                  setCandidate("");
                })
                .catch((cause) => setError(cause instanceof Error ? cause.message : "添加失败"))
            }
          >
            添加为 Editor
          </button>
        </div>
      ) : (
        <small>所有可用团队成员都已加入这个项目。</small>
      )}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const auditActionLabels: Record<string, string> = {
  "auth.bootstrap": "完成工作室初始化",
  "auth.login": "登录成功",
  "auth.login_failed": "登录失败",
  "auth.logout": "退出登录",
  "auth.password_changed": "修改密码",
  "auth.csrf_rejected": "拦截无效安全令牌",
  "authorization.denied": "拒绝越权访问",
  "user.created": "创建团队账号",
  "user.updated": "更新团队账号",
  "project.member_set": "更新项目成员",
  "project.member_removed": "移除项目成员",
};

function AuditPanel() {
  const [entries, setEntries] = useState<AuthAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void authApi
      .audit()
      .then((result) => setEntries(result.entries))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取安全活动"));
  }, []);
  return (
    <div className="audit-list">
      {entries.map((entry) => (
        <article key={entry.sequence}>
          <i
            className={
              entry.action.includes("denied") ||
              entry.action.includes("failed") ||
              entry.action.includes("rejected")
                ? "warning"
                : ""
            }
          />
          <div>
            <strong>{auditActionLabels[entry.action] ?? entry.action}</strong>
            <span>{entry.actor ? `${entry.actor.name} · ${entry.actor.email}` : "系统"}</span>
            <small>
              {new Date(entry.createdAt).toLocaleString("zh-CN")} · {entry.ipAddress ?? "本地"}
            </small>
          </div>
        </article>
      ))}
      {!error && entries.length === 0 ? <p>还没有安全活动。</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}
    </div>
  );
}

function AccountCenter({
  user,
  context,
  onClose,
  onLogout,
  onUser,
}: {
  user: Account;
  context: CenterContext;
  onClose: () => void;
  onLogout: () => void;
  onUser: (user: Account) => void;
}) {
  const hasProjectAccess = Boolean(
    context.projectKey && (context.projectRole === "owner" || user.instanceRole === "admin"),
  );
  const tabs = [
    "profile",
    "security",
    ...(user.instanceRole === "admin" ? ["team", "activity"] : []),
    ...(hasProjectAccess ? ["project"] : []),
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(hasProjectAccess ? "project" : "profile");
  const [name, setName] = useState(user.name);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="modal-backdrop account-backdrop">
      <button
        className="account-dismiss-layer"
        type="button"
        aria-label="关闭账号设置"
        onClick={onClose}
      />
      <section
        className="account-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <header>
          <div>
            <span className="account-avatar large">{user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <small>TAKEBOARD ACCOUNT</small>
              <h2 id="account-title">{context.projectTitle ?? user.name}</h2>
              <p>{context.projectTitle ? "项目访问与工作室账号" : user.email}</p>
            </div>
          </div>
          <button type="button" aria-label="关闭账号设置" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="account-layout">
          <nav aria-label="账号设置">
            <button
              className={tab === "profile" ? "active" : ""}
              type="button"
              onClick={() => setTab("profile")}
            >
              个人资料
            </button>
            <button
              className={tab === "security" ? "active" : ""}
              type="button"
              onClick={() => setTab("security")}
            >
              密码与设备
            </button>
            {user.instanceRole === "admin" ? (
              <>
                <button
                  className={tab === "team" ? "active" : ""}
                  type="button"
                  onClick={() => setTab("team")}
                >
                  团队账号
                </button>
                <button
                  className={tab === "activity" ? "active" : ""}
                  type="button"
                  onClick={() => setTab("activity")}
                >
                  安全活动
                </button>
              </>
            ) : null}
            {hasProjectAccess ? (
              <button
                className={tab === "project" ? "active" : ""}
                type="button"
                onClick={() => setTab("project")}
              >
                项目成员
              </button>
            ) : null}
            <span />
            <button className="danger" type="button" onClick={onLogout}>
              退出登录
            </button>
          </nav>
          <div className="account-content">
            {tab === "profile" ? (
              <>
                <div className="account-section-heading">
                  <span>PROFILE</span>
                  <h3>个人资料</h3>
                  <p>这里的名字会用于成员列表和操作记录。</p>
                </div>
                <form
                  className="account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void authApi.updateProfile(name).then((result) => {
                      onUser(result.user);
                      setMessage("资料已保存");
                    });
                  }}
                >
                  <label>
                    <span>显示名称</span>
                    <input
                      maxLength={120}
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>登录邮箱</span>
                    <input disabled value={user.email} />
                  </label>
                  <button className="auth-primary" type="submit">
                    保存资料
                  </button>
                  {message ? <p className="auth-success">{message}</p> : null}
                </form>
              </>
            ) : null}
            {tab === "security" ? (
              <>
                <div className="account-section-heading">
                  <span>SECURITY</span>
                  <h3>密码与设备</h3>
                  <p>敏感修改需要再次验证当前密码。</p>
                </div>
                <ChangePassword user={user} onChanged={onUser} />
                <hr />
                <h4>已登录设备</h4>
                <SessionsPanel />
              </>
            ) : null}
            {tab === "team" ? (
              <>
                <div className="account-section-heading">
                  <span>WORKSPACE</span>
                  <h3>团队账号</h3>
                  <p>实例管理员可以创建账号或立即停用访问。</p>
                </div>
                <TeamPanel currentUser={user} />
              </>
            ) : null}
            {tab === "activity" ? (
              <>
                <div className="account-section-heading">
                  <span>SECURITY ACTIVITY</span>
                  <h3>安全活动</h3>
                  <p>最近的登录、账号变更、权限调整与拦截记录。</p>
                </div>
                <AuditPanel />
              </>
            ) : null}
            {tab === "project" && context.projectKey ? (
              <>
                <div className="account-section-heading">
                  <span>PROJECT ACCESS</span>
                  <h3>{context.projectTitle ?? "项目"}成员</h3>
                  <p>权限只作用于当前项目，并由服务端逐个请求校验。</p>
                </div>
                <ProjectAccessPanel currentUser={user} projectKey={context.projectKey} />
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function AccountButton({
  projectKey,
  projectTitle,
  projectRole,
  compact = false,
}: CenterContext & { compact?: boolean }) {
  const auth = useAuth();
  if (!auth.enabled || !auth.user) return null;
  return (
    <button
      className={`account-button ${compact ? "compact" : ""}`}
      type="button"
      onClick={() => auth.openAccount({ projectKey, projectTitle, projectRole })}
      title="账号与权限"
    >
      <span>{auth.user.name.slice(0, 1).toUpperCase()}</span>
      {compact ? null : (
        <>
          <b>{auth.user.name}</b>
          <small>
            {projectRole
              ? projectRole.toUpperCase()
              : auth.user.instanceRole === "admin"
                ? "ADMIN"
                : "MEMBER"}
          </small>
        </>
      )}
    </button>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [user, setUser] = useState<Account | null>(null);
  const [center, setCenter] = useState<CenterContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await authApi.status();
      setApiCsrfToken(result.csrfToken);
      setConfigured(result.configured);
      setEnabled(result.enabled);
      setUser(result.user);
      setStatus("ready");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接 TakeBoard 服务");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const expired = () => {
      setApiCsrfToken(null);
      setUser(null);
      setCenter(null);
      void load();
    };
    window.addEventListener("takeboard:auth-required", expired);
    return () => window.removeEventListener("takeboard:auth-required", expired);
  }, [load]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      enabled,
      openAccount: (context = {}) => setCenter(context),
      refreshUser: setUser,
    }),
    [enabled, user],
  );
  if (status === "loading")
    return (
      <main className="auth-loading">
        <AuthMark />
        <span>正在验证工作室…</span>
      </main>
    );
  if (status === "error")
    return (
      <main className="auth-loading">
        <AuthMark />
        <p className="auth-error">{error}</p>
        <button className="auth-primary" type="button" onClick={() => void load()}>
          重新连接
        </button>
      </main>
    );
  if (enabled && !user)
    return (
      <AuthScreen
        configured={configured}
        onAuthenticated={(nextUser, token) => {
          setApiCsrfToken(token);
          setConfigured(true);
          setUser(nextUser);
        }}
      />
    );
  if (enabled && user?.mustChangePassword)
    return (
      <main className="auth-shell">
        <section className="auth-card password-required">
          <AuthMark />
          <div className="auth-card-copy">
            <span className="auth-eyebrow">SECURITY CHECK</span>
            <h1>先更换初始密码</h1>
            <p>管理员创建了你的初始账号。更换密码后，才会进入项目空间。</p>
          </div>
          <ChangePassword user={user} onChanged={setUser} />
        </section>
      </main>
    );
  return (
    <AuthContext.Provider value={value}>
      {children}
      {center && user ? (
        <AccountCenter
          user={user}
          context={center}
          onClose={() => setCenter(null)}
          onUser={setUser}
          onLogout={() =>
            void authApi.logout().finally(() => {
              setApiCsrfToken(null);
              setUser(null);
              setCenter(null);
            })
          }
        />
      ) : null}
    </AuthContext.Provider>
  );
}
