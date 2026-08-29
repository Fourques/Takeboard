import type {
  Account,
  AccountInvitation,
  AccountSession,
  AuthAuditEntry,
  InstanceRole,
  ProjectMember,
  ProjectRole,
  PublicInvitation,
  RecoveryCodeStatus,
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
import { authApi, type InstanceBackup, type StagedRestore, setApiCsrfToken } from "./api";

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
  const invitationToken = new URLSearchParams(window.location.search).get("invite");
  const [screen, setScreen] = useState<"login" | "recovery">("login");
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [invitationState, setInvitationState] = useState<"loading" | "ready" | "invalid">(
    invitationToken ? "loading" : "invalid",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || !invitationToken) return;
    void authApi
      .invitation(invitationToken)
      .then((result) => {
        setInvitation(result.invitation);
        setInvitationState("ready");
      })
      .catch(() => {
        setInvitationState("invalid");
        setError("邀请无效或已过期，请联系管理员重新邀请。");
      });
  }, [configured, invitationToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!configured && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
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

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault();
    if (!invitationToken || password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.acceptInvitation(invitationToken, password);
      window.history.replaceState({}, "", window.location.pathname);
      onAuthenticated(result.user, result.csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法接受邀请");
    } finally {
      setBusy(false);
    }
  }

  if (configured && invitationToken && invitationState !== "invalid") {
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
            <span className="auth-eyebrow">PRIVATE INVITATION</span>
            <h1 id="auth-title">加入 TakeBoard 工作室</h1>
            <p>
              {invitationState === "loading"
                ? "正在安全验证这份邀请…"
                : `${invitation?.name ?? "你"}，请为 ${invitation?.email ?? ""} 设置密码。`}
            </p>
          </div>
          {invitationState === "ready" ? (
            <form className="auth-form" onSubmit={acceptInvitation}>
              <label>
                <span>设置密码</span>
                <input
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <small>
                有效期至 {invitation ? new Date(invitation.expiresAt).toLocaleString("zh-CN") : ""}
                ，仅可使用一次。
              </small>
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button className="auth-primary" disabled={busy} type="submit">
                {busy ? "正在加入…" : "加入工作室"}
              </button>
            </form>
          ) : (
            <div className="auth-loading">
              <span />
            </div>
          )}
        </section>
      </main>
    );
  }

  if (configured && screen === "recovery") {
    return (
      <RecoveryScreen
        onBack={() => {
          setScreen("login");
          setError(null);
          setSuccess(null);
        }}
        onRecovered={() => {
          setScreen("login");
          setError(null);
          setSuccess("密码已重设。请使用新密码登录。");
        }}
      />
    );
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
          {success ? (
            <p className="auth-success" role="status">
              {success}
            </p>
          ) : null}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "正在验证…" : configured ? "进入 TakeBoard" : "创建工作室"}
          </button>
          {configured ? (
            <button
              className="auth-text-action"
              type="button"
              onClick={() => setScreen("recovery")}
            >
              使用恢复码重设密码
            </button>
          ) : null}
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

function RecoveryScreen({ onBack, onRecovered }: { onBack: () => void; onRecovered: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="auth-shell">
      <div className="auth-atmosphere" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section className="auth-card" aria-labelledby="recovery-title">
        <AuthMark />
        <div className="auth-card-copy">
          <span className="auth-eyebrow">ACCOUNT RECOVERY</span>
          <h1 id="recovery-title">使用离线恢复码</h1>
          <p>恢复码仅可使用一次；成功后其他设备将退出。</p>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) return setError("两次输入的新密码不一致");
            setBusy(true);
            setError(null);
            void authApi
              .recover(email, code, password)
              .then(onRecovered)
              .catch((cause) => setError(cause instanceof Error ? cause.message : "无法恢复账号"))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span>账号邮箱</span>
            <input
              autoComplete="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>恢复码</span>
            <input
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="TB-XXXX-XXXX-XXXX-XXXX"
            />
          </label>
          <label>
            <span>新密码</span>
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              type="password"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? "正在重设…" : "重设密码"}
          </button>
          <button className="auth-text-action" type="button" onClick={onBack}>
            返回登录
          </button>
        </form>
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

function RecoveryCodesPanel() {
  const [status, setStatus] = useState<RecoveryCodeStatus | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void authApi
      .recoveryCodeStatus()
      .then((result) => setStatus(result.status))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取恢复码状态"));
  }, []);
  const saveCodes = () => {
    const content = `TakeBoard 离线恢复码\n账号恢复时，每个恢复码只能使用一次。\n生成时间：${new Date().toLocaleString("zh-CN")}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "takeboard-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="recovery-codes-panel account-form compact">
      <div>
        <h4>离线恢复码</h4>
        <p>
          {status?.available
            ? `还剩 ${status.available} 个未使用恢复码。请与项目数据分开保管。`
            : "尚未建立恢复码；忘记密码时将无法自行恢复账号。"}
        </p>
      </div>
      {codes.length ? (
        <div className="recovery-code-reveal account-form compact" role="status">
          <strong>只显示这一次</strong>
          <div>
            {codes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
          <div className="account-form-actions">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(codes.join("\n"))}
            >
              复制全部
            </button>
            <button className="auth-primary" type="button" onClick={saveCodes}>
              下载文本
            </button>
          </div>
        </div>
      ) : open ? (
        <form
          className="account-form compact"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void authApi
              .generateRecoveryCodes(password)
              .then((result) => {
                setCodes(result.codes);
                setStatus(result.status);
                setPassword("");
                setOpen(false);
              })
              .catch((cause) => setError(cause instanceof Error ? cause.message : "无法生成恢复码"))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            <span>当前密码</span>
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <small>重新生成会立即作废之前尚未使用的全部恢复码。</small>
          <div className="account-form-actions">
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="auth-primary" disabled={busy} type="submit">
              {busy ? "正在生成…" : "确认生成 10 个"}
            </button>
          </div>
        </form>
      ) : (
        <button className="account-secondary" type="button" onClick={() => setOpen(true)}>
          {status?.available ? "轮换恢复码" : "生成恢复码"}
        </button>
      )}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TeamPanel({ currentUser }: { currentUser: Account }) {
  const [users, setUsers] = useState<Account[]>([]);
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    email: string;
    instanceRole: InstanceRole;
    expiresHours: number;
  }>({ name: "", email: "", instanceRole: "member", expiresHours: 72 });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([authApi.users(), authApi.invitations()]).then(([people, pending]) => {
        setUsers(people.users);
        setInvitations(pending.invitations);
      }),
    [],
  );
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
              .createInvitation(draft)
              .then((result) => {
                setCreating(false);
                setDraft({ name: "", email: "", instanceRole: "member", expiresHours: 72 });
                setInviteLink(
                  `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(result.token)}`,
                );
                return load();
              })
              .catch((cause) => setError(cause instanceof Error ? cause.message : "邀请失败"));
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
          <label>
            <span>有效期</span>
            <select
              value={draft.expiresHours}
              onChange={(event) =>
                setDraft((value) => ({ ...value, expiresHours: Number(event.target.value) }))
              }
            >
              <option value={24}>24 小时</option>
              <option value={72}>3 天</option>
              <option value={168}>7 天</option>
            </select>
          </label>
          <small>成员通过一次性链接设置密码；TakeBoard 不保存临时密码。</small>
          <div className="account-form-actions">
            <button type="button" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="auth-primary" type="submit">
              创建邀请
            </button>
          </div>
        </form>
      ) : (
        <button className="account-secondary" type="button" onClick={() => setCreating(true)}>
          ＋ 邀请团队成员
        </button>
      )}
      {inviteLink ? (
        <div className="invite-delivery account-form compact" role="status">
          <div>
            <strong>邀请已创建</strong>
            <small>这个链接只显示在本次创建后，请通过可信渠道发送。</small>
          </div>
          <input aria-label="邀请链接" readOnly value={inviteLink} />
          <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}>
            复制链接
          </button>
        </div>
      ) : null}
      {invitations.some((invitation) => invitation.status === "pending") ? (
        <div className="invitation-list account-list">
          <h4>待接受邀请</h4>
          {invitations
            .filter((invitation) => invitation.status === "pending")
            .map((invitation) => (
              <article key={invitation.id}>
                <div>
                  <strong>{invitation.name}</strong>
                  <span>{invitation.email}</span>
                  <small>{new Date(invitation.expiresAt).toLocaleString("zh-CN")} 到期</small>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void authApi
                      .revokeInvitation(invitation.id)
                      .then(load)
                      .catch((cause) =>
                        setError(cause instanceof Error ? cause.message : "撤销失败"),
                      )
                  }
                >
                  撤销
                </button>
              </article>
            ))}
        </div>
      ) : null}
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
  "auth.password_recovered": "使用恢复码重设密码",
  "auth.recovery_failed": "恢复码验证失败",
  "auth.recovery_codes_rotated": "生成新的恢复码",
  "auth.csrf_rejected": "拦截无效安全令牌",
  "authorization.denied": "拒绝越权访问",
  "user.created": "创建团队账号",
  "user.updated": "更新团队账号",
  "invitation.created": "创建团队邀请",
  "invitation.accepted": "接受团队邀请",
  "invitation.revoked": "撤销团队邀请",
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

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function BackupPanel() {
  const [backups, setBackups] = useState<InstanceBackup[]>([]);
  const [restore, setRestore] = useState<StagedRestore | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const load = useCallback(() => authApi.backups().then((value) => setBackups(value.backups)), []);
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "无法读取备份状态"),
    );
  }, [load]);
  const discard = async () => {
    if (restore) await authApi.discardRestore(restore.restoreId).catch(() => undefined);
    setRestore(null);
    setPassword("");
    setConfirmation("");
  };
  return (
    <div className="backup-panel">
      <section className="backup-summary account-form compact">
        <div>
          <span>最近可用备份</span>
          <strong>
            {backups[0] ? new Date(backups[0].createdAt).toLocaleString("zh-CN") : "尚未创建"}
          </strong>
          <small>
            {backups[0]
              ? `${backups[0].projectCount} 个项目 · ${backups[0].userCount} 个账号 · ${formatBytes(backups[0].size)}`
              : "首次创建会根据素材量耗时数秒到数分钟"}
          </small>
        </div>
        <button
          className="auth-primary"
          disabled={busy}
          type="button"
          onClick={() => {
            setBusy(true);
            setError(null);
            void authApi
              .createBackup()
              .then(load)
              .catch((cause) => setError(cause instanceof Error ? cause.message : "备份失败"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "正在建立一致性快照…" : "立即创建备份"}
        </button>
      </section>
      <p className="backup-explanation">
        备份包含全部项目、原始素材、生成结果以及身份数据库，并为每个文件记录
        SHA-256。生成任务运行时会拒绝备份，最多保留最近 5 份。
      </p>
      <div className="backup-list account-list">
        {backups.map((backup) => (
          <article key={backup.id}>
            <div>
              <strong>{new Date(backup.createdAt).toLocaleString("zh-CN")}</strong>
              <span>
                {backup.projectCount} 项目 · {backup.userCount} 账号 · {formatBytes(backup.size)}
              </span>
            </div>
            <a href={authApi.backupDownloadUrl(backup.id)}>下载</a>
          </article>
        ))}
      </div>
      <hr />
      <div className="account-section-heading compact">
        <span>VERIFIED RESTORE</span>
        <h3>恢复向导</h3>
        <p>先隔离验签并打开每个项目；确认后才导入，且不覆盖现有数据。</p>
      </div>
      {!restore ? (
        <label className="backup-upload">
          <input
            accept=".tgz,.takeboard-instance.tgz,application/gzip"
            disabled={busy}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError(null);
              void authApi
                .inspectBackup(file)
                .then((value) => setRestore(value.restore))
                .catch((cause) => setError(cause instanceof Error ? cause.message : "无法验证备份"))
                .finally(() => setBusy(false));
            }}
          />
          <strong>{busy ? "正在验证清单与项目…" : "选择实例备份进行检查"}</strong>
          <small>检查不会修改当前项目</small>
        </label>
      ) : (
        <section className="restore-review account-form compact">
          <header>
            <div>
              <span>校验通过</span>
              <strong>
                {restore.projectCount} 个项目 · {restore.userCount} 个备份账号
              </strong>
            </div>
            <button type="button" onClick={() => void discard()}>
              取消
            </button>
          </header>
          <div className="restore-project-list account-list">
            {restore.projects.map((project) => (
              <article key={project.projectId}>
                <div>
                  <span>{project.title}</span>
                  <small>
                    {project.alreadyExists
                      ? "当前实例已存在，将安全跳过"
                      : `将恢复 · Revision ${project.revision}`}
                  </small>
                </div>
              </article>
            ))}
          </div>
          <p>
            在线恢复只导入缺失项目，并把当前管理员设为
            Owner；为避免在运行中替换登录身份，备份内的身份数据库不会在线覆盖。完整灾难恢复请先停止服务，再运行
            <code>npm run easy:restore -- 备份文件 --confirm</code>。
          </p>
          <form
            className="account-form compact"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void authApi
                .applyRestore(restore.restoreId, password, confirmation)
                .then((value) => {
                  setResult(
                    `已恢复 ${value.restored.length} 个项目，跳过 ${value.skipped.length} 个已有项目。`,
                  );
                  setRestore(null);
                })
                .catch((cause) => setError(cause instanceof Error ? cause.message : "恢复失败"))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              <span>当前管理员密码</span>
              <input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              <span>输入 RESTORE 确认</span>
              <input
                autoComplete="off"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button
              className="auth-primary"
              disabled={busy || confirmation !== "RESTORE"}
              type="submit"
            >
              {busy ? "正在恢复…" : "恢复缺失项目"}
            </button>
          </form>
        </section>
      )}
      {result ? (
        <p className="auth-success" role="status">
          {result}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
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
    ...(user.instanceRole === "admin" ? ["team", "backup", "activity"] : []),
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
                  className={tab === "backup" ? "active" : ""}
                  type="button"
                  onClick={() => setTab("backup")}
                >
                  备份与恢复
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
                <RecoveryCodesPanel />
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
            {tab === "backup" ? (
              <>
                <div className="account-section-heading">
                  <span>RESILIENCE</span>
                  <h3>备份与恢复</h3>
                  <p>为项目、素材与身份数据建立可验证的离线副本。</p>
                </div>
                <BackupPanel />
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
            {auth.user.instanceRole === "admin"
              ? projectRole
                ? "ADMIN ACCESS"
                : "ADMIN"
              : projectRole
                ? projectRole.toUpperCase()
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
